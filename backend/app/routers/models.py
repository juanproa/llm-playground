from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.model_config import ModelConfigCreate, ModelConfigResponse, ModelConfigUpdate
from app.services import model_config_service

router = APIRouter(prefix="/models", tags=["models"])


def _to_response(model) -> ModelConfigResponse:
    return ModelConfigResponse(
        id=model.id,
        name=model.name,
        provider=model.provider,
        model_id=model.model_id,
        namespace=model.namespace,
        base_url=model.base_url,
        max_tokens=model.max_tokens,
        temperature=model.temperature,
        extra_params=model.extra_params,
        adapter_path=model.adapter_path,
        # Legacy rows pre-migration may have NULL even though the column has
        # a default of 1; coerce to True so the UI toggle never lands in an
        # undefined state.
        enable_thinking=bool(getattr(model, "enable_thinking", True) if getattr(model, "enable_thinking", None) is not None else True),
        is_enabled=model.is_enabled,
        has_api_key=model.api_key_encrypted is not None,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


@router.get("", response_model=list[ModelConfigResponse])
async def list_models(db: AsyncSession = Depends(get_db)):
    models = await model_config_service.list_models(db)
    return [_to_response(m) for m in models]


@router.get("/ollama/available")
async def list_ollama_models(base_url: str | None = None):
    from app.providers.ollama import list_ollama_models as fetch_models

    models = await fetch_models(base_url)
    return [
        {"name": m.get("name", ""), "size": m.get("size", 0), "modified_at": m.get("modified_at", "")}
        for m in models
    ]


@router.post("", response_model=ModelConfigResponse, status_code=201)
async def create_model(data: ModelConfigCreate, db: AsyncSession = Depends(get_db)):
    model = await model_config_service.create_model(db, data)
    return _to_response(model)


@router.get("/{model_id}", response_model=ModelConfigResponse)
async def get_model(model_id: str, db: AsyncSession = Depends(get_db)):
    model = await model_config_service.get_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return _to_response(model)


@router.put("/{model_id}", response_model=ModelConfigResponse)
async def update_model(model_id: str, data: ModelConfigUpdate, db: AsyncSession = Depends(get_db)):
    model = await model_config_service.update_model(db, model_id, data)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return _to_response(model)


@router.delete("/{model_id}", status_code=204)
async def delete_model(model_id: str, db: AsyncSession = Depends(get_db)):
    result = await model_config_service.delete_model(db, model_id)
    if result is False:
        raise HTTPException(status_code=404, detail="Model not found")
    if isinstance(result, str):
        raise HTTPException(status_code=409, detail=result)


@router.get("/{model_id}/mlx-status")
async def get_mlx_status(model_id: str, db: AsyncSession = Depends(get_db)):
    """Return MLX load/download status for an mlx_local provider model."""
    model = await model_config_service.get_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if model.provider != "mlx_local":
        raise HTTPException(status_code=400, detail="Not an MLX local model")
    from app.providers.mlx_local import get_status
    return get_status(model.model_id, model.adapter_path)


@router.post("/{model_id}/mlx-preload")
async def preload_mlx(model_id: str, db: AsyncSession = Depends(get_db)):
    """Kick off a background download + load for an mlx_local model."""
    model = await model_config_service.get_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if model.provider != "mlx_local":
        raise HTTPException(status_code=400, detail="Not an MLX local model")
    from app.providers.mlx_local import preload_async
    return preload_async(model.model_id, model.adapter_path)


@router.post("/{model_id}/mlx-unload")
async def unload_mlx(model_id: str, db: AsyncSession = Depends(get_db)):
    """Drop the loaded (model, tokenizer) from memory.  Disk cache is kept."""
    model = await model_config_service.get_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if model.provider != "mlx_local":
        raise HTTPException(status_code=400, detail="Not an MLX local model")
    from app.providers.mlx_local import get_status, unload
    unloaded = unload(model.model_id, model.adapter_path)
    status = get_status(model.model_id, model.adapter_path)
    return {**status, "unloaded": unloaded}


@router.post("/{model_id}/test")
async def test_model(model_id: str, db: AsyncSession = Depends(get_db)):
    model = await model_config_service.get_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    from app.providers.registry import get_provider
    from app.services.model_config_service import decrypt_api_key

    api_key = decrypt_api_key(model.api_key_encrypted) if model.api_key_encrypted else None
    provider = get_provider(model.provider, api_key=api_key, base_url=model.base_url)

    try:
        # Pass enable_thinking from model config so the test respects the setting
        enable_thinking = bool(model.enable_thinking) if model.enable_thinking is not None else True
        response = await provider.generate(
            messages=[{"role": "user", "content": "Say 'hello' in one word."}],
            model_id=model.model_id,
            max_tokens=10,
            temperature=0,
            enable_thinking=enable_thinking,
        )
        return {"status": "ok", "response": response.content}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Connection test failed: {e}")


