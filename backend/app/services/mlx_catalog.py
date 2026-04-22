"""Curated catalog of MLX-compatible base models known to work for LoRA SFT.

These are HuggingFace model IDs that `mlx_lm.lora` can download and train on.
Each entry also includes metadata needed by the fusion/GGUF pipeline (the HF
repo name of the original non-MLX model, used when converting to GGUF).
"""
from __future__ import annotations

from pydantic import BaseModel


class MlxModel(BaseModel):
    id: str  # HF repo id (what gets passed to --model)
    name: str  # human-readable display name
    size: str  # rough parameter count, e.g. "2B", "7B"
    family: str  # "gemma", "llama", "qwen", "phi", "mistral"
    quantization: str  # "bf16", "4bit", "8bit"
    # Original (non-MLX) HF repo for GGUF conversion after fusing.
    # If None, the MLX repo itself is used (some converters handle it).
    hf_original: str | None = None
    notes: str | None = None


KNOWN_MLX_MODELS: list[MlxModel] = [
    # ── Gemma family ──
    MlxModel(
        id="mlx-community/gemma-2-2b-it-4bit",
        name="Gemma 2 2B IT (4-bit)",
        size="2B",
        family="gemma",
        quantization="4bit",
        hf_original="google/gemma-2-2b-it",
        notes="Small, fast. Good starter model.",
    ),
    MlxModel(
        id="mlx-community/gemma-2-9b-it-4bit",
        name="Gemma 2 9B IT (4-bit)",
        size="9B",
        family="gemma",
        quantization="4bit",
        hf_original="google/gemma-2-9b-it",
    ),
    # ── Llama family ──
    MlxModel(
        id="mlx-community/Llama-3.2-3B-Instruct-4bit",
        name="Llama 3.2 3B Instruct (4-bit)",
        size="3B",
        family="llama",
        quantization="4bit",
        hf_original="meta-llama/Llama-3.2-3B-Instruct",
    ),
    MlxModel(
        id="mlx-community/Meta-Llama-3.1-8B-Instruct-4bit",
        name="Llama 3.1 8B Instruct (4-bit)",
        size="8B",
        family="llama",
        quantization="4bit",
        hf_original="meta-llama/Llama-3.1-8B-Instruct",
    ),
    # ── Qwen family ──
    MlxModel(
        id="mlx-community/Qwen2.5-1.5B-Instruct-4bit",
        name="Qwen 2.5 1.5B Instruct (4-bit)",
        size="1.5B",
        family="qwen",
        quantization="4bit",
        hf_original="Qwen/Qwen2.5-1.5B-Instruct",
    ),
    MlxModel(
        id="mlx-community/Qwen2.5-3B-Instruct-4bit",
        name="Qwen 2.5 3B Instruct (4-bit)",
        size="3B",
        family="qwen",
        quantization="4bit",
        hf_original="Qwen/Qwen2.5-3B-Instruct",
    ),
    MlxModel(
        id="mlx-community/Qwen2.5-3B-Instruct-bf16",
        name="Qwen 2.5 3B Instruct (bf16, full precision)",
        size="3B",
        family="qwen",
        quantization="bf16",
        hf_original="Qwen/Qwen2.5-3B-Instruct",
        notes="Full-precision bf16 — higher quality, ~6.5 GB, needs 8+ GB RAM.",
    ),
    MlxModel(
        id="mlx-community/Qwen2.5-7B-Instruct-4bit",
        name="Qwen 2.5 7B Instruct (4-bit)",
        size="7B",
        family="qwen",
        quantization="4bit",
        hf_original="Qwen/Qwen2.5-7B-Instruct",
    ),
    MlxModel(
        id="mlx-community/Qwen3-8B-4bit",
        name="Qwen 3 8B (4-bit)",
        size="8B",
        family="qwen",
        quantization="4bit",
        hf_original="Qwen/Qwen3-8B",
        notes="Qwen 3 generation. Supports thinking mode — toggle via chat template.",
    ),
    # ── Phi family ──
    MlxModel(
        id="mlx-community/Phi-3.5-mini-instruct-4bit",
        name="Phi 3.5 Mini Instruct (4-bit)",
        size="3.8B",
        family="phi",
        quantization="4bit",
        hf_original="microsoft/Phi-3.5-mini-instruct",
    ),
    MlxModel(
        id="mlx-community/Phi-4-mini-reasoning-4bit",
        name="Phi 4 Mini Reasoning (4-bit)",
        size="3.8B",
        family="phi",
        quantization="4bit",
        hf_original="microsoft/Phi-4-mini-reasoning",
        notes="Reasoning-tuned Phi-4 variant — emits explicit step-by-step thinking.",
    ),
    # ── Mistral family ──
    MlxModel(
        id="mlx-community/Mistral-7B-Instruct-v0.3-4bit",
        name="Mistral 7B Instruct v0.3 (4-bit)",
        size="7B",
        family="mistral",
        quantization="4bit",
        hf_original="mistralai/Mistral-7B-Instruct-v0.3",
    ),
    # ── MedGemma (via HF) ──
    MlxModel(
        id="mlx-community/medgemma-4b-it-4bit",
        name="MedGemma 4B IT (4-bit)",
        size="4B",
        family="gemma",
        quantization="4bit",
        hf_original="google/medgemma-4b-it",
        notes="Medical-domain Gemma variant (v1). ~2.9 GB.",
    ),
    # ── MedGemma 1.5 — newer release, recommended ──
    MlxModel(
        id="mlx-community/medgemma-1.5-4b-it-4bit",
        name="MedGemma 1.5 4B IT (4-bit)",
        size="4B",
        family="gemma",
        quantization="4bit",
        hf_original="google/medgemma-1.5-4b-it",
        notes="MedGemma 1.5 — newer, medical domain. ~2.5 GB.",
    ),
    MlxModel(
        id="mlx-community/medgemma-1.5-4b-it-6bit",
        name="MedGemma 1.5 4B IT (6-bit)",
        size="4B",
        family="gemma",
        quantization="6bit",
        hf_original="google/medgemma-1.5-4b-it",
        notes="Balanced quality/speed (~3.5 GB).",
    ),
    MlxModel(
        id="mlx-community/medgemma-1.5-4b-it-8bit",
        name="MedGemma 1.5 4B IT (8-bit)",
        size="4B",
        family="gemma",
        quantization="8bit",
        hf_original="google/medgemma-1.5-4b-it",
        notes="Higher quality, larger footprint (~4.5 GB).",
    ),
    MlxModel(
        id="mlx-community/medgemma-1.5-4b-it-bf16",
        name="MedGemma 1.5 4B IT (bf16, full precision)",
        size="4B",
        family="gemma",
        quantization="bf16",
        hf_original="google/medgemma-1.5-4b-it",
        notes="Unquantized — matches reference quality. ~9.3 GB, needs 16+ GB RAM.",
    ),
]


# ── HF-format curated list (used by PEFT backend) ────────────────────────────
# Full-precision HF models runnable on Apple Silicon via transformers + MPS.
# These produce standard PEFT LoRA adapters that can be fused and converted
# to GGUF for Ollama.


class HfModel(BaseModel):
    id: str  # HF repo id
    name: str
    size: str
    family: str


KNOWN_HF_MODELS: list[HfModel] = [
    HfModel(id="google/gemma-2-2b-it", name="Gemma 2 2B IT", size="2B", family="gemma"),
    HfModel(id="meta-llama/Llama-3.2-1B-Instruct", name="Llama 3.2 1B Instruct", size="1B", family="llama"),
    HfModel(id="meta-llama/Llama-3.2-3B-Instruct", name="Llama 3.2 3B Instruct", size="3B", family="llama"),
    HfModel(id="Qwen/Qwen2.5-1.5B-Instruct", name="Qwen 2.5 1.5B Instruct", size="1.5B", family="qwen"),
    HfModel(id="Qwen/Qwen2.5-3B-Instruct", name="Qwen 2.5 3B Instruct", size="3B", family="qwen"),
    HfModel(id="microsoft/Phi-3.5-mini-instruct", name="Phi 3.5 Mini Instruct", size="3.8B", family="phi"),
    HfModel(id="google/medgemma-4b-it", name="MedGemma 4B IT", size="4B", family="gemma"),
]


def get_mlx_model_by_id(model_id: str) -> MlxModel | None:
    return next((m for m in KNOWN_MLX_MODELS if m.id == model_id), None)


def get_hf_model_by_id(model_id: str) -> HfModel | None:
    return next((m for m in KNOWN_HF_MODELS if m.id == model_id), None)
