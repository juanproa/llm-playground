"""Local MLX provider that runs inference on Apple Silicon via the mlx_lm library.

Supports optional LoRA adapter loading (adapter_path) so fine-tuned models can be
run without first having to fuse + convert to GGUF.  Useful for rapid iteration
on adapter quality before committing to a full fusion pipeline.

Operational notes:
  * Loaded (model, tokenizer) pairs are cached per (model_id, adapter_path) so
    subsequent inference requests don't re-deserialize the weights every time.
  * HF download environment is tuned for reliability on flaky networks.
"""
from __future__ import annotations

import asyncio
import importlib.util
import logging
import os
import threading
from collections.abc import AsyncIterator

from app.providers.base import LLMResponse

logger = logging.getLogger(__name__)


# Reliability knobs for `huggingface_hub` downloads.  Set before `mlx_lm.load`
# is first called so the values take effect.  Can be overridden via the env.
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "0")


# ── Module-level cache of loaded models ─────────────────────────────────────
# Each entry keyed by (model_id, adapter_path) -> (model, tokenizer).
# Bounded to 1 entry so we don't hold multiple large MLX models in unified
# memory at once.  Raise this only on high-RAM Macs.
_MODEL_CACHE: dict[tuple[str, str | None], tuple] = {}
_MAX_CACHE = 1

# Global mutex for MLX inference: mlx_lm.generate() is not safe to call
# concurrently on the same model and each concurrent generation multiplies KV-
# cache memory, which can OOM-kill Python on smaller machines.  Serialize.
_MLX_INFERENCE_LOCK = threading.Lock()


def _require_mlx():
    if importlib.util.find_spec("mlx_lm") is None:
        raise RuntimeError(
            "mlx_lm is not installed. Install it with: pip install mlx-lm"
        )


def _load_cached(model_id: str, adapter_path: str | None):
    """Return (model, tokenizer) for the given combo, loading if not cached."""
    key = (model_id, adapter_path)
    cached = _MODEL_CACHE.get(key)
    if cached is not None:
        return cached

    _require_mlx()
    from mlx_lm import load  # type: ignore

    logger.info("Loading MLX model %s (adapter=%s) ...", model_id, adapter_path)
    kwargs = {}
    if adapter_path:
        kwargs["adapter_path"] = adapter_path
    pair = load(model_id, **kwargs)

    # Evict oldest entries if over capacity
    while len(_MODEL_CACHE) >= _MAX_CACHE:
        # dict is insertion-ordered — pop the oldest key
        oldest = next(iter(_MODEL_CACHE))
        logger.info("Evicting cached MLX model %s", oldest[0])
        _MODEL_CACHE.pop(oldest, None)

    _MODEL_CACHE[key] = pair
    return pair


def prewarm(model_id: str, adapter_path: str | None = None) -> None:
    """Force-download and cache an MLX model.  Safe to call from a thread."""
    _load_cached(model_id, adapter_path)


# ── Status tracking for preload UI ──────────────────────────────────────────

# Tracks active preload jobs per (model_id, adapter_path) → status dict.
# Status: {"state": "running"|"done"|"error", "error": str | None}
_PRELOAD_STATUS: dict[tuple[str, str | None], dict] = {}


def is_cached_in_memory(model_id: str, adapter_path: str | None = None) -> bool:
    """Return True if model is loaded in memory and ready for instant inference."""
    return (model_id, adapter_path) in _MODEL_CACHE


def unload(model_id: str, adapter_path: str | None = None) -> bool:
    """Drop the cached (model, tokenizer) so its memory can be reclaimed.

    Also clears any preload status entry for this key so it can be re-preloaded.
    Returns True if something was unloaded, False if the model wasn't cached.
    """
    import gc

    key = (model_id, adapter_path)
    removed = _MODEL_CACHE.pop(key, None) is not None
    _PRELOAD_STATUS.pop(key, None)

    if removed:
        # Encourage Python to release the underlying MLX/numpy buffers.
        # MLX uses unified memory; freeing the Python references is the trigger.
        gc.collect()
        # Best-effort: ask MLX to release any cached metal buffers
        try:
            import mlx.core as mx  # type: ignore
            if hasattr(mx.metal, "clear_cache"):
                mx.metal.clear_cache()
        except Exception:
            pass
        logger.info("Unloaded MLX model %s (adapter=%s)", model_id, adapter_path)
    return removed


def is_downloaded(model_id: str) -> bool:
    """Return True if the model's weights have been downloaded to the HF cache.

    We consider a model "downloaded" if its snapshot directory contains any
    *.safetensors file (regular or sharded).
    """
    import os
    # HF cache layout: ~/.cache/huggingface/hub/models--<ns>--<name>/snapshots/<rev>/
    cache_root = os.environ.get("HF_HUB_CACHE") or os.path.expanduser(
        "~/.cache/huggingface/hub"
    )
    safe = "models--" + model_id.replace("/", "--")
    snapshot_dir = os.path.join(cache_root, safe, "snapshots")
    if not os.path.isdir(snapshot_dir):
        return False
    for rev in os.listdir(snapshot_dir):
        rev_path = os.path.join(snapshot_dir, rev)
        if not os.path.isdir(rev_path):
            continue
        for f in os.listdir(rev_path):
            if f.endswith(".safetensors") and not f.endswith(".index.json"):
                # Resolve symlink and ensure the target file has real size
                full = os.path.join(rev_path, f)
                try:
                    if os.path.getsize(full) > 1_000_000:  # > 1 MB = real weights
                        return True
                except OSError:
                    continue
    return False


def get_status(model_id: str, adapter_path: str | None = None) -> dict:
    """Return a JSON-serializable status report for this model."""
    from app.services.mlx_downloader import download_progress

    key = (model_id, adapter_path)
    loaded = is_cached_in_memory(model_id, adapter_path)
    downloaded = is_downloaded(model_id)
    preload = _PRELOAD_STATUS.get(key)

    # Byte-level download progress (populated during curl-based download)
    dl = download_progress(model_id) or {}
    total_bytes = dl.get("total_bytes", 0)
    done_bytes = dl.get("downloaded_bytes", 0)
    pct = int(done_bytes * 100 / total_bytes) if total_bytes else 0

    return {
        "model_id": model_id,
        "adapter_path": adapter_path,
        "loaded": loaded,
        "downloaded": downloaded,
        "preload_state": preload["state"] if preload else None,
        "preload_error": preload.get("error") if preload else None,
        "download_state": dl.get("state"),
        "download_total_bytes": total_bytes,
        "download_done_bytes": done_bytes,
        "download_pct": pct,
        "download_current_file": dl.get("current_file"),
    }


def preload_async(model_id: str, adapter_path: str | None = None) -> dict:
    """Start a background thread that downloads + loads the model.

    Uses the curl-based mlx_downloader first (reliable under HF CDN flakiness),
    then calls mlx_lm.load() from the now-cached files.

    Returns immediately with the current status.  Safe to call multiple times —
    if already running, no-op.
    """
    import threading
    from app.services.mlx_downloader import download_model

    key = (model_id, adapter_path)
    existing = _PRELOAD_STATUS.get(key)
    if existing and existing["state"] == "running":
        return get_status(model_id, adapter_path)

    _PRELOAD_STATUS[key] = {"state": "running", "error": None}

    def _run():
        try:
            # Stage 1: reliably download all repo files via curl
            logger.info("Preload stage 1 — downloading %s via curl", model_id)
            download_model(model_id)
            # Stage 2: load into memory (no network ops since files are cached)
            logger.info("Preload stage 2 — loading %s into memory", model_id)
            _load_cached(model_id, adapter_path)
            _PRELOAD_STATUS[key] = {"state": "done", "error": None}
        except Exception as e:
            logger.exception("Preload failed for %s", model_id)
            _PRELOAD_STATUS[key] = {"state": "error", "error": str(e)}

    threading.Thread(target=_run, daemon=True).start()
    return get_status(model_id, adapter_path)


def _format_prompt(tokenizer, messages: list[dict]) -> str:
    """Format messages using the tokenizer's chat template when available.

    Why this matters: each model has its own turn-separator tokens (e.g.
    Gemma uses <start_of_turn>/<end_of_turn>).  If we don't use the tokenizer's
    template, the model never emits its real EOS token and keeps generating
    until it hits max_tokens — which looks like "streaming forever".
    """
    try:
        if getattr(tokenizer, "chat_template", None):
            return tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
    except Exception as e:
        logger.warning("apply_chat_template failed (%s); falling back to generic format", e)

    # Generic fallback — unlikely to produce a clean EOS for any specific model
    parts: list[str] = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role == "system":
            parts.append(f"<|system|>\n{content}")
        elif role == "user":
            parts.append(f"<|user|>\n{content}")
        else:
            parts.append(f"<|assistant|>\n{content}")
    parts.append("<|assistant|>\n")
    return "\n".join(parts)


class MlxLocalProvider:
    """Runs MLX-LM inference in a thread pool so async callers aren't blocked."""

    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        pass  # no network auth needed

    def _generate_sync(
        self,
        model_id: str,
        messages: list[dict],
        max_tokens: int,
        temperature: float,
        adapter_path: str | None,
    ) -> str:
        _require_mlx()
        from mlx_lm import generate  # type: ignore
        from mlx_lm.sample_utils import make_sampler  # type: ignore

        # Serialize all MLX inference — see _MLX_INFERENCE_LOCK docstring.
        with _MLX_INFERENCE_LOCK:
            model, tokenizer = _load_cached(model_id, adapter_path)
            prompt = _format_prompt(tokenizer, messages)
            sampler = make_sampler(temp=temperature)
            return generate(
                model,
                tokenizer,
                prompt=prompt,
                max_tokens=max_tokens,
                sampler=sampler,
                verbose=False,
            )

    async def generate(
        self,
        messages: list[dict],
        model_id: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        **kwargs,
    ) -> LLMResponse:
        adapter_path = kwargs.pop("adapter_path", None)
        text = await asyncio.to_thread(
            self._generate_sync, model_id, messages, max_tokens, temperature, adapter_path
        )
        # Rough token estimates — MLX doesn't surface usage stats directly
        total_chars = sum(len(m.get("content", "")) for m in messages)
        return LLMResponse(
            content=text,
            input_tokens=total_chars // 4,
            output_tokens=len(text) // 4,
            model=model_id,
        )

    async def stream(
        self,
        messages: list[dict],
        model_id: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        **kwargs,
    ) -> AsyncIterator[str]:
        """Stream MLX-LM output token-by-token via stream_generate."""
        adapter_path = kwargs.pop("adapter_path", None)

        loop = asyncio.get_event_loop()
        queue: asyncio.Queue[str | None] = asyncio.Queue()

        def worker():
            try:
                _require_mlx()
                from mlx_lm import stream_generate  # type: ignore
                from mlx_lm.sample_utils import make_sampler  # type: ignore

                # Serialize all MLX inference — see _MLX_INFERENCE_LOCK docstring.
                with _MLX_INFERENCE_LOCK:
                    model, tokenizer = _load_cached(model_id, adapter_path)
                    prompt = _format_prompt(tokenizer, messages)
                    sampler = make_sampler(temp=temperature)

                    for resp in stream_generate(
                        model,
                        tokenizer,
                        prompt=prompt,
                        max_tokens=max_tokens,
                        sampler=sampler,
                    ):
                        # GenerationResponse.text is the incremental delta
                        chunk = getattr(resp, "text", None) or ""
                        if chunk:
                            asyncio.run_coroutine_threadsafe(queue.put(chunk), loop)
            except Exception as e:
                logger.exception("MLX stream worker failed: %s", e)
                asyncio.run_coroutine_threadsafe(
                    queue.put(f"[MLX error: {e}]"), loop
                )
            finally:
                asyncio.run_coroutine_threadsafe(queue.put(None), loop)

        # Kick off the generator in a thread
        asyncio.create_task(asyncio.to_thread(worker))

        while True:
            chunk = await queue.get()
            if chunk is None:
                break
            yield chunk
