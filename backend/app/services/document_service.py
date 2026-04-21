import asyncio
import os
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.document import Document
from app.schemas.document import DocumentPasteCreate
from app.services.pdf_parser import parse_pdf


async def list_documents(db: AsyncSession, project_id: str) -> list[Document]:
    result = await db.execute(
        select(Document).where(Document.project_id == project_id).order_by(Document.created_at.desc())
    )
    return list(result.scalars().all())


async def get_document(db: AsyncSession, document_id: str) -> Document | None:
    return await db.get(Document, document_id)


async def create_from_paste(db: AsyncSession, project_id: str, data: DocumentPasteCreate) -> Document:
    doc = Document(
        project_id=project_id,
        name=data.name,
        source_type="paste",
        raw_text=data.content,
        parse_status="completed",
    )
    db.add(doc)
    await db.flush()
    return doc


async def create_from_upload(
    db: AsyncSession, project_id: str, filename: str, file_content: bytes
) -> Document:
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(filename)[1]
    save_path = os.path.join(settings.UPLOADS_DIR, f"{file_id}{ext}")
    with open(save_path, "wb") as f:
        f.write(file_content)

    doc = Document(
        project_id=project_id,
        name=filename,
        source_type="pdf_upload",
        file_path=save_path,
        mime_type="application/pdf",
        file_size_bytes=len(file_content),
        parse_status="processing",
    )
    db.add(doc)
    await db.flush()

    # Parse in background thread
    try:
        text = await asyncio.to_thread(parse_pdf, save_path)
        doc.raw_text = text
        doc.parse_status = "completed"
    except Exception as e:
        doc.parse_status = "failed"
        doc.parse_error = str(e)
    await db.flush()
    return doc


async def delete_document(db: AsyncSession, document_id: str) -> bool:
    doc = await db.get(Document, document_id)
    if not doc:
        return False
    if doc.file_path and os.path.exists(doc.file_path):
        os.remove(doc.file_path)
    await db.delete(doc)
    await db.flush()
    return True
