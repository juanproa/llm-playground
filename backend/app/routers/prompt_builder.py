from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.inference import InferenceRun
from app.models.prompt import Prompt, PromptVersion
from app.schemas.prompt import PromptVersionCreate
from app.schemas.prompt_builder import (
    PromptBuilderRequest,
    PromptBuilderResponse,
    ApproveChangeRequest,
    ApproveChangeResponse,
)
from app.services import prompt_builder_service, prompt_service, inference_service

router = APIRouter(prefix="/projects/{project_id}/prompt-builder", tags=["prompt-builder"])


@router.post("/ask", response_model=PromptBuilderResponse)
async def ask_helper(
    project_id: str,
    request: PromptBuilderRequest,
    db: AsyncSession = Depends(get_db),
):
    """Ask helper LLM for prompt improvement suggestions."""

    # Validate run exists and belongs to project
    run = await db.get(InferenceRun, request.run_id)
    if not run or run.project_id != project_id:
        raise HTTPException(status_code=404, detail="Run not found")

    result = await prompt_builder_service.ask_helper_llm(
        db,
        project_id,
        request.run_id,
        request.user_question,
        request.helper_model_config_id,
    )

    return PromptBuilderResponse(**result)


@router.post("/approve-change", response_model=ApproveChangeResponse)
async def approve_prompt_change(
    project_id: str,
    request: ApproveChangeRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Approve the helper's suggestion and create a new prompt version.

    1. Create a new prompt version with the proposed prompt
    2. Auto-run inference with the new version on the same input
    3. Return new version + run info
    """

    # Fetch original run
    original_run = await db.get(InferenceRun, request.run_id)
    if not original_run or original_run.project_id != project_id:
        raise HTTPException(status_code=404, detail="Run not found")

    # Fetch original prompt version to get the prompt ID and inherit settings
    original_version = await db.get(PromptVersion, original_run.prompt_version_id)
    if not original_version:
        raise HTTPException(status_code=404, detail="Prompt version not found")

    # Get the Prompt to access its ID
    prompt = await db.get(Prompt, original_version.prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")

    try:
        # Create new prompt version
        new_version = await prompt_service.create_version(
            db,
            prompt.id,
            PromptVersionCreate(
                content=request.proposed_prompt,
                label=f"optimized - {request.explanation[:40]}",
                # Inherit system message and KB bindings
                system_message=original_version.system_message,
                kb_id=original_version.kb_id,
                kb_top_k=original_version.kb_top_k,
            ),
        )

        # Prepare the inference request with new version
        from app.schemas.inference import InferenceRequest
        inference_request = InferenceRequest(
            prompt_version_id=new_version.id,
            model_config_id=original_run.model_config_id,
            document_id=original_run.document_id,
            input_text=original_run.input_text,
            kb_id=new_version.kb_id,
            kb_top_k=new_version.kb_top_k,
        )

        # Auto-run inference with new version
        new_run = await inference_service.run_inference(db, project_id, inference_request)

        # Commit all changes
        await db.commit()

        return ApproveChangeResponse(
            version_id=new_version.id,
            version_number=new_version.version_number,
            new_run_id=new_run.id,
            new_run_output=new_run.output_text,
        )

    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Error creating new version: {str(e)}")
