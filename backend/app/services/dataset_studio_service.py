"""Dataset Studio service: curation, transformation, and analysis for SFT datasets (`pt_datasets`).

This service operates on Concept #3 (SFT Dataset) per CLAUDE.md — the project-scoped
`pt_datasets` / `pt_dataset_items` tables used for fine-tuning. All operations are
**non-destructive**: they always create a NEW `pt_dataset` rather than mutating the source.

Features:
1. Regex-based cleanup (built-in rules + user-supplied ephemeral rules)
2. N-way merge with configurable deduplication
3. Tokenizer-based statistics (HF AutoTokenizer per model)
4. Token-count filtering (drop items above a threshold)
"""
from __future__ import annotations

import asyncio
import hashlib
import html
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.post_training import Dataset, DatasetItem

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# CLEANUP RULES
# ═══════════════════════════════════════════════════════════════════════════════
# Each rule is either:
#   - "regex" type: applied via re.sub(pattern, replacement, text, flags)
#   - "function" type: applied via a callable on the text (e.g. HTML entity decode)
#
# Tiers reflect risk/value:
#   1 = Universal, zero-risk (default ON)
#   2 = Fax/OCR boilerplate (default ON)
#   3 = HIPAA legal boilerplate (default ON, large savings)
#   4 = Table/markdown artifacts (default OFF — riskier)
#   5 = OCR noise (default OFF — most risky)


def _decode_html_entities(text: str) -> str:
    """Decode HTML entities: &amp; → &, &quot; → ", etc."""
    return html.unescape(text)


CLEANUP_RULES: list[dict[str, Any]] = [
    # ─── Tier 1: Safe, high-value (default ON) ───
    {
        "id": "image_placeholders",
        "name": "Image placeholders",
        "description": "Remove <!-- image --> markers from Docling/PDF extraction",
        "tier": 1,
        "default_on": True,
        "type": "regex",
        "pattern": r"<!--\s*image\s*-->",
        "replacement": "",
        "flags": 0,
    },
    {
        "id": "html_entities",
        "name": "HTML entities",
        "description": "Decode &amp; → &, &quot; → \", &lt; → <, etc.",
        "tier": 1,
        "default_on": True,
        "type": "function",
        "fn": _decode_html_entities,
    },
    {
        "id": "collapse_newlines",
        "name": "Collapse extra newlines",
        "description": "3+ consecutive newlines → 2",
        "tier": 1,
        "default_on": True,
        "type": "regex",
        "pattern": r"\n{3,}",
        "replacement": "\n\n",
        "flags": 0,
    },
    {
        "id": "collapse_spaces",
        "name": "Collapse spaces/tabs",
        "description": "2+ consecutive spaces or tabs → 1 space",
        "tier": 1,
        "default_on": True,
        "type": "regex",
        "pattern": r"[ \t]{2,}",
        "replacement": " ",
        "flags": 0,
    },
    {
        "id": "trim_line_whitespace",
        "name": "Trim line whitespace",
        "description": "Remove leading/trailing whitespace on each line",
        "tier": 1,
        "default_on": True,
        "type": "regex",
        "pattern": r"^[ \t]+|[ \t]+$",
        "replacement": "",
        "flags": re.MULTILINE,
    },
    # ─── Tier 2: Fax/OCR boilerplate (default ON) ───
    {
        "id": "fax_timestamp",
        "name": "Fax timestamp headers",
        "description": "Lines like '© 01-22-25 4:02 AM IST Fax Services...'",
        "tier": 2,
        "default_on": True,
        "type": "regex",
        "pattern": r"^©\s*\d{1,2}-\d{1,2}-\d{2,4}\s+\d{1,2}:\d{2}\s*[AP]M\s+\w+.*$",
        "replacement": "",
        "flags": re.MULTILINE,
    },
    {
        "id": "fax_server_line",
        "name": "Fax server log lines",
        "description": "Lines like 'Fax Server 1/3/2025 1:39:56 ...'",
        "tier": 2,
        "default_on": True,
        "type": "regex",
        "pattern": r"^Fax\s*[Ss]erver\s+\d{1,2}/\d{1,2}/\d{2,4}.*$",
        "replacement": "",
        "flags": re.MULTILINE,
    },
    {
        "id": "dcn_lines",
        "name": "Document control numbers (RD/DCN)",
        "description": "Lines like 'RD: 2025-02-17 DCN:[ACCOUNT_NUMBER]'",
        "tier": 2,
        "default_on": True,
        "type": "regex",
        "pattern": r"^RD:\s*\d{4}-\d{2}-\d{2}.*DCN:.*$",
        "replacement": "",
        "flags": re.MULTILINE,
    },
    {
        "id": "page_indicators",
        "name": "Page indicators",
        "description": "'pg N of M' inline and standalone 'Page N' lines",
        "tier": 2,
        "default_on": True,
        "type": "regex",
        "pattern": r"\bpg\s+\d+\s+of\s+\d+\b|^Page\s+\d+(?:\s+of\s+\d+)?\s*$",
        "replacement": "",
        "flags": re.MULTILINE,
    },
    # ─── Tier 3: HIPAA boilerplate (default ON, large savings) ───
    {
        "id": "hipaa_fax",
        "name": "HIPAA fax disclaimer",
        "description": "Removes 'IMPORTANT: This facsimile transmission contains confidential...' block",
        "tier": 3,
        "default_on": True,
        "type": "regex",
        "pattern": r"IMPORTANT:?\s*(?:Th[ei]s?\s+)?facsimile transmission contains confidential.*?(?=\n\n|\Z)",
        "replacement": "",
        "flags": re.IGNORECASE | re.DOTALL,
    },
    {
        "id": "hipaa_statement",
        "name": "HIPAA statement block",
        "description": "Removes 'HIPAA Statement: ...' block",
        "tier": 3,
        "default_on": True,
        "type": "regex",
        "pattern": r"HIPAA Statement:.*?(?=\n\n|\Z)",
        "replacement": "",
        "flags": re.IGNORECASE | re.DOTALL,
    },
    {
        "id": "confidentiality_footer",
        "name": "Confidentiality footer",
        "description": "Removes 'Confidential and Personal\\nThis material is intended...' blocks",
        "tier": 3,
        "default_on": True,
        "type": "regex",
        "pattern": r"Confidential(?:ity)?(?:\s+(?:and|&)\s+Personal)?[:\s]*\n+This (?:material|message|communication)\s+is\s+intended.*?(?=\n\n|\Z)",
        "replacement": "",
        "flags": re.IGNORECASE | re.DOTALL,
    },
    {
        "id": "unauthorized_disclosure",
        "name": "Unauthorized disclosure clause",
        "description": "Removes 'Unauthorized re-disclosure...' boilerplate",
        "tier": 3,
        "default_on": True,
        "type": "regex",
        "pattern": r"Unauthorized (?:re-?)?disclosure.*?(?:State law|by law)\.?",
        "replacement": "",
        "flags": re.IGNORECASE | re.DOTALL,
    },
    # ─── Tier 4: Table/markdown artifacts (default OFF — riskier) ───
    {
        "id": "markdown_headers",
        "name": "Markdown header hashes",
        "description": "Strip leading # symbols (keeps text). RISK: loses heading hierarchy",
        "tier": 4,
        "default_on": False,
        "type": "regex",
        "pattern": r"^#{1,6}\s+",
        "replacement": "",
        "flags": re.MULTILINE,
    },
    {
        "id": "table_separators",
        "name": "Markdown table separator rows",
        "description": "Rows like |----|----| — removes structural noise",
        "tier": 4,
        "default_on": False,
        "type": "regex",
        "pattern": r"^\|[\s\-:]+\|.*$",
        "replacement": "",
        "flags": re.MULTILINE,
    },
    {
        "id": "empty_table_cells",
        "name": "Empty repeated table cells",
        "description": "Repeated '| |' empty cells (3+)",
        "tier": 4,
        "default_on": False,
        "type": "regex",
        "pattern": r"(?:\|\s*){3,}\|",
        "replacement": "",
        "flags": 0,
    },
    # ─── Tier 5: OCR noise (default OFF — very risky) ───
    {
        "id": "noise_lines",
        "name": "Non-alphanumeric noise lines",
        "description": "Lines of 3+ chars with NO letters/digits. RISK: may remove valid separators",
        "tier": 5,
        "default_on": False,
        "type": "regex",
        "pattern": r"^[^a-zA-Z0-9\n]{3,}$",
        "replacement": "",
        "flags": re.MULTILINE,
    },
    {
        "id": "tiny_lines",
        "name": "Very short stray lines",
        "description": "Standalone lines of 1-2 chars. RISK: may remove valid short content",
        "tier": 5,
        "default_on": False,
        "type": "regex",
        "pattern": r"^.{1,2}$",
        "replacement": "",
        "flags": re.MULTILINE,
    },
]


def get_cleanup_rules() -> list[dict[str, Any]]:
    """Return the list of cleanup rules (without the callable `fn` field)."""
    return [
        {k: v for k, v in rule.items() if k != "fn"}
        for rule in CLEANUP_RULES
    ]


@dataclass
class CustomRule:
    """User-supplied ephemeral regex rule (not persisted)."""
    pattern: str
    replacement: str = ""
    name: str = "custom"
    flags: int = 0  # caller can pass re.MULTILINE etc; default 0 (or set MULTILINE if pattern starts with ^)


def apply_cleanup(
    text: str | None,
    enabled_rule_ids: set[str],
    custom_rules: list[CustomRule] | None = None,
) -> str:
    """Apply enabled built-in rules and any custom rules to `text`.

    Rules are applied in the order they appear in `CLEANUP_RULES` (Tier 1 first,
    then Tier 2, etc.), with custom rules applied last. This ordering matters
    because earlier rules may simplify text that later rules then operate on.

    Returns the cleaned text (never None — input None → "").
    """
    if not text:
        return ""

    out = text
    for rule in CLEANUP_RULES:
        if rule["id"] not in enabled_rule_ids:
            continue
        if rule["type"] == "function":
            out = rule["fn"](out)
        elif rule["type"] == "regex":
            out = re.sub(
                rule["pattern"], rule["replacement"], out, flags=rule.get("flags", 0)
            )

    if custom_rules:
        for cr in custom_rules:
            try:
                out = re.sub(cr.pattern, cr.replacement, out, flags=cr.flags)
            except re.error as e:
                logger.warning("Invalid custom regex %r: %s", cr.pattern, e)

    # Final tidy: collapse the consecutive blank lines that may now appear where
    # rules removed lines/blocks. Equivalent to re-running the Tier 1 newline
    # collapse — cheap and prevents "removed block leaves 5 blank lines" artifact.
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


# ═══════════════════════════════════════════════════════════════════════════════
# MERGE DATASETS
# ═══════════════════════════════════════════════════════════════════════════════


def _item_hash(item: DatasetItem, key: str = "exact") -> str:
    """Compute a dedup key for an item.

    - "exact":      hash of (instruction, input_text, output_text, system_message)
    - "input_only": hash of (instruction, input_text)  — useful for "latest output wins"
    """
    if key == "input_only":
        material = f"{item.instruction or ''}\x1f{item.input_text or ''}"
    else:  # exact
        material = (
            f"{item.instruction or ''}\x1f"
            f"{item.input_text or ''}\x1f"
            f"{item.output_text or ''}\x1f"
            f"{item.system_message or ''}"
        )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


async def merge_datasets(
    db: AsyncSession,
    *,
    project_id: str,
    source_dataset_ids: list[str],
    new_name: str,
    new_description: str | None = None,
    dedup_strategy: str = "none",  # "none" | "exact" | "input_only"
) -> Dataset:
    """Merge N source datasets into a new SFT dataset (non-destructive).

    Dedup strategies:
      - "none":       keep every item from every source
      - "exact":      drop items whose (instruction, input, output, system) tuple is duplicated
      - "input_only": keep ONE item per unique (instruction, input); later sources win
                      (useful when a later dataset has corrected outputs for same inputs)

    Returns the new Dataset.
    """
    if not source_dataset_ids:
        raise ValueError("At least one source dataset is required")
    if dedup_strategy not in ("none", "exact", "input_only"):
        raise ValueError(f"Invalid dedup_strategy: {dedup_strategy}")

    # Verify all source datasets belong to this project
    src_rows = await db.execute(
        select(Dataset).where(
            Dataset.id.in_(source_dataset_ids),
            Dataset.project_id == project_id,
        )
    )
    sources = list(src_rows.scalars().all())
    if len(sources) != len(set(source_dataset_ids)):
        raise ValueError("One or more source datasets not found in this project")

    # Preserve user-given order: iterate in the order the caller passed them
    sources_by_id = {s.id: s for s in sources}
    ordered_sources = [sources_by_id[sid] for sid in source_dataset_ids if sid in sources_by_id]

    # Create the new dataset
    new_dataset = Dataset(
        project_id=project_id,
        name=new_name,
        description=new_description,
        format=ordered_sources[0].format if ordered_sources else "jsonl",
    )
    db.add(new_dataset)
    await db.flush()

    # Collect items from each source. For "input_only", later items overwrite.
    seen: dict[str, DatasetItem] = {}
    ordered_items: list[DatasetItem] = []

    for src in ordered_sources:
        item_rows = await db.execute(
            select(DatasetItem).where(DatasetItem.dataset_id == src.id).order_by(DatasetItem.created_at)
        )
        for item in item_rows.scalars().all():
            if dedup_strategy == "none":
                ordered_items.append(item)
            elif dedup_strategy == "exact":
                key = _item_hash(item, "exact")
                if key not in seen:
                    seen[key] = item
                    ordered_items.append(item)
            elif dedup_strategy == "input_only":
                key = _item_hash(item, "input_only")
                if key in seen:
                    # Replace the existing item in-place to preserve order
                    idx = ordered_items.index(seen[key])
                    ordered_items[idx] = item
                else:
                    ordered_items.append(item)
                seen[key] = item

    # Insert the merged items as fresh rows (don't share PKs)
    for src_item in ordered_items:
        new_item = DatasetItem(
            dataset_id=new_dataset.id,
            name=src_item.name,
            instruction=src_item.instruction,
            input_text=src_item.input_text,
            output_text=src_item.output_text,
            system_message=src_item.system_message,
            tags=src_item.tags,
            metadata_json=src_item.metadata_json,
            source_test_case_id=src_item.source_test_case_id,
            parent_item_id=src_item.parent_item_id,
            verified_status=src_item.verified_status,
        )
        db.add(new_item)

    new_dataset.item_count = len(ordered_items)
    await db.flush()
    await db.refresh(new_dataset)
    return new_dataset


# ═══════════════════════════════════════════════════════════════════════════════
# TOKENIZER & STATS
# ═══════════════════════════════════════════════════════════════════════════════
# We use HuggingFace AutoTokenizer for accurate per-model counts. The first load
# of each model downloads the tokenizer (~5-50MB) — subsequent loads come from
# the local HF cache. We additionally keep an in-process LRU so the same model
# isn't re-loaded across requests.

_TOKENIZER_CACHE: dict[str, Any] = {}
_TOKENIZER_LOCK = asyncio.Lock()


async def _get_tokenizer(model_id: str):
    """Load (or fetch from cache) the HuggingFace tokenizer for `model_id`.

    `model_id` should be an HF repo id (e.g. "Qwen/Qwen3-4B-FP8") or a local
    path. If loading fails (model not on HF, no internet, etc.) returns None.
    """
    if model_id in _TOKENIZER_CACHE:
        return _TOKENIZER_CACHE[model_id]

    async with _TOKENIZER_LOCK:
        if model_id in _TOKENIZER_CACHE:
            return _TOKENIZER_CACHE[model_id]

        try:
            # Import lazily — transformers is heavy
            from transformers import AutoTokenizer

            # `trust_remote_code=True` is required for some models (Qwen,
            # certain Gemma variants) that ship custom tokenizer code.
            tokenizer = await asyncio.to_thread(
                AutoTokenizer.from_pretrained, model_id, trust_remote_code=True
            )
            _TOKENIZER_CACHE[model_id] = tokenizer
            return tokenizer
        except Exception as e:
            logger.warning("Failed to load tokenizer for %s: %s", model_id, e)
            return None


def _count_tokens_sync(tokenizer, text: str) -> int:
    """Run tokenizer.encode in a thread-safe way."""
    if not text:
        return 0
    try:
        return len(tokenizer.encode(text, add_special_tokens=False))
    except Exception:
        return 0


def _percentiles(values: list[int], pcts: list[int]) -> dict[str, int]:
    """Return P{n} for each n in pcts. `values` need not be sorted."""
    if not values:
        return {f"p{p}": 0 for p in pcts}
    sorted_v = sorted(values)
    n = len(sorted_v)
    out = {}
    for p in pcts:
        # Linear-interp percentile (numpy-style "linear" interpolation)
        rank = (p / 100.0) * (n - 1)
        lo = int(rank)
        hi = min(lo + 1, n - 1)
        frac = rank - lo
        out[f"p{p}"] = int(sorted_v[lo] * (1 - frac) + sorted_v[hi] * frac)
    return out


async def compute_token_stats(
    db: AsyncSession,
    *,
    dataset_id: str,
    model_id: str,
) -> dict[str, Any]:
    """Tokenize every item's combined text and return distribution statistics.

    The "combined text" is `instruction + input_text + output_text + system_message`
    (the actual material the trainer sees). This matches the natural unit of
    measurement for "is this item too long?"

    Returns:
        {
            "total_items": int,
            "tokenizer_loaded": bool,
            "stats": {"min", "max", "mean", "p50", "p75", "p90", "p95", "p99"},
            "items": [{"id", "name", "token_count"} ...]  // sorted desc by tokens
            "histogram": {"bin_edges": [...], "counts": [...]}
        }
    """
    tokenizer = await _get_tokenizer(model_id)

    rows = await db.execute(
        select(DatasetItem).where(DatasetItem.dataset_id == dataset_id)
    )
    items = list(rows.scalars().all())

    if not tokenizer:
        return {
            "total_items": len(items),
            "tokenizer_loaded": False,
            "model_id": model_id,
            "stats": {},
            "items": [],
            "histogram": {"bin_edges": [], "counts": []},
            "error": f"Could not load tokenizer for '{model_id}'. Check the model id and that it exists on HuggingFace.",
        }

    # Tokenize off the event loop — tokenizers are CPU-bound
    def _tokenize_all() -> list[tuple[str, str | None, int]]:
        result = []
        for it in items:
            combined = "\n".join(
                s for s in [it.system_message, it.instruction, it.input_text, it.output_text] if s
            )
            result.append((it.id, it.name, _count_tokens_sync(tokenizer, combined)))
        return result

    counted = await asyncio.to_thread(_tokenize_all)
    counts = [c for (_, _, c) in counted]

    if not counts:
        return {
            "total_items": 0,
            "tokenizer_loaded": True,
            "model_id": model_id,
            "stats": {},
            "items": [],
            "histogram": {"bin_edges": [], "counts": []},
        }

    pct = _percentiles(counts, [50, 75, 90, 95, 99])
    stats = {
        "min": int(min(counts)),
        "max": int(max(counts)),
        "mean": int(sum(counts) / len(counts)),
        **pct,
    }

    # Histogram: 20 bins from 0 → max (rounded up to nearest 500 for nice edges)
    max_tok = max(counts)
    bin_count = 20
    bin_size = max(1, (max_tok // bin_count) + 1)
    bin_edges = [i * bin_size for i in range(bin_count + 1)]
    hist_counts = [0] * bin_count
    for c in counts:
        idx = min(c // bin_size, bin_count - 1)
        hist_counts[idx] += 1

    # Sort items by token count descending (outliers first for the UI to highlight)
    sorted_items = sorted(counted, key=lambda t: t[2], reverse=True)
    items_payload = [
        {"id": iid, "name": name, "token_count": c} for (iid, name, c) in sorted_items
    ]

    return {
        "total_items": len(items),
        "tokenizer_loaded": True,
        "model_id": model_id,
        "stats": stats,
        "items": items_payload,
        "histogram": {"bin_edges": bin_edges, "counts": hist_counts},
    }


# ═══════════════════════════════════════════════════════════════════════════════
# FILTER BY TOKEN COUNT
# ═══════════════════════════════════════════════════════════════════════════════


async def filter_by_tokens(
    db: AsyncSession,
    *,
    project_id: str,
    source_dataset_id: str,
    model_id: str,
    max_tokens: int,
    new_name: str,
    new_description: str | None = None,
) -> tuple[Dataset, dict[str, int]]:
    """Create a new SFT dataset containing only items with token_count <= max_tokens.

    Returns (new_dataset, {"kept": N, "dropped": M, "total": T}).
    """
    if max_tokens <= 0:
        raise ValueError("max_tokens must be positive")

    src = await db.get(Dataset, source_dataset_id)
    if not src or src.project_id != project_id:
        raise ValueError("Source dataset not found in this project")

    tokenizer = await _get_tokenizer(model_id)
    if not tokenizer:
        raise ValueError(f"Could not load tokenizer for '{model_id}'")

    rows = await db.execute(
        select(DatasetItem).where(DatasetItem.dataset_id == source_dataset_id)
    )
    items = list(rows.scalars().all())

    def _filter() -> list[DatasetItem]:
        kept = []
        for it in items:
            combined = "\n".join(
                s for s in [it.system_message, it.instruction, it.input_text, it.output_text] if s
            )
            if _count_tokens_sync(tokenizer, combined) <= max_tokens:
                kept.append(it)
        return kept

    kept_items = await asyncio.to_thread(_filter)

    new_dataset = Dataset(
        project_id=project_id,
        name=new_name,
        description=new_description,
        format=src.format,
    )
    db.add(new_dataset)
    await db.flush()

    for src_item in kept_items:
        db.add(DatasetItem(
            dataset_id=new_dataset.id,
            name=src_item.name,
            instruction=src_item.instruction,
            input_text=src_item.input_text,
            output_text=src_item.output_text,
            system_message=src_item.system_message,
            tags=src_item.tags,
            metadata_json=src_item.metadata_json,
            source_test_case_id=src_item.source_test_case_id,
            parent_item_id=src_item.parent_item_id,
            verified_status=src_item.verified_status,
        ))

    new_dataset.item_count = len(kept_items)
    await db.flush()
    await db.refresh(new_dataset)

    stats = {
        "kept": len(kept_items),
        "dropped": len(items) - len(kept_items),
        "total": len(items),
    }
    return new_dataset, stats


# ═══════════════════════════════════════════════════════════════════════════════
# APPLY CLEANUP TO A DATASET
# ═══════════════════════════════════════════════════════════════════════════════


async def apply_cleanup_to_dataset(
    db: AsyncSession,
    *,
    project_id: str,
    source_dataset_id: str,
    enabled_rule_ids: set[str],
    custom_rules: list[CustomRule],
    new_name: str,
    new_description: str | None = None,
) -> tuple[Dataset, dict[str, int]]:
    """Apply cleanup rules to every item in a source dataset, write results to a new dataset.

    Cleanup is applied to `input_text` ONLY (NOT to instruction or output_text):
      - `instruction` is the prompt template — must remain identical
      - `output_text` is the training target — never mutate
      - `system_message` is the system prompt — never mutate

    Returns (new_dataset, {"items": N, "input_chars_before": X, "input_chars_after": Y}).
    """
    src = await db.get(Dataset, source_dataset_id)
    if not src or src.project_id != project_id:
        raise ValueError("Source dataset not found in this project")

    rows = await db.execute(
        select(DatasetItem).where(DatasetItem.dataset_id == source_dataset_id)
    )
    items = list(rows.scalars().all())

    new_dataset = Dataset(
        project_id=project_id,
        name=new_name,
        description=new_description,
        format=src.format,
    )
    db.add(new_dataset)
    await db.flush()

    chars_before = 0
    chars_after = 0
    for src_item in items:
        before = src_item.input_text or ""
        after = apply_cleanup(before, enabled_rule_ids, custom_rules)
        chars_before += len(before)
        chars_after += len(after)

        db.add(DatasetItem(
            dataset_id=new_dataset.id,
            name=src_item.name,
            instruction=src_item.instruction,
            input_text=after,
            output_text=src_item.output_text,
            system_message=src_item.system_message,
            tags=src_item.tags,
            metadata_json=src_item.metadata_json,
            source_test_case_id=src_item.source_test_case_id,
            parent_item_id=src_item.parent_item_id,
            verified_status=src_item.verified_status,
        ))

    new_dataset.item_count = len(items)
    await db.flush()
    await db.refresh(new_dataset)

    return new_dataset, {
        "items": len(items),
        "input_chars_before": chars_before,
        "input_chars_after": chars_after,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CLEANUP PREVIEW (dry-run on N sample items)
# ═══════════════════════════════════════════════════════════════════════════════


async def preview_cleanup(
    db: AsyncSession,
    *,
    project_id: str,
    source_dataset_id: str,
    enabled_rule_ids: set[str],
    custom_rules: list[CustomRule],
    sample_size: int = 3,
) -> dict[str, Any]:
    """Run cleanup on the FIRST N items (deterministic) and return before/after.

    The UI uses this to render a diff before the user commits to applying the
    transformation to the whole dataset.
    """
    src = await db.get(Dataset, source_dataset_id)
    if not src or src.project_id != project_id:
        raise ValueError("Source dataset not found in this project")

    rows = await db.execute(
        select(DatasetItem)
        .where(DatasetItem.dataset_id == source_dataset_id)
        .order_by(DatasetItem.created_at)
        .limit(sample_size)
    )
    items = list(rows.scalars().all())

    samples = []
    for it in items:
        before = it.input_text or ""
        after = apply_cleanup(before, enabled_rule_ids, custom_rules)
        samples.append({
            "id": it.id,
            "name": it.name,
            "before": before,
            "after": after,
            "chars_before": len(before),
            "chars_after": len(after),
        })

    # Aggregate savings over the WHOLE dataset (chars only — cheap; tokens require
    # a tokenizer call per item which we save for the dedicated stats endpoint).
    all_rows = await db.execute(
        select(DatasetItem.input_text).where(DatasetItem.dataset_id == source_dataset_id)
    )
    all_inputs = [r[0] or "" for r in all_rows.all()]
    total_before = sum(len(s) for s in all_inputs)
    total_after = sum(
        len(apply_cleanup(s, enabled_rule_ids, custom_rules)) for s in all_inputs
    )

    return {
        "samples": samples,
        "total_chars_before": total_before,
        "total_chars_after": total_after,
        "total_items": len(all_inputs),
        "estimated_savings_pct": (
            round((1 - total_after / total_before) * 100, 1) if total_before > 0 else 0.0
        ),
    }
