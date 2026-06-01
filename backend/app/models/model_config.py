import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import JSON

from app.database import Base


class ModelConfig(Base):
    __tablename__ = "model_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model_id: Mapped[str] = mapped_column(String(255), nullable=False)
    namespace: Mapped[str | None] = mapped_column(String(255), nullable=True)
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    max_tokens: Mapped[int] = mapped_column(Integer, default=4096)
    temperature: Mapped[float] = mapped_column(Float, default=0.7)
    extra_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Optional LoRA adapter path — when set, the provider loads this adapter
    # alongside the base model for inference. Currently honored by the MLX-aware
    # Ollama path and a dedicated MLX local provider.
    adapter_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Per-model toggle for reasoning/thinking mode. Default True = use the
    # model's built-in default (Qwen3, Gemini 2.5, Claude w/extended thinking
    # all default to thinking on when configured for it). When False, the MLX
    # provider sets chat_template_kwargs={"enable_thinking": False} so the
    # model never enters thinking mode — no <think> tags, no wasted output
    # tokens. Providers that don't recognize the kwarg ignore it.
    enable_thinking: Mapped[bool] = mapped_column(Boolean, default=True)
    # Sampling parameters — override the model's defaults at inference time.
    # NULL means "use provider default" (no kwarg sent).
    top_p: Mapped[float | None] = mapped_column(Float, nullable=True)
    top_k: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_p: Mapped[float | None] = mapped_column(Float, nullable=True)
    # YaRN context extension — injects rope_scaling into model config at load time.
    # yarn_factor=4.0 with original_max_position_embeddings=32768 → 131k context.
    yarn_factor: Mapped[float | None] = mapped_column(Float, nullable=True)
    yarn_original_max_position_embeddings: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Quantization parameters stored for reference / mlx_lm.convert command generation only.
    q_bits: Mapped[int | None] = mapped_column(Integer, nullable=True)
    q_group_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # KV cache constraints — passed to mlx_lm.generate / stream_generate at inference time.
    kv_bits: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kv_group_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_kv_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )
