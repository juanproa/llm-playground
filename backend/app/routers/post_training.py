"""Post-Training router: Datasets, SFT, Feedback, Backtesting."""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.model_config import ModelConfig
from app.models.post_training import (
    BacktestResult,
    BacktestRun,
    ComparisonChild,
    ComparisonInputItem,
    ComparisonResult,
    ComparisonRun,
    Dataset,
    DatasetItem,
    FeedbackItem,
    FeedbackRun,
    FusionJob,
    SyntheticJob,
    TestCase,
    TrainingJob,
)
from app.schemas.post_training import (
    ApplyCleanupRequest,
    ApplyCleanupResponse,
    ArtifactInfo,
    BacktestResultResponse,
    BacktestRunCreate,
    BacktestRunResponse,
    BacktestRunWithResultsResponse,
    CleanupPreviewRequest,
    CleanupPreviewResponse,
    CleanupRuleInfo,
    ComparisonRunCreate,
    ComparisonRunResponse,
    ComparisonRunWithChildrenResponse,
    BulkSetSystemRequest,
    DatasetCreate,
    DatasetItemCreate,
    DatasetItemResponse,
    DatasetItemUpdate,
    DatasetResponse,
    DatasetWithItemsResponse,
    FeedbackItemCreate,
    FeedbackItemResponse,
    FeedbackRunCreate,
    FeedbackRunResponse,
    FeedbackRunWithItemsResponse,
    FeedbackSubmit,
    FilterByTokensRequest,
    FilterByTokensResponse,
    FusionArtifactInfo,
    FusionJobCreate,
    FusionJobResponse,
    HfModelInfo,
    MergeDatasetsRequest,
    MlxModelInfo,
    SyntheticJobCreate,
    SyntheticJobResponse,
    TestCaseCreate,
    TestCaseResponse,
    TestCaseUpdate,
    TokenStatsRequest,
    TokenStatsResponse,
    TrainingBackendInfo,
    TrainingJobCreate,
    TrainingJobResponse,
)
from app.services import backtest_service, comparison_service, dataset_cleaner, dataset_studio_service, feedback_service, fusion_service, sft_service, synthetic_data_service, test_case_pii_service
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

    # SQLite (foreign_keys=ON) rejects the delete unless we purge children that
    # FK back to this dataset. TrainingJob.dataset_id is the only such ref
    # outside of DatasetItem.
    running = (await db.execute(
        select(TrainingJob).where(
            TrainingJob.dataset_id == dataset_id,
            TrainingJob.status == "running",
        )
    )).scalars().all()
    if running:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: {len(running)} training job(s) on this dataset are still running. Stop them first.",
        )

    await db.execute(delete(TrainingJob).where(TrainingJob.dataset_id == dataset_id))
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


@router.patch(
    f"{PREFIX}/datasets/{{dataset_id}}/items/{{item_id}}",
    response_model=DatasetItemResponse,
)
async def update_dataset_item(
    project_id: str,
    dataset_id: str,
    item_id: str,
    patch: DatasetItemUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update one or more fields of a single dataset item.

    Only fields explicitly present in the request body are touched. Pass
    `null` to clear a field (e.g. `{"system_message": null}` removes it);
    omit a field to leave it unchanged.
    """
    dataset = await db.get(Dataset, dataset_id)
    if not dataset or dataset.project_id != project_id:
        raise HTTPException(status_code=404, detail="Dataset not found")

    item = await db.get(DatasetItem, item_id)
    if not item or item.dataset_id != dataset_id:
        raise HTTPException(status_code=404, detail="Item not found")

    updates = patch.model_dump(exclude_unset=True)
    if "output_text" in updates and updates["output_text"] is None:
        raise HTTPException(
            status_code=400,
            detail="output_text cannot be null",
        )

    for key, value in updates.items():
        setattr(item, key, value)

    await db.flush()
    return item


@router.post(f"{PREFIX}/datasets/{{dataset_id}}/items/bulk-set-system")
async def bulk_set_system_message(
    project_id: str,
    dataset_id: str,
    payload: BulkSetSystemRequest,
    db: AsyncSession = Depends(get_db),
):
    """Set `system_message` on every item in a dataset.

    Returns `{updated_count, skipped_count}`. When `overwrite=false`, items
    that already have a non-empty system_message are skipped.
    """
    dataset = await db.get(Dataset, dataset_id)
    if not dataset or dataset.project_id != project_id:
        raise HTTPException(status_code=404, detail="Dataset not found")

    result = await db.execute(
        select(DatasetItem).where(DatasetItem.dataset_id == dataset_id)
    )
    items = list(result.scalars().all())

    updated = 0
    skipped = 0
    for item in items:
        has_existing = bool((item.system_message or "").strip())
        if has_existing and not payload.overwrite:
            skipped += 1
            continue
        item.system_message = payload.system_message
        updated += 1

    await db.flush()
    return {"updated_count": updated, "skipped_count": skipped}


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


# Match a single triple-backtick fence wrapping the ENTIRE string, with an
# optional language tag (e.g. ```json, ```jsonl, ```python, or just ```).
# Newlines around the body are optional so this also handles minified single-line
# fences like ` ```json{"x":1}``` `. Only fully-wrapping fences are stripped —
# fences embedded mid-text (e.g. inside an explanation) are left alone.
_FENCE_RE = re.compile(
    r"^\s*```[a-zA-Z0-9_+-]*\s*\n?(.*?)\n?\s*```\s*$",
    re.DOTALL,
)


def _strip_code_fences(text: str | None) -> str | None:
    """Remove a wrapping triple-backtick fence from `text` if present.

    Used at export time so training data doesn't carry markdown code fences
    that LLMs sometimes emit around their JSON outputs. Returns the input
    untouched (including None) when no full-wrap fence is found.
    """
    if not text:
        return text
    match = _FENCE_RE.match(text)
    if match:
        return match.group(1).strip()
    return text


@router.get(f"{PREFIX}/datasets/{{dataset_id}}/export")
async def export_dataset(
    project_id: str,
    dataset_id: str,
    format: str = "alpaca",
    db: AsyncSession = Depends(get_db),
):
    """Export an SFT dataset as a downloadable file.

    Formats:
    - `alpaca` (default) — JSONL with `{instruction, input, output, system}`
      keys (round-trips through the upload endpoint).
    - `messages` — JSONL with OpenAI chat format `{"messages": [...]}`,
      directly consumable by SFTTrainer / Unsloth / OpenAI fine-tuning.
    - `csv` — CSV with columns `instruction,input,output,system,tags`.

    All text fields are passed through `_strip_code_fences` so training data
    doesn't carry ``` ```json ``` ``` wrappers around outputs.
    """
    dataset = await db.get(Dataset, dataset_id)
    if not dataset or dataset.project_id != project_id:
        raise HTTPException(status_code=404, detail="Dataset not found")

    result = await db.execute(
        select(DatasetItem)
        .where(DatasetItem.dataset_id == dataset_id)
        .order_by(DatasetItem.created_at.asc())
    )
    items = list(result.scalars().all())

    fmt = format.lower()

    if fmt == "alpaca":
        lines: list[str] = []
        for it in items:
            row: dict = {
                "instruction": _strip_code_fences(it.instruction) or "",
                "input": _strip_code_fences(it.input_text) or "",
                "output": _strip_code_fences(it.output_text) or "",
            }
            sys_msg = _strip_code_fences(it.system_message)
            if sys_msg:
                row["system"] = sys_msg
            lines.append(json.dumps(row, ensure_ascii=False))
        body = "\n".join(lines) + ("\n" if lines else "")
        return PlainTextResponse(body, media_type="application/x-ndjson")

    if fmt == "messages":
        lines = []
        for it in items:
            messages: list[dict] = []
            sys_msg = _strip_code_fences(it.system_message)
            if sys_msg:
                messages.append({"role": "system", "content": sys_msg})
            instruction = _strip_code_fences(it.instruction) or ""
            input_text = _strip_code_fences(it.input_text) or ""
            user_content = instruction
            if input_text:
                user_content = f"{user_content}\n\n{input_text}".strip()
            messages.append({"role": "user", "content": user_content})
            messages.append({
                "role": "assistant",
                "content": _strip_code_fences(it.output_text) or "",
            })
            lines.append(json.dumps({"messages": messages}, ensure_ascii=False))
        body = "\n".join(lines) + ("\n" if lines else "")
        return PlainTextResponse(body, media_type="application/x-ndjson")

    if fmt == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["instruction", "input", "output", "system", "tags"])
        for it in items:
            writer.writerow([
                _strip_code_fences(it.instruction) or "",
                _strip_code_fences(it.input_text) or "",
                _strip_code_fences(it.output_text) or "",
                _strip_code_fences(it.system_message) or "",
                it.tags or "",
            ])
        return PlainTextResponse(buf.getvalue(), media_type="text/csv")

    raise HTTPException(
        status_code=400,
        detail=f"Unknown format: {format!r}. Use alpaca, messages, or csv.",
    )


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


@router.delete(f"{PREFIX}/training-jobs/{{job_id}}", status_code=204)
async def delete_training_job(
    project_id: str,
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    job = await db.get(TrainingJob, job_id)
    if not job or job.project_id != project_id:
        raise HTTPException(status_code=404, detail="Training job not found")
    if job.status == "running":
        raise HTTPException(
            status_code=409,
            detail="Cannot delete a running training job. Stop it first.",
        )
    await db.delete(job)
    await db.flush()


# ═══════════════════════════════════════════════════════════════════════════════
# SYNTHETIC DATA JOBS (Phase 3)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get(f"{PREFIX}/synthetic-jobs", response_model=list[SyntheticJobResponse])
async def list_synthetic_jobs(project_id: str, db: AsyncSession = Depends(get_db)):
    """All synthetic-data jobs for this project, newest first.

    The frontend polls this list every few seconds while any job is in
    pending/running/cancelling — same pattern as BacktestRun polling.
    """
    result = await db.execute(
        select(SyntheticJob)
        .where(SyntheticJob.project_id == project_id)
        .order_by(SyntheticJob.created_at.desc())
    )
    return list(result.scalars().all())


@router.post(f"{PREFIX}/synthetic-jobs", response_model=SyntheticJobResponse, status_code=201)
async def create_synthetic_job(
    project_id: str,
    data: SyntheticJobCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Kick off LLM-driven variation generation into a brand-new target dataset.

    Validates that the source has items, the model is enabled, and the
    multiplier table would produce at least one variant before doing any
    work. The target dataset is created eagerly (so the SFT panel sees it
    appear immediately) — items get filled in by the background worker.
    """
    # Source dataset must exist and belong to this project.
    source = await db.get(Dataset, data.source_dataset_id)
    if not source or source.project_id != project_id:
        raise HTTPException(status_code=404, detail="Source dataset not found")

    # Model must exist and be enabled.
    model = await db.get(ModelConfig, data.model_config_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if not model.is_enabled:
        raise HTTPException(status_code=400, detail="Model is not enabled")

    if not (data.variation_prompt or "").strip():
        raise HTTPException(status_code=400, detail="variation_prompt is required")

    # Plan the work up front. Lets us fail with a clear "0 variants planned"
    # rather than kicking off a doomed job. Load minimum needed for planning.
    src_items_q = await db.execute(
        select(DatasetItem.tags).where(DatasetItem.dataset_id == source.id)
    )
    item_tag_rows = [{"tags": row[0]} for row in src_items_q.all()]
    if not item_tag_rows:
        raise HTTPException(status_code=400, detail="Source dataset has no items")
    total_planned = synthetic_data_service.plan_total_planned(item_tag_rows, data.tag_multipliers)
    if total_planned == 0:
        raise HTTPException(
            status_code=400,
            detail="Tag multipliers would produce 0 variants. Increase counts or _default.",
        )

    # Create the target dataset eagerly so it shows up in the SFT panel right
    # away. The worker fills it in as it goes.
    target = Dataset(
        project_id=project_id,
        name=data.name,
        description=f"Synthetic dataset generated from '{source.name}' on {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}.",
        format=source.format,
        item_count=0,
    )
    db.add(target)
    await db.flush()  # populate target.id

    job = SyntheticJob(
        project_id=project_id,
        name=data.name,
        source_dataset_id=source.id,
        target_dataset_id=target.id,
        model_config_id=model.id,
        variation_prompt=data.variation_prompt,
        tag_multipliers=json.dumps(data.tag_multipliers),
        status="pending",
        total_planned=total_planned,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    background_tasks.add_task(
        synthetic_data_service.generate_synthetic_for_dataset, job.id
    )
    return job


@router.get(f"{PREFIX}/synthetic-jobs/{{job_id}}", response_model=SyntheticJobResponse)
async def get_synthetic_job(project_id: str, job_id: str, db: AsyncSession = Depends(get_db)):
    job = await db.get(SyntheticJob, job_id)
    if not job or job.project_id != project_id:
        raise HTTPException(status_code=404, detail="Synthetic job not found")
    return job


@router.post(f"{PREFIX}/synthetic-jobs/{{job_id}}/cancel", response_model=SyntheticJobResponse)
async def cancel_synthetic_job(project_id: str, job_id: str, db: AsyncSession = Depends(get_db)):
    """Cooperative cancel. Worker checks this status between items and bails."""
    job = await db.get(SyntheticJob, job_id)
    if not job or job.project_id != project_id:
        raise HTTPException(status_code=404, detail="Synthetic job not found")
    if job.status in ("completed", "failed", "cancelled"):
        # Terminal — nothing to cancel. Return as-is so the UI stays consistent.
        return job
    job.status = "cancelling"
    await db.commit()
    await db.refresh(job)
    return job


@router.delete(f"{PREFIX}/synthetic-jobs/{{job_id}}", status_code=204)
async def delete_synthetic_job(project_id: str, job_id: str, db: AsyncSession = Depends(get_db)):
    """Remove the job row. We intentionally do NOT cascade-delete the target
    dataset — the user may want to keep partial output even after dismissing
    the job from the in-flight panel.
    """
    job = await db.get(SyntheticJob, job_id)
    if not job or job.project_id != project_id:
        raise HTTPException(status_code=404, detail="Synthetic job not found")
    if job.status in ("running", "pending", "cancelling"):
        raise HTTPException(
            status_code=409,
            detail="Cancel the job first, then delete it.",
        )
    await db.delete(job)
    await db.flush()


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
    cases = list(result.scalars().all())
    # Replace `input_text` with the PII-masked version when the source dataset
    # item has been masked. This is the API-boundary enforcement of the rule
    # "if a mask exists, never return the original".
    return await test_case_pii_service.build_safe_responses(db, cases)


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
    return await test_case_pii_service.build_safe_response(db, tc)


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
    # Changing input_text invalidates any prior PII-mask result on this test
    # case — the masked text was for the OLD input. Reset so the user knows
    # they need to re-mask before running a backtest.
    if "input_text" in update_data and update_data["input_text"] != tc.input_text:
        tc.pii_status = "unchecked"
        tc.pii_masked_content = None
    for field, value in update_data.items():
        setattr(tc, field, value)

    await db.flush()
    return await test_case_pii_service.build_safe_response(db, tc)


@router.delete(f"{PREFIX}/test-cases/{{tc_id}}", status_code=204)
async def delete_test_case(
    project_id: str,
    tc_id: str,
    db: AsyncSession = Depends(get_db),
):
    tc = await db.get(TestCase, tc_id)
    if not tc or tc.project_id != project_id:
        raise HTTPException(status_code=404, detail="Test case not found")
    # BacktestResult has a NOT NULL FK to TestCase with no ON DELETE CASCADE,
    # so SQLite (foreign_keys=ON) rejects the delete unless we clear children
    # first. This is what made the old endpoint silently 500.
    await db.execute(delete(BacktestResult).where(BacktestResult.test_case_id == tc_id))
    await db.delete(tc)
    await db.flush()


@router.post(f"{PREFIX}/test-cases/bulk-delete", status_code=204)
async def bulk_delete_test_cases(
    project_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
):
    """Delete many test cases at once. Body: {"ids": ["...", "..."]}.

    Used by the "select all + delete" feature in the Backtest panel. Same
    BacktestResult cascade applies.
    """
    ids = data.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="ids must be a non-empty list")

    result = await db.execute(
        select(TestCase).where(TestCase.project_id == project_id, TestCase.id.in_(ids))
    )
    cases = list(result.scalars().all())
    if not cases:
        return
    case_ids = [c.id for c in cases]
    await db.execute(delete(BacktestResult).where(BacktestResult.test_case_id.in_(case_ids)))
    await db.execute(delete(TestCase).where(TestCase.id.in_(case_ids)))
    await db.flush()


@router.post(f"{PREFIX}/test-cases/mask-pii", response_model=dict, status_code=202)
async def mask_test_cases_pii(
    project_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Kick off PII detection and masking for every test case in the project
    that hasn't been processed yet (`pii_status='unchecked'`).

    Mirrors the dataset-level `POST /input-datasets/{id}/mask-pii` endpoint.
    Uses the same local privacy-filter model.
    """
    from app.services.pii_filter_service import is_loaded

    if not is_loaded():
        raise HTTPException(
            status_code=409,
            detail="PII filter model is not loaded. Preload it first via the Datasets page.",
        )

    result = await db.execute(
        select(TestCase)
        .where(TestCase.project_id == project_id)
        .where(TestCase.pii_status == "unchecked")
    )
    pending = list(result.scalars().all())
    if not pending:
        return {"queued_count": 0, "message": "No unchecked test cases to process"}

    background_tasks.add_task(
        test_case_pii_service.mask_pii_for_project_test_cases, project_id
    )
    return {
        "queued_count": len(pending),
        "message": f"PII masking queued for {len(pending)} test case(s)",
    }


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

    # Project policy: backtests may only run on PII-masked data when the test
    # case is sourced from a dataset. Refuse the run if any test case's source
    # InputDatasetItem hasn't been masked yet.
    unmasked = await test_case_pii_service.find_unmasked_test_cases(db, test_cases)
    if unmasked:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "unmasked_data",
                "message": (
                    f"{len(unmasked)} test case(s) are sourced from dataset items "
                    "that have not been PII-masked. Mask those items first, or "
                    "remove the test cases, then re-run."
                ),
                "unmasked_test_cases": [
                    {"id": tc.id, "name": tc.name} for tc in unmasked[:25]
                ],
                "unmasked_count": len(unmasked),
            },
        )

    # Compute the input signature for analytics / future cache use. We persist
    # it on the row but DO NOT block on it — every "Run Backtest" click creates
    # a fresh run, even when the same combo was run before. The InferenceCache
    # is what makes repeated identical runs cheap; users get a new BacktestRun
    # row each time so they can compare runs over time.
    target_signature = await test_case_pii_service.compute_input_signature(
        db, test_cases
    )

    # Create the run record (with the input_signature we already computed)
    run = BacktestRun(
        project_id=project_id,
        name=data.name,
        prompt_version_id=data.prompt_version_id,
        model_config_id=data.model_config_id,
        pass_threshold=data.pass_threshold,
        judge_model_config_id=data.judge_model_config_id,
        total_cases=len(test_cases),
        input_signature=target_signature,
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

    # Enrich results with test case data — running each test case through the
    # PII service so the returned `input_text` is the masked version when the
    # source InputDatasetItem has been masked.
    enriched = []
    for r in raw_results:
        tc = await db.get(TestCase, r.test_case_id)
        tc_response = (
            await test_case_pii_service.build_safe_response(db, tc) if tc else None
        )
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
            test_case=tc_response,
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


@router.post(f"{PREFIX}/backtest-runs/{{run_id}}/stop", response_model=BacktestRunResponse)
async def stop_backtest_run(project_id: str, run_id: str, db: AsyncSession = Depends(get_db)):
    """Stop an in-progress backtest run. Idempotent — already-paused/completed runs return as-is."""
    run = await db.get(BacktestRun, run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="Backtest run not found")

    # Only pause if currently running/pending; ignore if already terminal
    if run.status in ("pending", "running"):
        run.status = "paused"
        await db.commit()

    return run


@router.post(f"{PREFIX}/backtest-runs/{{run_id}}/resume", response_model=BacktestRunResponse)
async def resume_backtest_run(
    project_id: str, run_id: str, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)
):
    """Resume a paused backtest run. Only pending test cases will be re-executed."""
    run = await db.get(BacktestRun, run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="Backtest run not found")

    if run.status != "paused":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot resume run with status '{run.status}'; only paused runs can be resumed",
        )

    # Check if there are pending results to execute
    result = await db.execute(
        select(BacktestResult).where(
            BacktestResult.backtest_run_id == run_id,
            BacktestResult.status == "pending",
        )
    )
    pending_count = len(list(result.scalars().all()))

    if pending_count == 0:
        # No pending results — mark as completed and return
        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        await db.commit()
        return run

    # Mark as pending so the background task will pick it up and run it
    run.status = "pending"
    await db.commit()

    async def _run_backtest():
        try:
            await backtest_service.run_backtest(backtest_run_id=run_id)
        except Exception as e:
            import logging
            logging.getLogger(__name__).error("Background backtest resume failed: %s", e)

    background_tasks.add_task(_run_backtest)
    return run


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
            chain_ids=data.chain_ids,
            input_dataset_id=data.input_dataset_id,
            input_dataset_item_ids=data.input_dataset_item_ids,
            input_texts=data.input_texts,
            judge_model_config_id=data.judge_model_config_id,
            prompt_version_overrides=data.prompt_version_overrides,
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


@router.post(f"{PREFIX}/comparison-runs/{{comparison_id}}/cancel", response_model=ComparisonRunResponse)
async def cancel_comparison_run(project_id: str, comparison_id: str, db: AsyncSession = Depends(get_db)):
    """Stop an in-progress ComparisonRun. Marks parent + children as 'cancelling';
    the executor finalizes them as 'cancelled' between cases. Idempotent."""
    parent = await db.get(ComparisonRun, comparison_id)
    if not parent or parent.project_id != project_id:
        raise HTTPException(status_code=404, detail="Comparison run not found")
    updated = await comparison_service.cancel_comparison_run(db, comparison_id)
    return updated


@router.delete(f"{PREFIX}/comparison-runs/{{comparison_id}}", status_code=204)
async def delete_comparison_run(project_id: str, comparison_id: str, db: AsyncSession = Depends(get_db)):
    parent = await db.get(ComparisonRun, comparison_id)
    if not parent or parent.project_id != project_id:
        raise HTTPException(status_code=404, detail="Comparison run not found")
    # Cascade across the new comparison tables. Backtest tables are not touched.
    children = (await db.execute(
        select(ComparisonChild).where(ComparisonChild.comparison_run_id == comparison_id)
    )).scalars().all()
    for child in children:
        await db.execute(
            delete(ComparisonResult).where(ComparisonResult.child_id == child.id)
        )
        await db.delete(child)
    await db.execute(
        delete(ComparisonInputItem).where(ComparisonInputItem.comparison_run_id == comparison_id)
    )
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


# ═══════════════════════════════════════════════════════════════════════════════
# DATASET STUDIO — curation tools for SFT datasets (pt_datasets)
# ═══════════════════════════════════════════════════════════════════════════════
# All endpoints operate on Concept #3 (SFT Dataset) and are non-destructive:
# they ALWAYS create a new pt_dataset rather than mutating the source.


def _custom_rules_from_specs(specs) -> list[dataset_studio_service.CustomRule]:
    """Convert request CustomRuleSpec objects to service-layer CustomRule dataclasses."""
    return [
        dataset_studio_service.CustomRule(
            pattern=s.pattern,
            replacement=s.replacement,
            name=s.name,
            flags=re.MULTILINE if s.multiline else 0,
        )
        for s in specs
    ]


@router.get(f"{PREFIX}/dataset-studio/cleanup-rules", response_model=list[CleanupRuleInfo])
async def list_cleanup_rules(project_id: str):  # project_id unused — rules are static
    """List the built-in cleanup rules. Each rule has a name, description,
    tier (1-5), and a default_on flag the UI uses for initial state.
    """
    rules = dataset_studio_service.get_cleanup_rules()
    return [
        CleanupRuleInfo(
            id=r["id"],
            name=r["name"],
            description=r["description"],
            tier=r["tier"],
            default_on=r["default_on"],
            type=r["type"],
            pattern=r.get("pattern"),
        )
        for r in rules
    ]


@router.post(f"{PREFIX}/dataset-studio/preview-cleanup", response_model=CleanupPreviewResponse)
async def preview_cleanup_endpoint(
    project_id: str, body: CleanupPreviewRequest, db: AsyncSession = Depends(get_db)
):
    """Dry-run cleanup on the first N items of the dataset. Returns before/after
    samples plus dataset-wide character savings estimate.
    """
    try:
        result = await dataset_studio_service.preview_cleanup(
            db,
            project_id=project_id,
            source_dataset_id=body.source_dataset_id,
            enabled_rule_ids=set(body.enabled_rule_ids),
            custom_rules=_custom_rules_from_specs(body.custom_rules),
            sample_size=max(1, min(10, body.sample_size)),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return CleanupPreviewResponse(**result)


@router.post(f"{PREFIX}/dataset-studio/apply-cleanup", response_model=ApplyCleanupResponse, status_code=201)
async def apply_cleanup_endpoint(
    project_id: str, body: ApplyCleanupRequest, db: AsyncSession = Depends(get_db)
):
    """Apply cleanup rules to a dataset's `input_text` column and write the
    result to a NEW dataset. Source dataset is untouched.
    """
    if not body.new_name.strip():
        raise HTTPException(status_code=400, detail="new_name is required")

    try:
        new_dataset, stats = await dataset_studio_service.apply_cleanup_to_dataset(
            db,
            project_id=project_id,
            source_dataset_id=body.source_dataset_id,
            enabled_rule_ids=set(body.enabled_rule_ids),
            custom_rules=_custom_rules_from_specs(body.custom_rules),
            new_name=body.new_name.strip(),
            new_description=body.new_description,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return ApplyCleanupResponse(
        dataset=DatasetResponse.model_validate(new_dataset),
        items=stats["items"],
        input_chars_before=stats["input_chars_before"],
        input_chars_after=stats["input_chars_after"],
    )


@router.post(f"{PREFIX}/dataset-studio/merge", response_model=DatasetResponse, status_code=201)
async def merge_datasets_endpoint(
    project_id: str, body: MergeDatasetsRequest, db: AsyncSession = Depends(get_db)
):
    """N-way merge of source datasets into a new dataset. Source datasets are untouched."""
    if not body.new_name.strip():
        raise HTTPException(status_code=400, detail="new_name is required")
    if len(body.source_dataset_ids) < 1:
        raise HTTPException(status_code=400, detail="At least one source dataset is required")

    try:
        new_dataset = await dataset_studio_service.merge_datasets(
            db,
            project_id=project_id,
            source_dataset_ids=body.source_dataset_ids,
            new_name=body.new_name.strip(),
            new_description=body.new_description,
            dedup_strategy=body.dedup_strategy,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return new_dataset


@router.post(f"{PREFIX}/dataset-studio/token-stats", response_model=TokenStatsResponse)
async def token_stats_endpoint(
    project_id: str, body: TokenStatsRequest, db: AsyncSession = Depends(get_db)
):
    """Tokenize every item in the dataset and return distribution stats.

    First call for a given model_id triggers a tokenizer download (~5-50MB).
    Subsequent calls use the in-process cache and are near-instant.
    """
    # Verify the dataset belongs to this project
    src = await db.get(Dataset, body.dataset_id)
    if not src or src.project_id != project_id:
        raise HTTPException(status_code=404, detail="Dataset not found in this project")

    result = await dataset_studio_service.compute_token_stats(
        db, dataset_id=body.dataset_id, model_id=body.model_id
    )
    return TokenStatsResponse(**result)


@router.post(f"{PREFIX}/dataset-studio/filter-by-tokens", response_model=FilterByTokensResponse, status_code=201)
async def filter_by_tokens_endpoint(
    project_id: str, body: FilterByTokensRequest, db: AsyncSession = Depends(get_db)
):
    """Create a new dataset containing only items with combined token count <= max_tokens."""
    if not body.new_name.strip():
        raise HTTPException(status_code=400, detail="new_name is required")
    if body.max_tokens <= 0:
        raise HTTPException(status_code=400, detail="max_tokens must be positive")

    try:
        new_dataset, stats = await dataset_studio_service.filter_by_tokens(
            db,
            project_id=project_id,
            source_dataset_id=body.source_dataset_id,
            model_id=body.model_id,
            max_tokens=body.max_tokens,
            new_name=body.new_name.strip(),
            new_description=body.new_description,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return FilterByTokensResponse(
        dataset=DatasetResponse.model_validate(new_dataset),
        kept=stats["kept"],
        dropped=stats["dropped"],
        total=stats["total"],
    )
