"""PII detection using mlx-community/openai-privacy-filter-bf16.

Uses mlx-embeddings (>=0.1.1) which provides the correct OpenAIPrivacyFilter
architecture implementation including the custom PrivacyFilterSwiGLU activation,
proper MoE weight normalisation, and bidirectional sliding-window attention.

BIOES labels: O + {B,I,E,S}-{account_number, private_address, private_date,
  private_email, private_person, private_phone, private_url, secret}  → 33 total.
"""
from __future__ import annotations

import logging
import os
import threading

logger = logging.getLogger(__name__)

PII_MODEL_ID = "mlx-community/openai-privacy-filter-bf16"

_MODEL_CACHE: tuple | None = None   # (model, id2label, tokenizer)
_MODEL_LOCK = threading.Lock()
_INFER_LOCK = threading.Lock()
_PRELOAD_STATUS: dict = {}


# ── HF-cache helpers ──────────────────────────────────────────────────────────

def _snapshot_dir() -> str | None:
    cache_root = os.environ.get("HF_HUB_CACHE") or os.path.expanduser(
        "~/.cache/huggingface/hub"
    )
    dir_name = "models--" + PII_MODEL_ID.replace("/", "--")
    snapshots = os.path.join(cache_root, dir_name, "snapshots")
    if not os.path.isdir(snapshots):
        return None
    revs = [r for r in os.listdir(snapshots) if os.path.isdir(os.path.join(snapshots, r))]
    return os.path.join(snapshots, revs[0]) if revs else None


def is_downloaded() -> bool:
    snap = _snapshot_dir()
    if not snap:
        return False
    for f in os.listdir(snap):
        if f.endswith(".safetensors") and not f.endswith(".index.json"):
            full = os.path.join(snap, f)
            try:
                if os.path.getsize(full) > 1_000_000:
                    return True
            except OSError:
                pass
    return False


def is_loaded() -> bool:
    return _MODEL_CACHE is not None


def get_status() -> dict:
    ps = _PRELOAD_STATUS.copy()
    return {
        "model_id": PII_MODEL_ID,
        "loaded": is_loaded(),
        "downloaded": is_downloaded(),
        "preload_state": ps.get("state"),
        "preload_error": ps.get("error"),
    }


# ── Load ──────────────────────────────────────────────────────────────────────

def _load() -> tuple:
    global _MODEL_CACHE
    with _MODEL_LOCK:
        if _MODEL_CACHE is None:
            from mlx_embeddings.utils import load as mlx_load  # type: ignore

            snap = _snapshot_dir()
            if snap is None:
                raise RuntimeError(f"Model {PII_MODEL_ID} is not downloaded.")

            logger.info("Loading PII filter model from %s …", snap)
            model, tokenizer = mlx_load(snap)
            id2label: dict[str, str] = {
                str(k): v for k, v in model.config.id2label.items()
            }
            _MODEL_CACHE = (model, id2label, tokenizer)
            logger.info("PII filter model ready.")
    return _MODEL_CACHE


def preload_async() -> dict:
    if _PRELOAD_STATUS.get("state") == "running":
        return get_status()

    _PRELOAD_STATUS.update({"state": "running", "error": None})

    def _run():
        try:
            _load()
            _PRELOAD_STATUS.update({"state": "done", "error": None})
        except Exception as e:
            logger.exception("PII filter preload failed")
            _PRELOAD_STATUS.update({"state": "error", "error": str(e)})

    threading.Thread(target=_run, daemon=True, name="pii-preload").start()
    return get_status()


# ── Inference ─────────────────────────────────────────────────────────────────

def _entity_from_label(label: str) -> str | None:
    """'B-private_email' → 'private_email', 'O' → None."""
    if label == "O":
        return None
    return label.split("-", 1)[-1] if "-" in label else None


def detect_and_mask(text: str) -> dict:
    """Detect PII spans and return masked version.

    Returns:
        {"has_pii": bool, "masked_content": str | None, "pii_types": list[str]}
    """
    import mlx.core as mx

    model, id2label, tokenizer = _load()

    enc = tokenizer(
        text,
        return_tensors="mlx",
        return_offsets_mapping=True,
        truncation=True,
        max_length=2048,
    )

    input_ids = enc["input_ids"]
    attention_mask = enc["attention_mask"]
    offsets_raw = enc["offset_mapping"]          # (1, T, 2) mlx int32

    with _INFER_LOCK:
        outputs = model(input_ids, attention_mask=attention_mask)
        preds = mx.argmax(outputs.logits, axis=-1)[0]
        mx.eval(preds, offsets_raw)

    preds_list: list[int] = preds.tolist()
    offsets: list[tuple[int, int]] = [
        (int(offsets_raw[0, i, 0]), int(offsets_raw[0, i, 1]))
        for i in range(offsets_raw.shape[1])
    ]

    # Build character-span list (group consecutive same-entity tokens)
    pii_spans: list[tuple[int, int, str]] = []
    current_ent: str | None = None
    span_start: int | None = None
    span_end: int | None = None

    for (char_start, char_end), pred in zip(offsets, preds_list):
        label = id2label[str(pred)]
        ent = _entity_from_label(label)

        # Special tokens have offset (0, 0) — flush + skip
        if char_start == 0 and char_end == 0:
            if current_ent is not None and span_start is not None:
                pii_spans.append((span_start, span_end, current_ent))  # type: ignore[arg-type]
            current_ent = span_start = span_end = None
            continue

        if ent == current_ent and ent is not None:
            span_end = char_end          # extend current span
        else:
            if current_ent is not None and span_start is not None:
                pii_spans.append((span_start, span_end, current_ent))  # type: ignore[arg-type]
            current_ent = ent
            span_start = char_start if ent else None
            span_end = char_end if ent else None

    if current_ent is not None and span_start is not None:
        pii_spans.append((span_start, span_end, current_ent))  # type: ignore[arg-type]

    if not pii_spans:
        return {"has_pii": False, "masked_content": None, "pii_types": []}

    # Replace right-to-left so earlier offsets stay valid
    masked = text
    pii_types: set[str] = set()
    for char_start, char_end, ent in sorted(pii_spans, key=lambda x: x[0], reverse=True):
        placeholder = f"[{ent.upper()}]"
        masked = masked[:char_start] + placeholder + masked[char_end:]
        pii_types.add(ent)

    return {"has_pii": True, "masked_content": masked, "pii_types": sorted(pii_types)}
