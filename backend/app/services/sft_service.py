"""SFT (Supervised Fine-Tuning) service with pluggable training backends."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import os
import re
import shutil
import signal
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.post_training import DatasetItem, TrainingJob

logger = logging.getLogger(__name__)


def _job_root(job_id: str) -> Path:
    """Persistent on-disk root for an SFT job.

    Resolves from settings.sft_artifacts_dir so artifacts survive reboots.
    """
    path = Path(settings.sft_artifacts_dir) / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


# ─── Abstract Backend ────────────────────────────────────────────────────────

class TrainingBackend(ABC):
    """Abstract base for training backends."""

    name: str = "abstract"
    label: str = "Abstract"
    description: str = ""

    @abstractmethod
    async def start(self, job: TrainingJob, dataset_items: list[DatasetItem]) -> int:
        """Start training. Returns the subprocess PID."""
        ...

    @abstractmethod
    async def stop(self, pid: int) -> None:
        """Stop a running training process."""
        ...

    @abstractmethod
    def is_available(self) -> bool:
        """Check whether this backend is installed and available."""
        ...


# ─── MLX-LM Backend ──────────────────────────────────────────────────────────

class MlxLmBackend(TrainingBackend):
    """LoRA fine-tuning on Apple Silicon using mlx_lm.

    Output: MLX-format LoRA adapters under <job>/output/
    To use with Ollama you must fuse + convert to GGUF (see Model Fusion).
    """

    name = "mlx_lm"
    label = "MLX-LM"
    description = (
        "Native Apple Silicon LoRA fine-tuning using the MLX framework. "
        "Produces MLX LoRA adapters; requires fusion + GGUF conversion for Ollama use."
    )

    def is_available(self) -> bool:
        return importlib.util.find_spec("mlx_lm") is not None

    async def start(self, job: TrainingJob, dataset_items: list[DatasetItem]) -> int:
        if not self.is_available():
            raise RuntimeError(
                "mlx_lm is not installed. Install it with: pip install mlx-lm"
            )

        hyperparams: dict = {}
        if job.hyperparams:
            try:
                hyperparams = json.loads(job.hyperparams)
            except json.JSONDecodeError:
                pass

        epochs = int(hyperparams.get("epochs", 3))
        lr = float(hyperparams.get("lr", 1e-4))
        batch_size = int(hyperparams.get("batch_size", 4))
        max_seq_length = int(hyperparams.get("max_seq_length", 2048))
        val_split = float(hyperparams.get("val_split", 0.1))

        job_dir = _job_root(job.id)
        train_file = job_dir / "train.jsonl"
        valid_file = job_dir / "valid.jsonl"
        output_dir = job_dir / "output"
        output_dir.mkdir(parents=True, exist_ok=True)

        # Deterministic shuffle + split
        import random
        items_ordered = list(dataset_items)
        rng = random.Random(42)
        rng.shuffle(items_ordered)
        n_val = max(1, int(len(items_ordered) * val_split)) if val_split > 0 else 0
        val_items = items_ordered[:n_val]
        train_items = items_ordered[n_val:]

        def _write_jsonl(path: Path, items: list):
            with open(path, "w", encoding="utf-8") as f:
                for item in items:
                    record: dict = {"output": item.output_text}
                    if item.instruction:
                        record["instruction"] = item.instruction
                    if item.input_text:
                        record["input"] = item.input_text
                    if item.system_message:
                        record["system"] = item.system_message
                    f.write(json.dumps(record) + "\n")

        _write_jsonl(train_file, train_items)
        if val_items:
            _write_jsonl(valid_file, val_items)

        cmd = [
            "python", "-m", "mlx_lm.lora",
            "--model", job.base_model,
            "--train",
            "--data", str(job_dir),
            "--num-epochs", str(epochs),
            "--learning-rate", str(lr),
            "--batch-size", str(batch_size),
            "--max-seq-length", str(max_seq_length),
            "--adapter-path", str(output_dir),
        ]

        logger.info("Starting mlx_lm training: %s", " ".join(cmd))

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        asyncio.create_task(_tail_logs(proc, job.id, str(output_dir)))
        return proc.pid

    async def stop(self, pid: int) -> None:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


# ─── PEFT / Transformers Backend (Mac-Silicon + Ollama-compatible) ───────────

class PeftBackend(TrainingBackend):
    """LoRA fine-tuning using HuggingFace PEFT + transformers on MPS.

    Output: standard PEFT LoRA adapters (adapter_config.json + adapter_model.safetensors)
    These can be fused via PEFT's merge_and_unload() and then converted to GGUF
    for direct use with Ollama.  More Ollama-friendly than the MLX pipeline.
    """

    name = "peft"
    label = "PEFT (HF + MPS)"
    description = (
        "HuggingFace PEFT + transformers on Apple Silicon MPS. "
        "Produces standard HF LoRA adapters that merge+convert cleanly to Ollama via GGUF."
    )

    def is_available(self) -> bool:
        for pkg in ("transformers", "peft", "torch", "datasets"):
            if importlib.util.find_spec(pkg) is None:
                return False
        return True

    async def start(self, job: TrainingJob, dataset_items: list[DatasetItem]) -> int:
        if not self.is_available():
            raise RuntimeError(
                "PEFT backend requires: pip install transformers peft torch datasets accelerate"
            )

        hyperparams: dict = {}
        if job.hyperparams:
            try:
                hyperparams = json.loads(job.hyperparams)
            except json.JSONDecodeError:
                pass

        epochs = int(hyperparams.get("epochs", 3))
        lr = float(hyperparams.get("lr", 2e-4))
        batch_size = int(hyperparams.get("batch_size", 2))
        max_seq_length = int(hyperparams.get("max_seq_length", 1024))
        lora_r = int(hyperparams.get("lora_r", 8))
        lora_alpha = int(hyperparams.get("lora_alpha", 16))

        job_dir = _job_root(job.id)
        train_file = job_dir / "train.jsonl"
        output_dir = job_dir / "output"
        output_dir.mkdir(parents=True, exist_ok=True)

        with open(train_file, "w", encoding="utf-8") as f:
            for item in dataset_items:
                # Build a single "text" field the trainer can tokenize directly
                parts: list[str] = []
                if item.system_message:
                    parts.append(f"[SYSTEM]\n{item.system_message}")
                if item.instruction:
                    parts.append(f"[INSTRUCTION]\n{item.instruction}")
                if item.input_text:
                    parts.append(f"[INPUT]\n{item.input_text}")
                parts.append(f"[OUTPUT]\n{item.output_text}")
                f.write(json.dumps({"text": "\n\n".join(parts)}) + "\n")

        # Write a small training script that runs in a subprocess
        train_script = job_dir / "_peft_train.py"
        train_script.write_text(_PEFT_TRAIN_SCRIPT)

        cmd = [
            "python", str(train_script),
            "--model_id", job.base_model,
            "--train_file", str(train_file),
            "--output_dir", str(output_dir),
            "--epochs", str(epochs),
            "--lr", str(lr),
            "--batch_size", str(batch_size),
            "--max_seq_length", str(max_seq_length),
            "--lora_r", str(lora_r),
            "--lora_alpha", str(lora_alpha),
        ]

        logger.info("Starting PEFT training: %s", " ".join(cmd))

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        asyncio.create_task(_tail_logs(proc, job.id, str(output_dir)))
        return proc.pid

    async def stop(self, pid: int) -> None:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


# ─── DPO Backend (preference optimization) ──────────────────────────────────

class DpoBackend(TrainingBackend):
    """Direct Preference Optimization via TRL's DPOTrainer on MPS.

    Takes preference pairs (prompt, chosen, rejected) derived from Feedback
    runs where reviewers provided corrected_output (= chosen) and the model's
    own output was marked as rejected (or thumbs-down).

    Produces a standard HF PEFT LoRA adapter — same output format as PeftBackend.
    """

    name = "dpo"
    label = "DPO (PEFT + MPS)"
    description = (
        "Direct Preference Optimization using preference pairs from Feedback runs. "
        "Takes an SFT-trained (or base) model and further tunes it against reviewer "
        "preferences. Outputs a PEFT LoRA adapter."
    )

    def is_available(self) -> bool:
        for pkg in ("transformers", "peft", "torch", "datasets", "trl"):
            if importlib.util.find_spec(pkg) is None:
                return False
        return True

    async def start(self, job: TrainingJob, dataset_items: list[DatasetItem]) -> int:
        if not self.is_available():
            raise RuntimeError(
                "DPO backend requires: pip install transformers peft torch datasets accelerate trl"
            )

        hyperparams: dict = {}
        if job.hyperparams:
            try:
                hyperparams = json.loads(job.hyperparams)
            except json.JSONDecodeError:
                pass

        epochs = int(hyperparams.get("epochs", 1))
        lr = float(hyperparams.get("lr", 5e-6))
        batch_size = int(hyperparams.get("batch_size", 1))
        max_seq_length = int(hyperparams.get("max_seq_length", 1024))
        beta = float(hyperparams.get("beta", 0.1))
        lora_r = int(hyperparams.get("lora_r", 8))
        lora_alpha = int(hyperparams.get("lora_alpha", 16))

        job_dir = _job_root(job.id)
        pref_file = job_dir / "preferences.jsonl"
        output_dir = job_dir / "output"
        output_dir.mkdir(parents=True, exist_ok=True)

        # Items passed to DPO are dataset items whose system_message holds the
        # prompt, instruction holds "chosen", and input_text holds "rejected".
        # (The feedback_service converter produces items in this shape.)
        with open(pref_file, "w", encoding="utf-8") as f:
            for item in dataset_items:
                rec = {
                    "prompt": item.system_message or item.instruction or "",
                    "chosen": item.output_text,          # = preferred response
                    "rejected": item.input_text or "",   # = original / rejected
                }
                if not rec["prompt"] or not rec["chosen"] or not rec["rejected"]:
                    continue
                f.write(json.dumps(rec) + "\n")

        train_script = job_dir / "_dpo_train.py"
        train_script.write_text(_DPO_TRAIN_SCRIPT)

        cmd = [
            "python", str(train_script),
            "--model_id", job.base_model,
            "--pref_file", str(pref_file),
            "--output_dir", str(output_dir),
            "--epochs", str(epochs),
            "--lr", str(lr),
            "--batch_size", str(batch_size),
            "--max_seq_length", str(max_seq_length),
            "--beta", str(beta),
            "--lora_r", str(lora_r),
            "--lora_alpha", str(lora_alpha),
        ]
        logger.info("Starting DPO training: %s", " ".join(cmd))

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        asyncio.create_task(_tail_logs(proc, job.id, str(output_dir)))
        return proc.pid

    async def stop(self, pid: int) -> None:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


_DPO_TRAIN_SCRIPT = '''"""DPO training driver (MPS via TRL)."""
import argparse, torch

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model_id", required=True)
    ap.add_argument("--pref_file", required=True)
    ap.add_argument("--output_dir", required=True)
    ap.add_argument("--epochs", type=int, default=1)
    ap.add_argument("--lr", type=float, default=5e-6)
    ap.add_argument("--batch_size", type=int, default=1)
    ap.add_argument("--max_seq_length", type=int, default=1024)
    ap.add_argument("--beta", type=float, default=0.1)
    ap.add_argument("--lora_r", type=int, default=8)
    ap.add_argument("--lora_alpha", type=int, default=16)
    args = ap.parse_args()

    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[dpo] device={device} model={args.model_id}", flush=True)

    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import LoraConfig, TaskType
    from datasets import load_dataset
    from trl import DPOTrainer, DPOConfig

    tok = AutoTokenizer.from_pretrained(args.model_id, use_fast=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    dtype = torch.float16 if device in ("mps", "cuda") else torch.float32
    model = AutoModelForCausalLM.from_pretrained(args.model_id, torch_dtype=dtype)
    model.to(device)

    peft_cfg = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=args.lora_r, lora_alpha=args.lora_alpha, lora_dropout=0.05, bias="none",
        target_modules=["q_proj", "v_proj"],
    )

    ds = load_dataset("json", data_files=args.pref_file, split="train")

    dpo_cfg = DPOConfig(
        output_dir=args.output_dir,
        per_device_train_batch_size=args.batch_size,
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        beta=args.beta,
        max_length=args.max_seq_length,
        logging_steps=5,
        save_strategy="epoch",
        report_to=[],
    )

    trainer = DPOTrainer(
        model=model,
        args=dpo_cfg,
        train_dataset=ds,
        processing_class=tok,
        peft_config=peft_cfg,
    )
    trainer.train()
    model.save_pretrained(args.output_dir)
    tok.save_pretrained(args.output_dir)
    print(f"[dpo] adapter saved to {args.output_dir}", flush=True)

if __name__ == "__main__":
    main()
'''


# Stand-alone training script used by PeftBackend.  Kept as a string so we
# don't need to ship a separate file.
_PEFT_TRAIN_SCRIPT = '''"""PEFT LoRA training driver (Apple Silicon / MPS)."""
import argparse, json, os, sys
import torch

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model_id", required=True)
    ap.add_argument("--train_file", required=True)
    ap.add_argument("--output_dir", required=True)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--batch_size", type=int, default=2)
    ap.add_argument("--max_seq_length", type=int, default=1024)
    ap.add_argument("--lora_r", type=int, default=8)
    ap.add_argument("--lora_alpha", type=int, default=16)
    args = ap.parse_args()

    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[peft] device={device} model={args.model_id}", flush=True)

    from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, Trainer, DataCollatorForLanguageModeling
    from peft import LoraConfig, get_peft_model, TaskType
    from datasets import load_dataset

    tok = AutoTokenizer.from_pretrained(args.model_id, use_fast=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    dtype = torch.float16 if device in ("mps", "cuda") else torch.float32
    model = AutoModelForCausalLM.from_pretrained(args.model_id, torch_dtype=dtype)
    model.to(device)

    peft_cfg = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=args.lora_r, lora_alpha=args.lora_alpha, lora_dropout=0.05, bias="none",
        target_modules=["q_proj", "v_proj", "k_proj", "o_proj"] if device == "cuda" else ["q_proj", "v_proj"],
    )
    model = get_peft_model(model, peft_cfg)
    model.print_trainable_parameters()

    ds = load_dataset("json", data_files=args.train_file, split="train")
    def tokenize(batch):
        return tok(batch["text"], truncation=True, max_length=args.max_seq_length)
    ds = ds.map(tokenize, batched=True, remove_columns=["text"])

    collator = DataCollatorForLanguageModeling(tok, mlm=False)

    targs = TrainingArguments(
        output_dir=args.output_dir,
        per_device_train_batch_size=args.batch_size,
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        logging_steps=5,
        save_strategy="epoch",
        report_to=[],
        fp16=False, bf16=False,  # MPS doesn't do fp16 training well
    )
    trainer = Trainer(model=model, args=targs, train_dataset=ds, data_collator=collator)
    trainer.train()

    # Save only the adapter (not the full merged model)
    model.save_pretrained(args.output_dir)
    tok.save_pretrained(args.output_dir)
    print(f"[peft] adapter saved to {args.output_dir}", flush=True)

if __name__ == "__main__":
    main()
'''


# Regex patterns to extract metrics from mlx_lm + PEFT training logs.
# mlx_lm format: "Iter 100: Train loss 2.456, ..."
# peft/transformers format: "{'loss': 2.456, 'epoch': 1.0}" or "Step 100 loss=2.456"
_LOSS_PATTERNS = [
    re.compile(r"Iter\s+(\d+):\s+Train loss\s+([\d.]+)", re.IGNORECASE),
    re.compile(r"Iter\s+(\d+):\s+Val loss\s+([\d.]+)", re.IGNORECASE),
    re.compile(r"'step':\s*(\d+).*'loss':\s*([\d.]+)"),
    re.compile(r"'step':\s*(\d+).*'eval_loss':\s*([\d.]+)"),
    re.compile(r"step\s*=?\s*(\d+).*loss\s*=?\s*([\d.]+)", re.IGNORECASE),
]


def _parse_metric(line: str) -> tuple[str, int, float] | None:
    """Try to extract a (metric_name, step, value) tuple from a single log line."""
    lower = line.lower()
    is_val = "val" in lower or "eval" in lower
    metric_name = "val_loss" if is_val else "train_loss"
    for pat in _LOSS_PATTERNS:
        m = pat.search(line)
        if m:
            try:
                return metric_name, int(m.group(1)), float(m.group(2))
            except (ValueError, IndexError):
                continue
    return None


async def _tail_logs(proc: asyncio.subprocess.Process, job_id: str, output_dir: str) -> None:
    """Read subprocess output line-by-line, parse metrics, persist to DB."""
    log_lines: list[str] = []
    metrics: list[dict] = []  # [{name, step, value, ts}]
    assert proc.stdout is not None

    try:
        async for raw_line in proc.stdout:
            line = raw_line.decode("utf-8", errors="replace").rstrip()
            log_lines.append(line)

            parsed = _parse_metric(line)
            if parsed:
                name, step, value = parsed
                metrics.append({
                    "name": name,
                    "step": step,
                    "value": value,
                    "ts": datetime.now(timezone.utc).isoformat(),
                })

            if len(log_lines) % 10 == 0:
                await _flush_logs(job_id, "\n".join(log_lines), metrics)
        await proc.wait()
    except Exception as e:
        log_lines.append(f"[ERROR reading logs: {e}]")

    full_log = "\n".join(log_lines)
    return_code = proc.returncode if proc.returncode is not None else -1
    status = "completed" if return_code == 0 else "failed"
    error_msg = None if return_code == 0 else f"Process exited with code {return_code}"

    async with async_session() as db:
        job = await db.get(TrainingJob, job_id)
        if job:
            job.log_text = full_log
            job.status = status
            job.error_message = error_msg
            job.adapter_path = output_dir if return_code == 0 else None
            job.metrics_json = json.dumps(metrics)
            job.completed_at = datetime.now(timezone.utc)
            await db.commit()
            logger.info("Training job %s finished with status %s", job_id, status)


async def _flush_logs(job_id: str, log_text: str, metrics: list[dict] | None = None) -> None:
    try:
        async with async_session() as db:
            job = await db.get(TrainingJob, job_id)
            if job:
                job.log_text = log_text
                if metrics is not None:
                    job.metrics_json = json.dumps(metrics)
                await db.commit()
    except Exception as e:
        logger.warning("Failed to flush logs for job %s: %s", job_id, e)


# ─── Backend Registry ────────────────────────────────────────────────────────

_BACKENDS: dict[str, TrainingBackend] = {
    "mlx_lm": MlxLmBackend(),
    "peft": PeftBackend(),
    "dpo": DpoBackend(),
}


def get_backend(name: str) -> TrainingBackend:
    backend = _BACKENDS.get(name)
    if backend is None:
        raise ValueError(f"Unknown training backend: {name!r}. Available: {list(_BACKENDS)}")
    return backend


def list_backends() -> list[dict]:
    return [
        {
            "name": b.name,
            "label": b.label,
            "description": b.description,
            "available": b.is_available(),
        }
        for b in _BACKENDS.values()
    ]


# ─── Public Service Functions ─────────────────────────────────────────────────

async def start_training_job(db: AsyncSession, job_id: str) -> TrainingJob:
    from sqlalchemy import select

    job = await db.get(TrainingJob, job_id)
    if not job:
        raise ValueError(f"Training job {job_id} not found")

    if job.status == "running":
        raise ValueError("Job is already running")

    backend = get_backend(job.backend)

    if not backend.is_available():
        job.status = "failed"
        job.error_message = (
            f"Backend '{job.backend}' is not available. "
            "For mlx_lm: pip install mlx-lm. "
            "For peft: pip install transformers peft torch datasets accelerate"
        )
        await db.flush()
        return job

    result = await db.execute(
        select(DatasetItem).where(DatasetItem.dataset_id == job.dataset_id)
    )
    items = list(result.scalars().all())

    if not items:
        job.status = "failed"
        job.error_message = "Dataset has no items"
        await db.flush()
        return job

    job.status = "running"
    job.started_at = datetime.now(timezone.utc)
    job.log_text = ""
    job.error_message = None
    await db.flush()

    try:
        pid = await backend.start(job, items)
        job.pid = pid
        job.output_dir = str(_job_root(job_id) / "output")
        await db.flush()
    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.completed_at = datetime.now(timezone.utc)
        await db.flush()

    return job


async def stop_training_job(db: AsyncSession, job_id: str) -> TrainingJob:
    job = await db.get(TrainingJob, job_id)
    if not job:
        raise ValueError(f"Training job {job_id} not found")

    if job.status != "running":
        raise ValueError(f"Job is not running (current status: {job.status})")

    if job.pid:
        backend = get_backend(job.backend)
        await backend.stop(job.pid)

    job.status = "stopped"
    job.completed_at = datetime.now(timezone.utc)
    await db.flush()
    return job


async def get_job_status(db: AsyncSession, job_id: str) -> TrainingJob:
    job = await db.get(TrainingJob, job_id)
    if not job:
        raise ValueError(f"Training job {job_id} not found")
    return job


# ─── Artifacts management ────────────────────────────────────────────────────

def list_artifacts() -> list[dict]:
    """List every persisted artifact directory with basic stats.

    Returns one entry per job dir under settings.sft_artifacts_dir.
    """
    root = Path(settings.sft_artifacts_dir)
    if not root.exists():
        return []
    out: list[dict] = []
    for job_dir in sorted(root.iterdir()):
        if not job_dir.is_dir():
            continue
        adapter = job_dir / "output"
        # Try to get total bytes for this artifact
        total_bytes = 0
        for p in job_dir.rglob("*"):
            try:
                total_bytes += p.stat().st_size
            except OSError:
                pass
        out.append({
            "job_id": job_dir.name,
            "path": str(job_dir),
            "adapter_path": str(adapter) if adapter.exists() else None,
            "size_bytes": total_bytes,
            "modified_at": datetime.fromtimestamp(job_dir.stat().st_mtime, tz=timezone.utc).isoformat(),
        })
    return out


def delete_artifact(job_id: str) -> bool:
    """Delete all files for a given job's artifact directory.  Returns True if removed."""
    root = Path(settings.sft_artifacts_dir) / job_id
    if not root.exists():
        return False
    shutil.rmtree(root, ignore_errors=True)
    return True
