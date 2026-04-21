from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.document import DocumentPasteCreate, DocumentResponse
from app.services import document_service

router = APIRouter(tags=["documents"])


@router.get("/projects/{project_id}/documents", response_model=list[DocumentResponse])
async def list_documents(project_id: str, db: AsyncSession = Depends(get_db)):
    return await document_service.list_documents(db, project_id)


@router.post("/projects/{project_id}/documents/paste", response_model=DocumentResponse, status_code=201)
async def create_from_paste(
    project_id: str, data: DocumentPasteCreate, db: AsyncSession = Depends(get_db)
):
    return await document_service.create_from_paste(db, project_id, data)


@router.post("/projects/{project_id}/documents/upload", response_model=DocumentResponse, status_code=201)
async def upload_document(
    project_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    content = await file.read()
    return await document_service.create_from_upload(db, project_id, file.filename, content)


@router.get("/documents/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: str, db: AsyncSession = Depends(get_db)):
    doc = await document_service.get_document(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(document_id: str, db: AsyncSession = Depends(get_db)):
    if not await document_service.delete_document(db, document_id):
        raise HTTPException(status_code=404, detail="Document not found")
