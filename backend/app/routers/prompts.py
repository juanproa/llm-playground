from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.prompt import (
    PromptCreate,
    PromptResponse,
    PromptUpdate,
    PromptVersionCreate,
    PromptVersionResponse,
    PromptVersionUpdate,
)
from app.services import prompt_service

router = APIRouter(tags=["prompts"])


@router.get("/projects/{project_id}/prompts", response_model=list[PromptResponse])
async def list_prompts(project_id: str, db: AsyncSession = Depends(get_db)):
    return await prompt_service.list_prompts(db, project_id)


@router.post("/projects/{project_id}/prompts", response_model=PromptResponse, status_code=201)
async def create_prompt(project_id: str, data: PromptCreate, db: AsyncSession = Depends(get_db)):
    return await prompt_service.create_prompt(db, project_id, data)


@router.get("/prompts/{prompt_id}", response_model=PromptResponse)
async def get_prompt(prompt_id: str, db: AsyncSession = Depends(get_db)):
    prompt = await prompt_service.get_prompt(db, prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt


@router.put("/prompts/{prompt_id}", response_model=PromptResponse)
async def update_prompt(prompt_id: str, data: PromptUpdate, db: AsyncSession = Depends(get_db)):
    prompt = await prompt_service.update_prompt(db, prompt_id, data)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return prompt


@router.delete("/prompts/{prompt_id}", status_code=204)
async def delete_prompt(prompt_id: str, db: AsyncSession = Depends(get_db)):
    if not await prompt_service.delete_prompt(db, prompt_id):
        raise HTTPException(status_code=404, detail="Prompt not found")


@router.post("/prompts/{prompt_id}/versions", response_model=PromptVersionResponse, status_code=201)
async def create_version(prompt_id: str, data: PromptVersionCreate, db: AsyncSession = Depends(get_db)):
    return await prompt_service.create_version(db, prompt_id, data)


@router.get("/prompts/{prompt_id}/versions", response_model=list[PromptVersionResponse])
async def list_versions(prompt_id: str, db: AsyncSession = Depends(get_db)):
    return await prompt_service.list_versions(db, prompt_id)


@router.put("/prompt-versions/{version_id}", response_model=PromptVersionResponse)
async def update_version(version_id: str, data: PromptVersionUpdate, db: AsyncSession = Depends(get_db)):
    version = await prompt_service.update_version(db, version_id, data)
    if not version:
        raise HTTPException(status_code=404, detail="Prompt version not found")
    return version
