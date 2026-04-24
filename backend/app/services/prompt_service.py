from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.prompt import Prompt, PromptVersion
from app.schemas.prompt import PromptCreate, PromptUpdate, PromptVersionCreate, PromptVersionUpdate


async def list_prompts(db: AsyncSession, project_id: str) -> list[Prompt]:
    result = await db.execute(
        select(Prompt)
        .where(Prompt.project_id == project_id)
        .options(selectinload(Prompt.versions))
        .order_by(Prompt.created_at.desc())
    )
    return list(result.scalars().all())


async def get_prompt(db: AsyncSession, prompt_id: str) -> Prompt | None:
    result = await db.execute(
        select(Prompt).where(Prompt.id == prompt_id).options(selectinload(Prompt.versions))
    )
    return result.scalar_one_or_none()


async def create_prompt(db: AsyncSession, project_id: str, data: PromptCreate) -> Prompt:
    prompt = Prompt(project_id=project_id, name=data.name)
    db.add(prompt)
    await db.flush()

    version = PromptVersion(
        prompt_id=prompt.id,
        version_number=1,
        label=data.label,
        content=data.content,
        system_message=data.system_message,
        is_active=True,
    )
    db.add(version)
    await db.flush()

    result = await db.execute(
        select(Prompt).where(Prompt.id == prompt.id).options(selectinload(Prompt.versions))
    )
    return result.scalar_one()


async def update_prompt(db: AsyncSession, prompt_id: str, data: PromptUpdate) -> Prompt | None:
    prompt = await db.get(Prompt, prompt_id)
    if not prompt:
        return None
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(prompt, key, value)
    await db.flush()
    return prompt


async def delete_prompt(db: AsyncSession, prompt_id: str) -> bool:
    prompt = await db.get(Prompt, prompt_id)
    if not prompt:
        return False
    await db.delete(prompt)
    await db.flush()
    return True


async def create_version(db: AsyncSession, prompt_id: str, data: PromptVersionCreate) -> PromptVersion:
    result = await db.execute(
        select(func.max(PromptVersion.version_number)).where(PromptVersion.prompt_id == prompt_id)
    )
    max_version = result.scalar() or 0

    # Carry over the prior active version's RAG binding so that iterating on
    # wording doesn't silently lose the attached KB.
    inherited_kb: str | None = None
    inherited_top_k: int = 5
    if data.kb_id is None and data.kb_top_k is None:
        prev = await db.execute(
            select(PromptVersion)
            .where(PromptVersion.prompt_id == prompt_id, PromptVersion.is_active == True)
        )
        active = prev.scalar_one_or_none()
        if active is not None:
            inherited_kb = active.kb_id
            inherited_top_k = active.kb_top_k or 5

    version = PromptVersion(
        prompt_id=prompt_id,
        version_number=max_version + 1,
        label=data.label,
        content=data.content,
        system_message=data.system_message,
        is_active=False,
        kb_id=data.kb_id if data.kb_id is not None else inherited_kb,
        kb_top_k=data.kb_top_k if data.kb_top_k is not None else inherited_top_k,
    )
    db.add(version)
    await db.flush()
    return version


async def list_versions(db: AsyncSession, prompt_id: str) -> list[PromptVersion]:
    result = await db.execute(
        select(PromptVersion)
        .where(PromptVersion.prompt_id == prompt_id)
        .order_by(PromptVersion.version_number.desc())
    )
    return list(result.scalars().all())


async def update_version(db: AsyncSession, version_id: str, data: PromptVersionUpdate) -> PromptVersion | None:
    version = await db.get(PromptVersion, version_id)
    if not version:
        return None

    if data.is_active is True:
        await db.execute(
            select(PromptVersion)
            .where(PromptVersion.prompt_id == version.prompt_id, PromptVersion.is_active == True)
        )
        result = await db.execute(
            select(PromptVersion).where(
                PromptVersion.prompt_id == version.prompt_id, PromptVersion.is_active == True
            )
        )
        for v in result.scalars().all():
            v.is_active = False

    payload = data.model_dump(exclude_unset=True)
    # `clear_kb` is a sentinel — translate it to kb_id=None and drop the flag.
    if payload.pop("clear_kb", False):
        version.kb_id = None
    for key, value in payload.items():
        setattr(version, key, value)
    await db.flush()
    return version
