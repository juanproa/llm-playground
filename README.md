# LLM Playground

A self-hosted platform for experimenting with, comparing, and post-training Large Language Models. Project-scoped workflows, multi-provider support, retrieval-augmented generation, batch evaluation, and Apple-Silicon-native fine-tuning — all behind a single web UI.

![Stack](https://img.shields.io/badge/backend-FastAPI-009688) ![Stack](https://img.shields.io/badge/frontend-React%2019-61dafb) ![Python](https://img.shields.io/badge/python-3.11%2B-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

### Workspace
- **Projects** — every workflow is scoped to a project (prompts, datasets, runs, test cases).
- **Prompt versioning** — multi-version prompts with active-version pinning and per-version system messages.
- **Inference** — single-shot or streaming (SSE) inference against any registered model.
- **PDF ingestion** — upload PDFs, extracted via Docling for digital docs and Tesseract OCR for scans.
- **RAG** — bind a Knowledge Base to a prompt version (or override per call) for retrieval-augmented inference.

### Multi-Provider Model Registry
Hosted, local, or hybrid — pick whichever you want side-by-side:
- **Anthropic Claude**, **OpenAI**, **Google Gemini**, **NVIDIA**
- **Ollama** (local) — auto-discovers pulled models
- **MLX Local** (Apple Silicon) — runs HuggingFace MLX-format models natively, with optional LoRA-adapter loading

### Knowledge Base & RAG
- Upload documents, auto-chunk and embed them locally with `mlx-embeddings`.
- Bind a KB to a `PromptVersion` for default RAG context.
- Per-call overrides: disable RAG, swap in a different KB, or change top-K from the input panel.

### Batch Compare
Run the same prompt across N models (and/or chains) over M dataset inputs:
- Matrix view (rows = inputs, columns = models/chains)
- Per-model prompt overrides for fair-fight tuning
- LLM-as-judge optional column-level aggregates
- One-click **+ SFT Dataset** to seed fine-tuning data, **+ Backtest** to seed test cases
- Expand-row modal with synced scrolling
- CSV export, run cloning

### Model Chains
Compose multi-step pipelines: each node has its own prompt + model + optional document/RAG. The chain's `final_output` (a `{node_name: text}` JSON blob) becomes a single column in Batch Compare so you can A/B a chain against a single-model baseline.

### Post-Training
- **Datasets (SFT)** — manage `(instruction, input, output, system)` tuples for fine-tuning. Append from inference history or Batch Compare cells.
- **Fine-Tuning (SFT)** — LoRA fine-tuning on **Apple Silicon via MLX-LM** out of the box. Pluggable backend interface for adding new trainers.
- **Backtesting** — run a (prompt, model) against a project's test cases; rule-based scoring or **LLM-as-judge**; assertions per case; pass/fail aggregates.
- **Model Fusion** — fuse a base model + LoRA adapter into a standalone model directory.

### Other
- API-key encryption at rest (Fernet, optional)
- Inference cache (skip identical (model, prompt, input) calls)
- Stream cancellation
- Lightweight in-place SQLite migrations (no Alembic invocation needed for the column-add path)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI · async SQLAlchemy 2.0 · Pydantic v2 · SQLite (aiosqlite) |
| Frontend | React 19 · TypeScript · Vite · styled-components · Zustand · React Router |
| LLM SDKs | `anthropic` · `openai` · `google-genai` · Ollama HTTP · MLX (`mlx_lm`, `mlx-embeddings`) |
| Document parsing | Docling · Tesseract · pdf2image · Pillow |
| Crypto | `cryptography` (Fernet) |

---

## Prerequisites

- **Python 3.11+** — backend
- **Node.js 20+** and **npm 10+** — frontend
- **macOS (Apple Silicon recommended)** — required if you plan to use the MLX local provider or MLX-LM fine-tuning. Other features are platform-agnostic.
- **System packages** for PDF OCR/parsing:
  - **macOS**:
    ```bash
    brew install tesseract poppler
    ```
  - **Debian/Ubuntu**:
    ```bash
    sudo apt-get install tesseract-ocr poppler-utils
    ```
- **Ollama** (optional) — install from <https://ollama.com> if you want to use local Ollama models.

---

## Quick Start

The fastest path — clone and run:

```bash
git clone <your-repo-url> llm-playground
cd llm-playground
cp .env.example .env       # generate ENCRYPTION_KEY first; see Configuration below
./run.sh
```

`run.sh` creates a Python venv, installs backend deps, installs frontend deps, and starts both servers:

- Frontend → <http://localhost:5173>
- Backend → <http://localhost:8000>
- API docs → <http://localhost:8000/docs>

Press `Ctrl+C` to stop both.

---

## Manual Install

If you prefer to manage backend and frontend yourself:

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env       # then fill in ENCRYPTION_KEY
uvicorn app.main:app --reload --port 8000
```

The first run creates `llm_playground.db` and applies the inline migrations automatically.

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Vite serves on <http://localhost:5173> and proxies `/api/*` to the backend on `:8000` (configured in [`frontend/vite.config.ts`](frontend/vite.config.ts)).

---

## Configuration

All backend settings live in `.env` (read from `backend/.env` at startup). Copy `.env.example` and edit:

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite+aiosqlite:///./llm_playground.db` | SQLite is the only tested DB. |
| `UPLOADS_DIR` | `./uploads` | Where uploaded PDFs land. Relative to `backend/`. |
| `ARTIFACTS_DIR` | `./artifacts` | SFT/fusion artifacts (LoRA adapters, fused models). |
| `ENCRYPTION_KEY` | *(empty)* | Fernet key used to encrypt model API keys at rest. **Strongly recommended.** |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | JSON array of allowed origins. |

### Generating an `ENCRYPTION_KEY`

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Paste the result into `.env`:

```
ENCRYPTION_KEY=h0gZgF3...your-key-here...=
```

> If `ENCRYPTION_KEY` is empty, API keys are stored as plaintext in the SQLite file. Don't ship that.

### Adding LLM provider keys

API keys for hosted providers (Anthropic, OpenAI, Google, NVIDIA) are entered through the UI under **Model Registry → Add Model**, not via env vars — they are encrypted with `ENCRYPTION_KEY` and stored per-model.

For Ollama and MLX local, no keys are needed. Just have Ollama running and/or have your MLX models pulled.

---

## Apple Silicon / MLX (optional)

The MLX local provider and MLX-LM fine-tuning backend require Apple Silicon (M1/M2/M3/M4) and the MLX libraries. They're installed automatically via `requirements.txt` (`mlx-embeddings`), but for full inference and SFT support you'll also want:

```bash
pip install mlx mlx-lm
```

If you skip these on a non-Mac box, the platform still runs — the MLX-LM SFT backend simply reports as unavailable in the UI, and the MLX local provider will refuse to register models.

---

## Project Structure

```
llm-playground/
├── run.sh                       # one-shot starter: backend + frontend
├── .env.example                 # canonical config template
├── requirements.txt             # backend deps (mirror of backend/requirements.txt)
├── CLAUDE.md                    # contributor notes (read before touching "datasets")
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, lifespan, lightweight migrations
│   │   ├── config.py            # Pydantic Settings
│   │   ├── database.py          # async engine + session factory
│   │   ├── models/              # SQLAlchemy ORM models
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   ├── routers/             # FastAPI routes (one file per domain)
│   │   ├── services/            # Business logic (inference, sft, backtest, …)
│   │   └── providers/           # Anthropic / OpenAI / Google / NVIDIA / Ollama / MLX
│   ├── artifacts/               # Fine-tuning outputs (LoRA adapters, fused models)
│   ├── uploads/                 # Uploaded PDFs / dataset files
│   └── llm_playground.db        # SQLite DB (auto-created)
└── frontend/
    └── src/
        ├── api/                 # apiFetch wrappers per domain
        ├── stores/              # Zustand stores
        ├── pages/               # Route-level pages
        ├── components/          # UI components grouped by feature
        └── theme/               # Design tokens, global styles
```

See [`CLAUDE.md`](CLAUDE.md) for an important note on the **four** distinct "dataset" concepts in the schema (Knowledge Base, Input Dataset, SFT Dataset, Test Case) — the names overlap and the discriminator is always the table name.

---

## Common API Endpoints

API is rooted at `/api/v1`. Full schema at <http://localhost:8000/docs>.

| Domain | Sample endpoints |
|---|---|
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/{id}` |
| Prompts | `GET/POST /projects/{id}/prompts`, version CRUD |
| Models | `GET/POST /models`, `POST /models/{id}/test` |
| Inference | `POST /inference/run`, `GET /inference/stream` (SSE) |
| Knowledge Base | `GET/POST /knowledge-bases`, item upload + embed |
| Input Datasets | `GET/POST /input-datasets`, items + PDF upload |
| Batch Compare | `GET/POST /projects/{id}/post-training/comparison-runs` |
| Backtesting | `GET/POST /projects/{id}/post-training/backtest-runs`, test cases |
| SFT (Fine-Tuning) | `GET/POST /projects/{id}/post-training/training-jobs`, datasets |
| Chains | `GET/POST /projects/{id}/chains`, runs |

---

## Database Migrations

The platform uses lightweight inline `ALTER TABLE` migrations in `_run_migrations()` ([`backend/app/main.py`](backend/app/main.py)). New columns are added on startup via `try SELECT col, except → ALTER ADD COLUMN`. There is also an Alembic environment (`backend/alembic/`) for full migrations if you outgrow this pattern.

When adding a new column to an existing model, also add a line to `_run_migrations` so existing databases pick it up on next boot.

---

## Troubleshooting

**`docling` install fails on Linux**
Docling pulls heavy ML deps. Make sure you're on Python 3.11+. If it still fails, you can install the rest of `requirements.txt` and skip Docling — PDFs will fall back to Tesseract OCR.

**`tesseract: command not found` when uploading a PDF**
Install the system package: `brew install tesseract` (macOS) or `apt-get install tesseract-ocr` (Debian).

**MLX provider doesn't appear / SFT backend says "unavailable"**
You're not on Apple Silicon, or you haven't installed `mlx` and `mlx-lm`. Run `pip install mlx mlx-lm`.

**Ollama model list is empty**
Make sure Ollama is running (`ollama serve`) and models are pulled (`ollama pull llama3`). The Model Registry's Ollama dropdown queries `http://localhost:11434` by default.

**`Invalid token` errors after rotating `ENCRYPTION_KEY`**
Encrypted API keys can't be decrypted with a different key. Either keep the old key, or re-enter API keys in the Model Registry after rotating.

**Port 5173 / 8000 already in use**
Pass an alternate port: `uvicorn app.main:app --port 8001` and start Vite with `npm run dev -- --port 5174`. Also update `CORS_ORIGINS` in `.env` if you change the frontend port.

---

## Development

### Running tests

```bash
cd backend
source .venv/bin/activate
pytest
```

### Linting the frontend

```bash
cd frontend
npm run lint
```

### Production build (frontend)

```bash
cd frontend
npm run build
```

The bundled assets land in `frontend/dist/`. Serve them with any static host and point it at the backend.

---

## License

MIT
