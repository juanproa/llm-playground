"""Model fusion service — fuse LoRA adapter into base, convert to GGUF, register with Ollama.

Pipeline:
  1. Fuse: load base model + adapter, merge weights, save as full HF/MLX model
  2. Convert to GGUF (via llama.cpp's convert_hf_to_gguf.py)
  3. `ollama create <name>` from the GGUF file + a simple Modelfile

Each step is optional — the user can fuse-only, fuse+gguf, or fuse+gguf+ollama.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import os
import shutil
import signal
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.post_training import FusionJob

logger = logging.getLogger(__name__)


def _fusion_root(fusion_id: str) -> Path:
    path = Path(settings.fusion_artifacts_dir) / fusion_id
    path.mkdir(parents=True, exist_ok=True)
    return path


# ─── Backend detection ───────────────────────────────────────────────────────

def mlx_fuse_available() -> bool:
    return importlib.util.find_spec("mlx_lm") is not None


def peft_fuse_available() -> bool:
    for pkg in ("transformers", "peft", "torch"):
        if importlib.util.find_spec(pkg) is None:
            return False
    return True


def ollama_available() -> bool:
    return shutil.which("ollama") is not None


def list_fusion_backends() -> list[dict]:
    return [
        {
            "name": "mlx_lm",
            "label": "MLX-LM Fuse",
            "description": "Fuse MLX-format LoRA adapter using mlx_lm.fuse.",
            "available": mlx_fuse_available(),
        },
        {
            "name": "peft",
            "label": "PEFT Merge",
            "description": "Merge HuggingFace PEFT LoRA adapter into base using PEFT's merge_and_unload().",
            "available": peft_fuse_available(),
        },
    ]


# ─── Fuse subprocess scripts ─────────────────────────────────────────────────

_MLX_FUSE_SCRIPT = '''"""MLX adapter fuse driver."""
import argparse, subprocess, sys
ap = argparse.ArgumentParser()
ap.add_argument("--base", required=True)
ap.add_argument("--adapter", required=True)
ap.add_argument("--output", required=True)
args = ap.parse_args()

cmd = ["python", "-m", "mlx_lm.fuse",
       "--model", args.base,
       "--adapter-path", args.adapter,
       "--save-path", args.output]
print(f"[mlx_fuse] {' '.join(cmd)}", flush=True)
sys.exit(subprocess.call(cmd))
'''

_PEFT_FUSE_SCRIPT = '''"""PEFT adapter fuse driver."""
import argparse, sys, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

ap = argparse.ArgumentParser()
ap.add_argument("--base", required=True)
ap.add_argument("--adapter", required=True)
ap.add_argument("--output", required=True)
args = ap.parse_args()

print(f"[peft_fuse] loading base {args.base}", flush=True)
dtype = torch.float16
model = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype=dtype)
print(f"[peft_fuse] loading adapter {args.adapter}", flush=True)
model = PeftModel.from_pretrained(model, args.adapter)
print(f"[peft_fuse] merging", flush=True)
merged = model.merge_and_unload()
merged.save_pretrained(args.output, safe_serialization=True)
AutoTokenizer.from_pretrained(args.base).save_pretrained(args.output)
print(f"[peft_fuse] saved to {args.output}", flush=True)
sys.exit(0)
'''


# ─── Pipeline execution ──────────────────────────────────────────────────────

async def _run_fusion_pipeline(fusion_id: str) -> None:
    """Execute all requested steps for a fusion job."""
    async with async_session() as db:
        job = await db.get(FusionJob, fusion_id)
        if not job:
            logger.error("FusionJob %s not found", fusion_id)
            return

        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        await db.commit()

    try:
        root = _fusion_root(fusion_id)
        merged_dir = root / "merged"
        gguf_path = root / "model.gguf"
        log_buf: list[str] = []

        # ── Step 1: Fuse ──
        await _append_log(fusion_id, log_buf, f"=== Step 1: Fuse ({job.backend}) ===\n")
        ok = await _run_fuse(job.backend, job.base_model, job.adapter_path, str(merged_dir), fusion_id, log_buf)
        if not ok:
            await _finish(fusion_id, "failed", "Fuse step failed", None, None, log_buf)
            return
        await _update_job_field(fusion_id, merged_path=str(merged_dir))

        # ── Step 2: GGUF convert (optional) ──
        if job.convert_to_gguf:
            await _append_log(fusion_id, log_buf, f"\n=== Step 2: Convert to GGUF ===\n")
            ok = await _run_gguf_convert(str(merged_dir), str(gguf_path), fusion_id, log_buf)
            if not ok:
                await _finish(fusion_id, "failed", "GGUF conversion failed", str(merged_dir), None, log_buf)
                return
            await _update_job_field(fusion_id, gguf_path=str(gguf_path))

        # ── Step 3: Ollama register (optional) ──
        if job.register_with_ollama and job.ollama_name:
            await _append_log(fusion_id, log_buf, f"\n=== Step 3: Register with Ollama ({job.ollama_name}) ===\n")
            if not job.convert_to_gguf:
                await _finish(fusion_id, "failed", "Ollama registration requires GGUF conversion", str(merged_dir), None, log_buf)
                return
            ok = await _run_ollama_create(job.ollama_name, str(gguf_path), fusion_id, log_buf)
            if not ok:
                await _finish(fusion_id, "failed", "Ollama registration failed", str(merged_dir), str(gguf_path), log_buf)
                return

        await _finish(fusion_id, "completed", None, str(merged_dir), str(gguf_path) if job.convert_to_gguf else None, log_buf)

    except Exception as e:
        logger.exception("Fusion %s crashed", fusion_id)
        await _finish(fusion_id, "failed", str(e), None, None, [])


async def _run_fuse(backend: str, base: str, adapter: str, output: str, fusion_id: str, log_buf: list[str]) -> bool:
    root = _fusion_root(fusion_id)
    script = root / f"_fuse_{backend}.py"
    if backend == "mlx_lm":
        if not mlx_fuse_available():
            await _append_log(fusion_id, log_buf, "mlx_lm not installed")
            return False
        script.write_text(_MLX_FUSE_SCRIPT)
    elif backend == "peft":
        if not peft_fuse_available():
            await _append_log(fusion_id, log_buf, "peft/transformers not installed")
            return False
        script.write_text(_PEFT_FUSE_SCRIPT)
    else:
        await _append_log(fusion_id, log_buf, f"Unknown backend: {backend}")
        return False

    cmd = ["python", str(script), "--base", base, "--adapter", adapter, "--output", output]
    return await _run_and_log(cmd, fusion_id, log_buf)


async def _run_gguf_convert(merged_dir: str, gguf_path: str, fusion_id: str, log_buf: list[str]) -> bool:
    # Try llama.cpp's convert_hf_to_gguf.py — user must have it installed.
    converter = shutil.which("convert_hf_to_gguf.py")
    if not converter:
        # Fallback: look for an installed llama-cpp-python convert script
        import site
        for p in site.getsitepackages():
            candidate = Path(p) / "llama_cpp" / "convert_hf_to_gguf.py"
            if candidate.exists():
                converter = str(candidate)
                break
    if not converter:
        await _append_log(
            fusion_id, log_buf,
            "convert_hf_to_gguf.py not found.  Install llama.cpp and make it on PATH, "
            "or install llama-cpp-python with convert support."
        )
        return False

    cmd = ["python", converter, merged_dir, "--outfile", gguf_path, "--outtype", "q4_k_m"]
    return await _run_and_log(cmd, fusion_id, log_buf)


async def _run_ollama_create(name: str, gguf_path: str, fusion_id: str, log_buf: list[str]) -> bool:
    if not ollama_available():
        await _append_log(fusion_id, log_buf, "ollama CLI not found on PATH")
        return False
    # Write a minimal Modelfile
    root = _fusion_root(fusion_id)
    modelfile = root / "Modelfile"
    modelfile.write_text(f"FROM {gguf_path}\n")

    cmd = ["ollama", "create", name, "-f", str(modelfile)]
    return await _run_and_log(cmd, fusion_id, log_buf)


async def _run_and_log(cmd: list[str], fusion_id: str, log_buf: list[str]) -> bool:
    await _append_log(fusion_id, log_buf, f"$ {' '.join(cmd)}\n")
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    assert proc.stdout is not None
    async for raw in proc.stdout:
        line = raw.decode("utf-8", errors="replace").rstrip()
        await _append_log(fusion_id, log_buf, line + "\n")
    await proc.wait()
    return proc.returncode == 0


async def _append_log(fusion_id: str, buf: list[str], chunk: str) -> None:
    buf.append(chunk)
    # flush every ~20 lines
    if len(buf) % 20 == 0:
        await _persist_log(fusion_id, "".join(buf))


async def _persist_log(fusion_id: str, text: str) -> None:
    async with async_session() as db:
        job = await db.get(FusionJob, fusion_id)
        if job:
            job.log_text = text
            await db.commit()


async def _update_job_field(fusion_id: str, **fields) -> None:
    async with async_session() as db:
        job = await db.get(FusionJob, fusion_id)
        if not job:
            return
        for k, v in fields.items():
            setattr(job, k, v)
        await db.commit()


async def _finish(fusion_id: str, status: str, error: str | None,
                  merged: str | None, gguf: str | None, log_buf: list[str]) -> None:
    async with async_session() as db:
        job = await db.get(FusionJob, fusion_id)
        if not job:
            return
        job.status = status
        job.error_message = error
        if merged:
            job.merged_path = merged
        if gguf:
            job.gguf_path = gguf
        job.log_text = "".join(log_buf)
        job.completed_at = datetime.now(timezone.utc)
        await db.commit()


# ─── Public entrypoint ────────────────────────────────────────────────────────

async def start_fusion(fusion_id: str) -> None:
    """Kick off the pipeline in the background."""
    asyncio.create_task(_run_fusion_pipeline(fusion_id))


# ─── Artifact management ─────────────────────────────────────────────────────

def list_fusion_artifacts() -> list[dict]:
    root = Path(settings.fusion_artifacts_dir)
    if not root.exists():
        return []
    out: list[dict] = []
    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue
        total = 0
        for p in d.rglob("*"):
            try:
                total += p.stat().st_size
            except OSError:
                pass
        out.append({
            "fusion_id": d.name,
            "path": str(d),
            "size_bytes": total,
            "modified_at": datetime.fromtimestamp(d.stat().st_mtime, tz=timezone.utc).isoformat(),
        })
    return out


def delete_fusion_artifact(fusion_id: str) -> bool:
    root = Path(settings.fusion_artifacts_dir) / fusion_id
    if not root.exists():
        return False
    shutil.rmtree(root, ignore_errors=True)
    return True
