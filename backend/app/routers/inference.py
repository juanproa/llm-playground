from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.inference import InferenceRun
from app.schemas.inference import InferenceRequest, InferenceRunResponse
from app.services import inference_service

router = APIRouter(tags=["inference"])


@router.post("/projects/{project_id}/inference/run", response_model=InferenceRunResponse)
async def run_inference(project_id: str, request: InferenceRequest, db: AsyncSession = Depends(get_db)):
    try:
        run = await inference_service.run_inference(db, project_id, request)
        return run
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/projects/{project_id}/inference/stream")
async def stream_inference(
    project_id: str,
    request: InferenceRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    try:
        ctx, generator = await inference_service.create_stream_run(db, project_id, request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Schedule the save to run after the response is fully sent
    background_tasks.add_task(inference_service.save_stream_run, ctx)

    return StreamingResponse(generator, media_type="text/event-stream")


@router.get("/projects/{project_id}/inference/history", response_model=list[InferenceRunResponse])
async def list_inference_history(project_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(InferenceRun)
        .where(InferenceRun.project_id == project_id)
        .order_by(InferenceRun.created_at.desc())
        .limit(50)
    )
    return list(result.scalars().all())


@router.get("/inference/{run_id}", response_model=InferenceRunResponse)
async def get_inference_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(InferenceRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Inference run not found")
    return run


@router.delete("/inference/{run_id}", status_code=204)
async def delete_inference_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(InferenceRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Inference run not found")
    await db.delete(run)
    await db.flush()


class BulkDeleteRequest(BaseModel):
    run_ids: list[str]


@router.post("/projects/{project_id}/inference/delete-bulk", status_code=204)
async def bulk_delete_runs(project_id: str, request: BulkDeleteRequest, db: AsyncSession = Depends(get_db)):
    await db.execute(
        delete(InferenceRun).where(
            InferenceRun.project_id == project_id,
            InferenceRun.id.in_(request.run_ids),
        )
    )
    await db.flush()


@router.delete("/projects/{project_id}/inference/history", status_code=204)
async def clear_all_history(project_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(
        delete(InferenceRun).where(InferenceRun.project_id == project_id)
    )
    await db.flush()
