from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectUpdate


async def list_projects(db: AsyncSession, search: str | None = None) -> list[Project]:
    query = select(Project).order_by(Project.created_at.desc())
    if search:
        query = query.where(Project.name.ilike(f"%{search}%"))
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_project(db: AsyncSession, project_id: str) -> Project | None:
    return await db.get(Project, project_id)


async def create_project(db: AsyncSession, data: ProjectCreate) -> Project:
    project = Project(name=data.name, description=data.description)
    db.add(project)
    await db.flush()
    return project


async def update_project(db: AsyncSession, project_id: str, data: ProjectUpdate) -> Project | None:
    project = await db.get(Project, project_id)
    if not project:
        return None
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(project, key, value)
    await db.flush()
    return project


async def delete_project(db: AsyncSession, project_id: str) -> bool:
    project = await db.get(Project, project_id)
    if not project:
        return False
    await db.delete(project)
    await db.flush()
    return True
