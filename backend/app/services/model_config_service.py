from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.model_config import ModelConfig
from app.schemas.model_config import ModelConfigCreate, ModelConfigUpdate


def _get_fernet() -> Fernet | None:
    if settings.ENCRYPTION_KEY:
        return Fernet(settings.ENCRYPTION_KEY.encode())
    return None


def encrypt_api_key(key: str) -> str:
    f = _get_fernet()
    if f:
        return f.encrypt(key.encode()).decode()
    return key


def decrypt_api_key(encrypted: str) -> str:
    f = _get_fernet()
    if f:
        try:
            return f.decrypt(encrypted.encode()).decode()
        except Exception:
            return encrypted
    return encrypted


async def list_models(db: AsyncSession) -> list[ModelConfig]:
    result = await db.execute(select(ModelConfig).order_by(ModelConfig.created_at.desc()))
    return list(result.scalars().all())


async def get_model(db: AsyncSession, model_id: str) -> ModelConfig | None:
    return await db.get(ModelConfig, model_id)


async def create_model(db: AsyncSession, data: ModelConfigCreate) -> ModelConfig:
    model = ModelConfig(
        name=data.name,
        provider=data.provider,
        model_id=data.model_id,
        namespace=data.namespace,
        api_key_encrypted=encrypt_api_key(data.api_key) if data.api_key else None,
        base_url=data.base_url,
        max_tokens=data.max_tokens,
        temperature=data.temperature,
        extra_params=data.extra_params,
        adapter_path=data.adapter_path,
        enable_thinking=data.enable_thinking,
    )
    db.add(model)
    await db.flush()
    return model


async def update_model(db: AsyncSession, model_id: str, data: ModelConfigUpdate) -> ModelConfig | None:
    model = await db.get(ModelConfig, model_id)
    if not model:
        return None
    update_data = data.model_dump(exclude_unset=True)
    if "api_key" in update_data:
        api_key = update_data.pop("api_key")
        if api_key is not None:
            model.api_key_encrypted = encrypt_api_key(api_key)
    for key, value in update_data.items():
        setattr(model, key, value)
    await db.flush()
    return model


async def delete_model(db: AsyncSession, model_id: str) -> bool:
    model = await db.get(ModelConfig, model_id)
    if not model:
        return False
    await db.delete(model)
    await db.flush()
    return True
