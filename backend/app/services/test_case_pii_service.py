"""PII-safe access to TestCase input data.

Two parallel masking sources can apply to a TestCase:

  1. The test case's own `pii_status` / `pii_masked_content` — set when masking
     was run directly on the test case via the `/test-cases/mask-pii` endpoint.
  2. The linked `InputDatasetItem`'s mask — set when masking was run on the
     source dataset.

Either is sufficient. Precedence: own mask wins (more direct, set explicitly
for this test case); the dataset-source mask is the fallback.

This module is the single source of truth for that resolution. Any code path
that reads `TestCase.input_text` and either sends it to a model or returns it
to the frontend MUST go through these helpers; otherwise raw PII can leak.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.input_dataset import InputDatasetItem
from app.models.post_training import TestCase
from app.schemas.post_training import TestCaseResponse

logger = logging.getLogger(__name__)


async def get_safe_input_text(db: AsyncSession, test_case: TestCase) -> str:
    """Return the PII-safe version of `test_case.input_text`.

    Precedence:
      1. Own mask: `test_case.pii_masked_content` when `pii_status='masked'`.
      2. Source mask: linked `InputDatasetItem.pii_masked_content` when masked.
      3. Raw `input_text` only when neither mask applies (unchecked/clean/missing).
    """
    if test_case.pii_status == "masked" and test_case.pii_masked_content:
        return test_case.pii_masked_content
    if test_case.source_input_dataset_item_id:
        item = await db.get(InputDatasetItem, test_case.source_input_dataset_item_id)
        if item and item.pii_status == "masked" and item.pii_masked_content:
            return item.pii_masked_content
    return test_case.input_text


async def _build_safe_input_map(
    db: AsyncSession, test_cases: list[TestCase]
) -> dict[str, str]:
    """For a batch of test cases, return {test_case_id: safe_input_text}.

    Uses one IN-query rather than N round-trips. Precedence per test case:
    own mask → source-item mask → raw input.
    """
    out: dict[str, str] = {}
    source_ids = [
        tc.source_input_dataset_item_id
        for tc in test_cases
        if tc.source_input_dataset_item_id
        # Skip the source lookup entirely for test cases that already have
        # their own masking applied — own mask wins so we don't need the source.
        and not (tc.pii_status == "masked" and tc.pii_masked_content)
    ]
    by_source: dict[str, InputDatasetItem] = {}
    if source_ids:
        rows = await db.execute(
            select(InputDatasetItem).where(InputDatasetItem.id.in_(source_ids))
        )
        for item in rows.scalars().all():
            by_source[item.id] = item
    for tc in test_cases:
        if tc.pii_status == "masked" and tc.pii_masked_content:
            out[tc.id] = tc.pii_masked_content
            continue
        sid = tc.source_input_dataset_item_id
        if sid:
            item = by_source.get(sid)
            if item and item.pii_status == "masked" and item.pii_masked_content:
                out[tc.id] = item.pii_masked_content
                continue
        out[tc.id] = tc.input_text
    return out


async def build_safe_response(
    db: AsyncSession, test_case: TestCase
) -> TestCaseResponse:
    """Serialize a TestCase to TestCaseResponse with the safe input_text."""
    safe = await get_safe_input_text(db, test_case)
    response = TestCaseResponse.model_validate(test_case)
    if safe != test_case.input_text:
        response = response.model_copy(update={"input_text": safe})
    return response


async def build_safe_responses(
    db: AsyncSession, test_cases: list[TestCase]
) -> list[TestCaseResponse]:
    """Batched version of `build_safe_response` for list endpoints."""
    safe_map = await _build_safe_input_map(db, test_cases)
    out: list[TestCaseResponse] = []
    for tc in test_cases:
        response = TestCaseResponse.model_validate(tc)
        safe = safe_map.get(tc.id, tc.input_text)
        if safe != tc.input_text:
            response = response.model_copy(update={"input_text": safe})
        out.append(response)
    return out


async def find_unmasked_test_cases(
    db: AsyncSession, test_cases: list[TestCase]
) -> list[TestCase]:
    """Return test cases that have NOT been PII-checked.

    A test case is "safe" if any of these is true:
      - own `pii_status` in {'masked', 'clean'} (mask was run directly), or
      - linked InputDatasetItem `pii_status` in {'masked', 'clean'}, or
      - it has no `source_input_dataset_item_id` AND its own status is
        unchecked (standalone test case — user typed input themselves; the
        masking is optional but recommended via the Mask PII button).

    A test case is "unsafe" only if it's linked to a dataset item that hasn't
    been masked AND it doesn't have its own mask. That's the case the user
    must address before running a backtest.
    """
    unsafe: list[TestCase] = []
    source_ids: list[str] = []
    for tc in test_cases:
        # Own mask satisfies the rule outright — skip the source lookup.
        if tc.pii_status in ("masked", "clean"):
            continue
        if tc.source_input_dataset_item_id:
            source_ids.append(tc.source_input_dataset_item_id)

    by_id: dict[str, InputDatasetItem] = {}
    if source_ids:
        rows = await db.execute(
            select(InputDatasetItem).where(InputDatasetItem.id.in_(source_ids))
        )
        by_id = {item.id: item for item in rows.scalars().all()}

    for tc in test_cases:
        if tc.pii_status in ("masked", "clean"):
            continue
        sid = tc.source_input_dataset_item_id
        if not sid:
            # Standalone test case: no source, no own mask. We allow it
            # (user is responsible for the text they type). Run the Mask PII
            # button to be sure.
            continue
        item = by_id.get(sid)
        if item is None or item.pii_status not in ("masked", "clean"):
            unsafe.append(tc)
    return unsafe


async def compute_input_signature(
    db: AsyncSession, test_cases: list[TestCase]
) -> str:
    """SHA-256 hash of the safe inputs that would be sent to the model.

    The signature is order-independent and content-aware, so two runs with the
    same prompt + model + test case set are correctly distinguished when the
    underlying data has changed (e.g. PII masking applied between runs).

    Format: sha256 of `\\x1e`-separated lines of `<test_case_id>:<safe_input>`,
    sorted by test_case_id. The record separator is unlikely to appear in
    natural text, eliminating ambiguity from boundary collisions.
    """
    safe_map = await _build_safe_input_map(db, test_cases)
    lines = sorted(f"{tc_id}:{text}" for tc_id, text in safe_map.items())
    payload = "\x1e".join(lines).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


# ─── Direct masking on TestCases (parallel to mask_pii_for_dataset) ─────────


async def mask_pii_for_project_test_cases(project_id: str) -> None:
    """Background task: run PII detection on every test case in the project
    that hasn't been processed yet (`pii_status='unchecked'`).

    Mirrors `input_dataset_service.mask_pii_for_dataset` but operates on
    `pt_test_cases` rows. Each item is committed in its own short session so
    progress is visible incrementally and an error on one item doesn't kill
    the whole pass.
    """
    from app.services import pii_filter_service

    async with async_session() as db:
        result = await db.execute(
            select(TestCase)
            .where(TestCase.project_id == project_id)
            .where(TestCase.pii_status == "unchecked")
        )
        cases = list(result.scalars().all())

    if not cases:
        return

    for tc in cases:
        content = (tc.input_text or "").strip()
        if not content:
            new_status = "clean"
            new_masked: str | None = None
        else:
            try:
                outcome = await pii_filter_service.run_in_mlx_thread(
                    pii_filter_service.detect_and_mask, content
                )
                if outcome["has_pii"]:
                    new_status = "masked"
                    new_masked = outcome["masked_content"]
                else:
                    new_status = "clean"
                    new_masked = None
            except Exception:
                logger.exception("PII masking failed for test case %s", tc.id)
                # Leave as "unchecked" so a retry will pick it up again.
                new_status = "unchecked"
                new_masked = None

        async with async_session() as db:
            row = await db.get(TestCase, tc.id)
            if row:
                row.pii_status = new_status
                row.pii_masked_content = new_masked
                await db.commit()
