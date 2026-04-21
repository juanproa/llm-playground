"""Post-Training router: Datasets, SFT, Feedback, Backtesting."""
from __future__ import annotations

import csv
import io
import json

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.post_training import (
    BacktestResult,
    BacktestRun,
    ComparisonRun,
    Dataset,
    DatasetItem,
    FeedbackItem,
    FeedbackRun,
    FusionJob,
    TestCase,
    TrainingJob,
)
from app.schemas.post_training import (
    ArtifactInfo,
    BacktestResultResponse,
    BacktestRunCreate,
    BacktestRunResponse,
    BacktestRunWithResultsResponse,
    ComparisonRunCreate,
    ComparisonRunResponse,
    ComparisonRunWithChildrenResponse,
    DatasetCreate,
    DatasetItemCreate,
    DatasetItemResponse,
    DatasetResponse,
    DatasetWithItemsResponse,
    FeedbackItemCreate,
    FeedbackItemResponse,
    FeedbackRunCreate,
    FeedbackRunResponse,
    FeedbackRunWithItemsResponse,
    FeedbackSubmit,
    FusionArtifactInfo,
    FusionJobCreate,
    FusionJobResponse,
    HfModelInfo,
    MlxModelInfo,
    TestCaseCreate,
    TestCaseResponse,
    TestCaseUpdate,
    TrainingBackendInfo,
    TrainingJobCreate,
    TrainingJobResponse,
)
from app.services import backtest_service, comparison_service, dataset_cleaner, feedback_service, fusion_service, sft_service
from app.services.mlx_catalog import KNOWN_HF_MODELS, KNOWN_MLX_MODELS
from app.services.pdf_parser import parse_pdf

router = APIRouter(tags=["post-training"])

PREFIX = "/projects/{project_id}/post-training"


# ═══════════════════════════════════════════════════════════════════════════════
# DATASETS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get(f"{PREFIX}/datasets", response_model=list[DatasetResponse])
async def list_datasets(project_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Dataset)
        .where(Dataset.project_id == project_id)
        .order_by(Dataset.created_at.desc())
    )
    return list(result.scalars().all())


@router.post(f"{PREFIX}/datasets", response_model=DatasetResponse, status_code=201)
async def create_dataset(project_id: str, data: DatasetCreate, db: AsyncSession = Depends(get_db)):
    dataset = Dataset(
        project_id=project_id,
        name=data.name,
        description=data.description,
        format=data.format,
    )
    db.add(dataset)
    await db.flush()
    return dataset


@router.get(f"{PREFIX}/datasets/{{dataset_id}}", response_model=DatasetWithItemsResponse)
async def get_dataset(project_id: str, dataset_id: str, db: AsyncSession = Depends(get_db)):
    dataset = await db.get(Dataset, dataset_id)
    if not dataset or dataset.project_id != project_id:
        raise HTTPException(status_code=404, detail="Dataset not found")

    result = await db.execute(
        select(DatasetItem)
        .where(DatasetItem.dataset_id == dataset_id)
        .order_by(DatasetItem.created_at.asc())
    )
    items = list(result.scalars().all())
    return DatasetWithItemsResponse(
        **DatasetResponse.model_validate(dataset).model_dump(),
        items=[DatasetItemResponse.model_validate(i) for i in items],
    )


@router.delete(f"{PREFIX}/datasets/{{dataset_id}}", status_code=204)
async def delete_dataset(project_id: str, dataset_id: str, db: AsyncSession = Depends(get_db)):
    dataset = await db.get(Dataset, dataset_id)
    if not dataset or dataset.project_id != project_id:
        raise HTTPException(status_code=404, detail="Dataset not found")

    await db.execute(delete(DatasetItem).where(DatasetItem.dataset_id == dataset_id))
    await db.delete(dataset)
    await db.flush()


@router.post(f"{PREFIX}/datasets/{{dataset_id}}/items", response_model=list[DatasetItemResponse], status_code=201)
async def add_dataset_items(
    project_id: str,
    dataset_id: str,
    items: list[DatasetItemCreate],
    db: AsyncSession = Depends(get_db),
):
    dataset = await db.get(Dataset, dataset_id)
    if not dataset or dataset.project_id != project_id:
        raise HTTPException(status_code=404, detail="Dataset not found")

    new_items = []
    for item_data in items:
        item = DatasetItem(dataset_id=dataset_id, **item_data.model_dump())
        db.add(item)
        new_items.append(item)

    dataset.item_count = dataset.item_count + len(new_items)
    await db.flush()
    return new_items


@router.delete(f"{PREFIX}/datasets/{{dataset_id}}/items/{{item_id}}", status_code=204)
async def delete_dataset_item(
    project_id: str,
    dataset_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
):
    dataset = await db.get(Dataset, dataset_id)
    if not dataset or dataset.project_id != project_id:
        raise HTTPException(status_code=404, detail="Dataset not found")

    item = await db.get(DatasetItem, item_id)
    if not item or item.dataset_id != dataset_id:
        raise HTTPException(status_code=404, detail="Item not found")

    await db.delete(item)
    dataset.item_count = max(0, dataset.item_count - 1)
    await db.flush()


@router.post(f"{PREFIX}/datasets/{{dataset_id}}/clean")
async def clean_dataset_endpoint(
    project_id: str,
    dataset_id: str,
    data: dict | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Run deduplication + whitespace/HTML normalization on a dataset.

    Body (all optional):
      - dedup: bool (default true)
      - normalize: bool (default true)
      - strip_html: bool (default false — set true for KB items scraped from web)

    Returns: {initial_count, duplicates_removed, normalized_count, final_count}
    """
    dataset = await db.get(Dataset, dataset_id)
    if not dataset or dataset.project_id != project_id:
        raise HTTPException(status_code=404, detail="Dataset not found")
    opts = data or {}
    return await dataset_cleaner.clean_dataset(
        db, dataset_id,
        dedup=opts.get("dedup", True),
        normalize=opts.get("normalize", True),
        strip_html=opts.get("strip_html", False),
    )


@router.post(f"{PREFIX}/datasets/{{dataset_id}}/upload", response_model=DatasetResponse)
async def upload_dataset_file(
    project_id: str,
    dataset_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    dataset = await db.get(Dataset, dataset_id)
    if not dataset or dataset.project_id != project_id:
        raise HTTPException(status_code=404, detail="Dataset not found")

    content = await file.read()
    text = content.decode("utf-8", errors="replace")

    items_to_add: list[DatasetItem] = []

    filename = (file.filename or "").lower()
    if filename.endswith(".csv"):
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            item = DatasetItem(
                dataset_id=dataset_id,
                instruction=row.get("instruction") or None,
                input_text=row.get("input") or row.get("input_text") or None,
                output_text=row.get("output") or row.get("output_text") or "",
                system_message=row.get("system") or row.get("system_message") or None,
                tags=row.get("tags") or None,
            )
            items_to_add.append(item)
    else:
        # Assume JSONL
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            item = DatasetItem(
                dataset_id=dataset_id,
                instruction=obj.get("instruction") or None,
                input_text=obj.get("input") or obj.get("input_text") or None,
                output_text=obj.get("output") or obj.get("output_text") or "",
                system_message=obj.get("system") or obj.get("system_message") or None,
                tags=obj.get("tags") or None,
                metadata_json=json.dumps(obj.get("metadata")) if obj.get("metadata") else None,
            )
            items_to_add.append(item)

    for item in items_to_add:
        db.add(item)

    dataset.item_count = dataset.item_count + len(items_to_add)
    await db.flush()
    return dataset


# ═══════════════════════════════════════════════════════════════════════════════
# TRAINING JOBS (SFT)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get(f"{PREFIX}/training-jobs", response_model=list[TrainingJobResponse])
async def list_training_jobs(project_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TrainingJob)
        .where(TrainingJob.project_id == project_id)
        .order_by(TrainingJob.created_at.desc())
    )
    return list(result.scalars().all())


@router.post(f"{PREFIX}/training-jobs", response_model=TrainingJobResponse, status_code=201)
async def create_training_job(
    project_id: str,
    data: TrainingJobCreate,
    db: AsyncSession = Depends(get_db),
):
    hyperparams_json = json.dumps(data.hyperparams) if data.hyperparams else None

    job = TrainingJob(
        project_id=project_id,
        dataset_id=data.dataset_id,
        name=data.name,
        base_model=data.base_model,
        backend=data.backend,
        hyperparams=hyperparams_json,
    )
    db.add(job)
    await db.flush()
    return job


@router.get(f"{PREFIX}/training-jobs/{{job_id}}", response_model=TrainingJobResponse)
async def get_training_job(project_id: str, job_id: str, db: AsyncSession = Depends(get_db)):
    job = await db.get(TrainingJob, job_id)
    if not job or job.project_id != project_id:
        raise HTTPException(status_code=404, detail="Training job not found")
    return job


@router.post(f"{PREFIX}/training-jobs/{{job_id}}/start", response_model=TrainingJobResponse)
async def start_training_job(
    project_id: str,
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    job = await db.get(TrainingJob, job_id)
    if not job or job.project_id != project_id:
        raise HTTPException(status_code=404, detail="Training job not found")
    try:
        updated_job = await sft_service.start_training_job(db, job_id)
        return updated_job
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(f"{PREFIX}/training-jobs/{{job_id}}/stop", response_model=TrainingJobResponse)
async def stop_training_job(
    project_id: str,
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    job = await db.get(TrainingJob, job_id)
    if not job or job.project_id != project_id:
        raise HTTPException(status_code=404, detail="Training job not found")
    try:
        updated_job = await sft_service.stop_training_job(db, job_id)
        return updated_job
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# FEEDBACK RUNS
# ═══════════════════════════════════════════════════════════════════════════════

@router.post(f"{PREFIX}/feedback-runs/parse-file")
async def parse_feedback_input_file(project_id: str, file: UploadFile = File(...)):
    """Extract input texts from an uploaded file.

    Supports PDF (via Docling + Tesseract OCR), JSONL/JSON, CSV, and plain text.
    Returns {"inputs": [str, ...]}.
    """
    import asyncio
    import os
    import tempfile
    import uuid

    filename = (file.filename or "").lower()
    ext = os.path.splitext(filename)[1]
    content = await file.read()
    inputs: list[str] = []

    if ext == ".pdf":
        tmp_path = os.path.join(tempfile.gettempdir(), f"fb_{uuid.uuid4().hex}.pdf")
        with open(tmp_path, "wb") as fh:
            fh.write(content)
        try:
            text = await asyncio.to_thread(parse_pdf, tmp_path)
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        if text and text.strip():
            inputs = [text.strip()]
    elif ext in (".jsonl", ".json"):
        for line in content.decode("utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, str):
                inputs.append(obj)
            elif isinstance(obj, dict):
                val = obj.get("input_text") or obj.get("input") or obj.get("prompt") or obj.get("text")
                if val:
                    inputs.append(str(val))
    elif ext == ".csv":
        reader = csv.reader(io.StringIO(content.decode("utf-8", errors="ignore")))
        rows = [r for r in reader if r]
        if rows:
            header = [h.strip().lower() for h in rows[0]]
            candidates = {"input_text", "input", "prompt", "text"}
            col = next((i for i, h in enumerate(header) if h in candidates), None)
            data_rows = rows[1:] if col is not None else rows
            pick = col if col is not None else 0
            inputs = [r[pick].strip() for r in data_rows if len(r) > pick and r[pick].strip()]
    else:
        inputs = [ln.strip() for ln in content.decode("utf-8", errors="ignore").splitlines() if ln.strip()]

    return {"inputs": inputs}


@router.get(f"{PREFIX}/feedback-runs", response_model=list[FeedbackRunResponse])
async def list_feedback_runs(project_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(FeedbackRun)
        .where(FeedbackRun.project_id == project_id)
        .order_by(FeedbackRun.created_at.desc())
    )
    return list(result.scalars().all())


@router.post(f"{PREFIX}/feedback-runs", response_model=FeedbackRunResponse, status_code=201)
async def create_feedback_run(
    project_id: str,
    data: FeedbackRunCreate,
    db: AsyncSession = Depends(get_db),
):
    run = FeedbackRun(
        project_id=project_id,
        name=data.name,
        description=data.description,
        prompt_version_id=data.prompt_version_id,
        model_config_id=data.model_config_id,
    )
    db.add(run)
    await db.flush()
    return run


@router.get(f"{PREFIX}/feedback-runs/{{run_id}}", response_model=FeedbackRunWithItemsResponse)
async def get_feedback_run(project_id: str, run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(FeedbackRun, run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="Feedback run not found")

    result = await db.execute(
        select(FeedbackItem)
        .where(FeedbackItem.run_id == run_id)
        .order_by(FeedbackItem.created_at.asc())
    )
    items = list(result.scalars().all())
    return FeedbackRunWithItemsResponse(
        **FeedbackRunResponse.model_validate(run).model_dump(),
        items=[FeedbackItemResponse.model_validate(i) for i in items],
    )


@router.post(f"{PREFIX}/feedback-runs/{{run_id}}/items", response_model=list[FeedbackItemResponse], status_code=201)
async def add_feedback_items(
    project_id: str,
    run_id: str,
    items: list[FeedbackItemCreate],
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(FeedbackRun, run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="Feedback run not found")

    new_items = []
    for item_data in items:
        item = FeedbackItem(run_id=run_id, input_text=item_data.input_text)
        db.add(item)
        new_items.append(item)

    run.item_count = run.item_count + len(new_items)
    await db.flush()

    # Auto-trigger generation in background if the run is configured
    if run.prompt_version_id and run.model_config_id and new_items:
        async def _auto_generate():
            try:
                from app.database import async_session as make_session
                async with make_session() as session:
                    await feedback_service.generate_outputs_for_run(session, run_id)
                    await session.commit()
            except Exception as e:
                import logging
                logging.getLogger(__name__).error("Auto-generate after add_feedback_items failed: %s", e)

        background_tasks.add_task(_auto_generate)

    return new_items


@router.delete(f"{PREFIX}/feedback-runs/{{run_id}}", status_code=204)
async def delete_feedback_run(project_id: str, run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(FeedbackRun, run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="Feedback run not found")
    await db.execute(delete(FeedbackItem).where(FeedbackItem.run_id == run_id))
    await db.delete(run)
    await db.flush()


@router.post(f"{PREFIX}/feedback-runs/{{run_id}}/generate")
async def generate_feedback_outputs(
    project_id: str,
    run_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(FeedbackRun, run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="Feedback run not found")

    async def _generate():
        try:
            from app.database import async_session as make_session
            async with make_session() as session:
                await feedback_service.generate_outputs_for_run(session, run_id)
                await session.commit()
        except Exception as e:
            import logging
            logging.getLogger(__name__).error("Background generate failed: %s", e)

    background_tasks.add_task(_generate)
    return {"detail": "Generation started in background"}


@router.put(
    f"{PREFIX}/feedback-runs/{{run_id}}/items/{{item_id}}/review",
    response_model=FeedbackItemResponse,
)
async def submit_feedback_review(
    project_id: str,
    run_id: str,
    item_id: str,
    data: FeedbackSubmit,
    db: AsyncSession = Depends(get_db),
):
    run = await db.get(FeedbackRun, run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="Feedback run not found")
    try:
        item = await feedback_service.submit_feedback(db, item_id, data)
        return item
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post(f"{PREFIX}/feedback-runs/{{run_id}}/to-dpo-dataset", response_model=DatasetResponse, status_code=201)
async def feedback_run_to_dpo_dataset(
    project_id: str,
    run_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
):
    """Materialize the reviewed feedback items as a DPO-format Dataset.

    Body: {"name": "my dataset name"}
    Returns the new dataset record.
    """
    run = await db.get(FeedbackRun, run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="Feedback run not found")
    name = (data or {}).get("name") or f"DPO from {run.name}"
    try:
        ds = await feedback_service.build_dpo_dataset_from_run(db, run_id, name)
        return ds
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(f"{PREFIX}/feedback-runs/{{run_id}}/export")
async def export_feedback_run(project_id: str, run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(FeedbackRun, run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="Feedback run not found")
    try:
        jsonl = await feedback_service.export_run_as_jsonl(db, run_id)
        return PlainTextResponse(jsonl, media_type="application/x-ndjson")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# TEST CASES
# ═══════════════════════════════════════════════════════════════════════════════

@router.get(f"{PREFIX}/test-cases", response_model=list[TestCaseResponse])
async def list_test_cases(project_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TestCase)
        .where(TestCase.project_id == project_id)
        .order_by(TestCase.created_at.desc())
    )
    return list(result.scalars().all())


@router.post(f"{PREFIX}/test-cases", response_model=TestCaseResponse, status_code=201)
async def create_test_case(
    project_id: str,
    data: TestCaseCreate,
    db: AsyncSession = Depends(get_db),
):
    payload = data.model_dump()
    # Serialize assertions to JSON string for storage
    if payload.get("assertions") is not None:
        payload["assertions"] = json.dumps(payload["assertions"])
    tc = TestCase(project_id=project_id, **payload)
    db.add(tc)
    await db.flush()
    return tc


@router.put(f"{PREFIX}/test-cases/{{tc_id}}", response_model=TestCaseResponse)
async def update_test_case(
    project_id: str,
    tc_id: str,
    data: TestCaseUpdate,
    db: AsyncSession = Depends(get_db),
):
    tc = await db.get(TestCase, tc_id)
    if not tc or tc.project_id != project_id:
        raise HTTPException(status_code=404, detail="Test case not found")

    # `exclude_unset=True` lets users explicitly clear fields by sending null.
    update_data = data.model_dump(exclude_unset=True)
    if "assertions" in update_data:
        val = update_data["assertions"]
        update_data["assertions"] = json.dumps(val) if val is not None else None
    for field, value in update_data.items():
        setattr(tc, field, value)

    await db.flush()
    return tc


@router.delete(f"{PREFIX}/test-cases/{{tc_id}}", status_code=204)
async def delete_test_case(
    project_id: str,
    tc_id: str,
    db: AsyncSession = Depends(get_db),
):
    tc = await db.get(TestCase, tc_id)
    if not tc or tc.project_id != project_id:
        raise HTTPException(status_code=404, detail="Test case not found")
    await db.delete(tc)
    await db.flush()


# ═══════════════════════════════════════════════════════════════════════════════
# BACKTEST RUNS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get(f"{PREFIX}/backtest-runs", response_model=list[BacktestRunResponse])
async def list_backtest_runs(project_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BacktestRun)
        .where(BacktestRun.project_id == project_id)
        .order_by(BacktestRun.created_at.desc())
    )
    return list(result.scalars().all())


@router.post(f"{PREFIX}/backtest-runs", response_model=BacktestRunResponse, status_code=201)
async def create_backtest_run(
    project_id: str,
    data: BacktestRunCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    # Determine test cases
    if data.test_case_ids:
        result = await db.execute(
            select(TestCase).where(
                TestCase.project_id == project_id,
                TestCase.id.in_(data.test_case_ids),
            )
        )
        test_cases = list(result.scalars().all())
    else:
        result = await db.execute(
            select(TestCase).where(TestCase.project_id == project_id)
        )
        test_cases = list(result.scalars().all())

    if not test_cases:
        raise HTTPException(status_code=400, detail="No test cases found for this project")

    # Create the run record
    run = BacktestRun(
        project_id=project_id,
        name=data.name,
        prompt_version_id=data.prompt_version_id,
        model_config_id=data.model_config_id,
        pass_threshold=data.pass_threshold,
        judge_model_config_id=data.judge_model_config_id,
        total_cases=len(test_cases),
    )
    db.add(run)
    await db.flush()

    # Pre-create result stubs
    for tc in test_cases:
        result_record = BacktestResult(
            backtest_run_id=run.id,
            test_case_id=tc.id,
        )
        db.add(result_record)

    # Commit NOW so the background task can see the records in its own session
    await db.commit()
    await db.refresh(run)
    run_id = run.id

    async def _run_backtest():
        try:
            await backtest_service.run_backtest(backtest_run_id=run_id)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error("Background backtest failed: %s", e)

    background_tasks.add_task(_run_backtest)
    return run


@router.get(f"{PREFIX}/backtest-runs/{{run_id}}", response_model=BacktestRunWithResultsResponse)
async def get_backtest_run(project_id: str, run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(BacktestRun, run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="Backtest run not found")

    result = await db.execute(
        select(BacktestResult)
        .where(BacktestResult.backtest_run_id == run_id)
        .order_by(BacktestResult.created_at.asc())
    )
    raw_results = list(result.scalars().all())

    # Enrich results with test case data
    enriched = []
    for r in raw_results:
        tc = await db.get(TestCase, r.test_case_id)
        enriched.append(BacktestResultResponse(
            id=r.id,
            backtest_run_id=r.backtest_run_id,
            test_case_id=r.test_case_id,
            actual_output=r.actual_output,
            status=r.status,
            pass_score=r.pass_score,
            latency_ms=r.latency_ms,
            error_message=r.error_message,
            created_at=r.created_at,
            test_case=TestCaseResponse.model_validate(tc) if tc else None,
        ))

    return BacktestRunWithResultsResponse(
        **BacktestRunResponse.model_validate(run).model_dump(),
        results=enriched,
    )


@router.delete(f"{PREFIX}/backtest-runs/{{run_id}}", status_code=204)
async def delete_backtest_run(project_id: str, run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(BacktestRun, run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="Backtest run not found")
    await db.delete(run)  # cascade deletes BacktestResult rows via relationship


# ═══════════════════════════════════════════════════════════════════════════════
# COMPARISON RUNS (multi-model batch compare)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get(f"{PREFIX}/comparison-runs", response_model=list[ComparisonRunResponse])
async def list_comparison_runs(project_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ComparisonRun)
        .where(ComparisonRun.project_id == project_id)
        .order_by(ComparisonRun.created_at.desc())
    )
    return list(result.scalars().all())


@router.post(f"{PREFIX}/comparison-runs", response_model=ComparisonRunResponse, status_code=201)
async def create_comparison_run(
    project_id: str,
    data: ComparisonRunCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    try:
        run = await comparison_service.create_comparison_run(
            db,
            project_id=project_id,
            name=data.name,
            prompt_version_id=data.prompt_version_id,
            model_config_ids=data.model_config_ids,
            test_case_ids=data.test_case_ids,
            knowledge_base_item_ids=data.knowledge_base_item_ids,
            judge_model_config_id=data.judge_model_config_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    run_id = run.id

    async def _kick():
        try:
            await comparison_service.run_comparison(run_id)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error("Comparison run %s failed: %s", run_id, e)

    background_tasks.add_task(_kick)
    return run


@router.get(f"{PREFIX}/comparison-runs/{{comparison_id}}", response_model=ComparisonRunWithChildrenResponse)
async def get_comparison_run(project_id: str, comparison_id: str, db: AsyncSession = Depends(get_db)):
    parent = await db.get(ComparisonRun, comparison_id)
    if not parent or parent.project_id != project_id:
        raise HTTPException(status_code=404, detail="Comparison run not found")
    data = await comparison_service.get_comparison_with_children(db, comparison_id)
    return data


@router.delete(f"{PREFIX}/comparison-runs/{{comparison_id}}", status_code=204)
async def delete_comparison_run(project_id: str, comparison_id: str, db: AsyncSession = Depends(get_db)):
    import json as _json
    parent = await db.get(ComparisonRun, comparison_id)
    if not parent or parent.project_id != project_id:
        raise HTTPException(status_code=404, detail="Comparison run not found")
    # Cascade-delete child backtest runs too
    try:
        child_ids = _json.loads(parent.child_backtest_run_ids or "[]")
    except Exception:
        child_ids = []
    for cid in child_ids:
        child = await db.get(BacktestRun, cid)
        if child:
            await db.delete(child)
    await db.delete(parent)


# ═══════════════════════════════════════════════════════════════════════════════
# SFT: backends / catalog / artifacts
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/post-training/sft/backends", response_model=list[TrainingBackendInfo])
async def list_sft_backends():
    return sft_service.list_backends()


@router.get("/post-training/sft/mlx-models", response_model=list[MlxModelInfo])
async def list_mlx_models():
    return [m.model_dump() for m in KNOWN_MLX_MODELS]


@router.get("/post-training/sft/hf-models", response_model=list[HfModelInfo])
async def list_hf_models():
    return [m.model_dump() for m in KNOWN_HF_MODELS]


@router.get("/post-training/sft/artifacts", response_model=list[ArtifactInfo])
async def list_sft_artifacts():
    return sft_service.list_artifacts()


@router.delete("/post-training/sft/artifacts/{job_id}", status_code=204)
async def delete_sft_artifact(job_id: str):
    if not sft_service.delete_artifact(job_id):
        raise HTTPException(status_code=404, detail="Artifact not found")


# ═══════════════════════════════════════════════════════════════════════════════
# FUSION
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/post-training/fusion/backends", response_model=list[TrainingBackendInfo])
async def list_fusion_backends():
    return fusion_service.list_fusion_backends()


@router.get("/post-training/fusion/tools")
async def list_fusion_tools():
    """Check availability of downstream tools (ollama, gguf converter)."""
    return {
        "ollama": fusion_service.ollama_available(),
        "mlx_fuse": fusion_service.mlx_fuse_available(),
        "peft_fuse": fusion_service.peft_fuse_available(),
    }


@router.get("/post-training/fusion/jobs", response_model=list[FusionJobResponse])
async def list_fusion_jobs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FusionJob).order_by(FusionJob.created_at.desc()))
    return list(result.scalars().all())


@router.post("/post-training/fusion/jobs", response_model=FusionJobResponse, status_code=201)
async def create_fusion_job(
    data: FusionJobCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    job = FusionJob(
        name=data.name,
        project_id=data.project_id,
        backend=data.backend,
        base_model=data.base_model,
        adapter_path=data.adapter_path,
        source_job_id=data.source_job_id,
        convert_to_gguf=data.convert_to_gguf,
        register_with_ollama=data.register_with_ollama,
        ollama_name=data.ollama_name,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    fusion_id = job.id

    async def _kickoff():
        await fusion_service.start_fusion(fusion_id)

    background_tasks.add_task(_kickoff)
    return job


@router.get("/post-training/fusion/jobs/{fusion_id}", response_model=FusionJobResponse)
async def get_fusion_job(fusion_id: str, db: AsyncSession = Depends(get_db)):
    job = await db.get(FusionJob, fusion_id)
    if not job:
        raise HTTPException(status_code=404, detail="Fusion job not found")
    return job


@router.delete("/post-training/fusion/jobs/{fusion_id}", status_code=204)
async def delete_fusion_job(fusion_id: str, db: AsyncSession = Depends(get_db)):
    job = await db.get(FusionJob, fusion_id)
    if not job:
        raise HTTPException(status_code=404, detail="Fusion job not found")
    await db.delete(job)
    await db.flush()


@router.get("/post-training/fusion/artifacts", response_model=list[FusionArtifactInfo])
async def list_fusion_artifacts():
    return fusion_service.list_fusion_artifacts()


@router.delete("/post-training/fusion/artifacts/{fusion_id}", status_code=204)
async def delete_fusion_artifact(fusion_id: str):
    if not fusion_service.delete_fusion_artifact(fusion_id):
        raise HTTPException(status_code=404, detail="Artifact not found")
