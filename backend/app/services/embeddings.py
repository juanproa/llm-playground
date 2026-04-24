"""Embedding provider abstraction.

Two backends are wired:

  * mlx_local  — uses the `mlx-embeddings` package (installed on demand) to
    run Qwen3-Embedding (or any other supported MLX embedding model) on-device.
    Chosen as the default since it matches the rest of the MLX-based project.
  * openai    — calls the OpenAI embeddings API (`text-embedding-3-small`
    by default). Requires OPENAI_API_KEY in the environment.

Embeddings are returned as numpy float32 arrays. Callers pack them via
`.tobytes()` before writing to the `KnowledgeBaseChunk.embedding` column, and
unpack with `np.frombuffer(..., dtype=np.float32)`.

The MLX model is cached in-process (loading Qwen3-Embedding-0.6B-4bit-DWQ
takes a few seconds and eats memory — we don't want to reload per request).
"""
from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from typing import Protocol

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class EmbedResult:
    vectors: np.ndarray  # shape (n, dim), dtype float32, L2-normalized
    dim: int


class Embedder(Protocol):
    async def embed(self, texts: list[str]) -> EmbedResult: ...
    def close(self) -> None: ...


# ── MLX local backend ──────────────────────────────────────────────────────

_MLX_CACHE: dict[str, tuple] = {}  # model_id -> (model, tokenizer)
_MLX_LOCK = threading.Lock()


def _load_mlx_embedder(model_id: str):
    """Load (model, tokenizer) from `mlx-embeddings`. Cached per model_id."""
    cached = _MLX_CACHE.get(model_id)
    if cached is not None:
        return cached

    try:
        from mlx_embeddings.utils import load as mlx_load  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "mlx-embeddings is not installed. Install it with: "
            "pip install mlx-embeddings"
        ) from e

    logger.info("Loading MLX embedding model %s ...", model_id)
    model, tokenizer = mlx_load(model_id)
    _MLX_CACHE[model_id] = (model, tokenizer)
    return model, tokenizer


def _mlx_embed_sync(model_id: str, texts: list[str]) -> np.ndarray:
    """Encode texts with an MLX embedding model, returning L2-normalized vectors.

    Serialized globally because MLX generation/embedding is not concurrency-safe
    and we don't want multiple requests loading the model at once.
    """
    import mlx.core as mx  # type: ignore

    with _MLX_LOCK:
        model, tokenizer = _load_mlx_embedder(model_id)

        # Tokenize with padding so we can batch. `mlx-embeddings` tokenizers
        # accept the standard HF-style call signature.
        enc = tokenizer(
            texts,
            return_tensors="mlx",
            padding=True,
            truncation=True,
            max_length=512,
        )

        input_ids = enc["input_ids"] if isinstance(enc, dict) else enc.input_ids
        attn = (enc.get("attention_mask") if isinstance(enc, dict) else getattr(enc, "attention_mask", None))
        out = model(input_ids, attention_mask=attn)

        # mlx-embeddings exposes normalized pooled output as `text_embeds` on
        # the supported models (Qwen3/BGE/etc.). Fall back to mean-pooling the
        # last hidden state if that field isn't present.
        embeds = getattr(out, "text_embeds", None)
        if embeds is None:
            hidden = out.last_hidden_state  # (batch, seq, dim)
            if attn is not None:
                m = mx.expand_dims(attn, -1).astype(hidden.dtype)
                summed = (hidden * m).sum(axis=1)
                counts = m.sum(axis=1)
                embeds = summed / mx.maximum(counts, 1e-9)
            else:
                embeds = hidden.mean(axis=1)
            # L2 normalize
            norms = mx.sqrt((embeds * embeds).sum(axis=-1, keepdims=True))
            embeds = embeds / mx.maximum(norms, 1e-9)

        # MLX models may output bfloat16; numpy's buffer protocol doesn't
        # understand bf16, so we explicitly cast to float32 inside MLX before
        # handing the array over. Without this cast, `np.array(embeds, ...)`
        # raises "Item size 2 for PEP 3118 buffer format string B does not
        # match the dtype B item size 1."
        embeds = embeds.astype(mx.float32)
        mx.eval(embeds)
        arr = np.array(embeds, copy=True)

    return arr


class MlxLocalEmbedder:
    def __init__(self, model_id: str):
        self.model_id = model_id
        self._dim: int | None = None

    async def embed(self, texts: list[str]) -> EmbedResult:
        import asyncio

        if not texts:
            return EmbedResult(vectors=np.zeros((0, self._dim or 0), dtype=np.float32), dim=self._dim or 0)

        arr = await asyncio.to_thread(_mlx_embed_sync, self.model_id, texts)
        self._dim = arr.shape[1]
        return EmbedResult(vectors=arr, dim=self._dim)

    def close(self) -> None:
        pass


# ── OpenAI backend ─────────────────────────────────────────────────────────

_OPENAI_DIMS = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
}


class OpenAIEmbedder:
    def __init__(self, model_id: str, api_key: str | None = None):
        import openai

        self.model_id = model_id
        self.client = openai.AsyncOpenAI(api_key=api_key or os.environ.get("OPENAI_API_KEY"))

    async def embed(self, texts: list[str]) -> EmbedResult:
        if not texts:
            dim = _OPENAI_DIMS.get(self.model_id, 0)
            return EmbedResult(vectors=np.zeros((0, dim), dtype=np.float32), dim=dim)

        resp = await self.client.embeddings.create(model=self.model_id, input=texts)
        vectors = np.asarray([d.embedding for d in resp.data], dtype=np.float32)
        # OpenAI embeddings are already L2-normalized but re-normalize defensively
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        vectors = vectors / norms
        return EmbedResult(vectors=vectors, dim=vectors.shape[1])

    def close(self) -> None:
        pass


# ── Factory ────────────────────────────────────────────────────────────────

def get_embedder(provider: str, model_id: str, api_key: str | None = None) -> Embedder:
    if provider == "mlx_local":
        return MlxLocalEmbedder(model_id)
    if provider == "openai":
        return OpenAIEmbedder(model_id, api_key=api_key)
    raise ValueError(f"Unknown embedding provider: {provider}")


# ── Curated catalog ────────────────────────────────────────────────────────

AVAILABLE_EMBEDDING_MODELS = [
    {
        "provider": "mlx_local",
        "model_id": "mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ",
        "display_name": "Qwen3-Embedding 0.6B (MLX 4bit-DWQ, local)",
        "dim": 1024,
        "notes": "Default. Runs on-device via MLX. ~400 MB.",
    },
    {
        "provider": "openai",
        "model_id": "text-embedding-3-small",
        "display_name": "OpenAI text-embedding-3-small",
        "dim": 1536,
        "notes": "Requires OPENAI_API_KEY in env.",
    },
    {
        "provider": "openai",
        "model_id": "text-embedding-3-large",
        "display_name": "OpenAI text-embedding-3-large",
        "dim": 3072,
        "notes": "Requires OPENAI_API_KEY in env. Higher quality, higher cost.",
    },
]


# ── Similarity helpers ─────────────────────────────────────────────────────

def cosine_top_k(query_vec: np.ndarray, matrix: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Return (indices, scores) for top-k cosine similarity matches.

    Assumes both `query_vec` (shape (dim,)) and `matrix` (shape (n, dim)) are
    L2-normalized, so similarity == dot product. That matches how embedders
    here return vectors.
    """
    if matrix.size == 0:
        return np.array([], dtype=np.int64), np.array([], dtype=np.float32)

    scores = matrix @ query_vec
    k = min(k, scores.shape[0])
    # argpartition is O(n); we then sort only the k picked indices
    idx = np.argpartition(-scores, k - 1)[:k]
    idx_sorted = idx[np.argsort(-scores[idx])]
    return idx_sorted, scores[idx_sorted]
