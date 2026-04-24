# LLM Playground

A Python-based platform for experimenting with and improving LLMs. Built with project-based workflows, multi-provider support, and an architecture prepared for future post-training capabilities.

## Architecture

- **Backend**: FastAPI + SQLAlchemy (async) + SQLite
- **Frontend**: React + TypeScript + Vite + styled-components
- **LLM Providers**: Anthropic Claude, OpenAI, Google Gemini, Ollama (local)
- **PDF Parsing**: Docling + Tesseract + pdf2image
- **Design System**: Dark theme (Comfortaa, Manrope, Poppins)

## Quick Start

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Copy and configure environment
cp ../.env.example .env

# Start the server
uvicorn app.main:app --reload --port 8000
```

API docs available at http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at http://localhost:5173

## Features

### Projects
Each project represents a goal or use case (e.g., "Case Classification Model Testing"). Projects contain prompts, documents, and inference runs.

### Model Registry
Add and manage model configurations for multiple providers:
- **Anthropic Claude** — claude-sonnet-4, claude-opus-4, etc.
- **OpenAI** — gpt-4o, gpt-4o-mini, etc.
- **Google Gemini** — gemini-2.0-flash, etc.
- **Ollama** — local models (llama3, mistral, etc.)

### Prompt Versioning
Create multiple prompts per project with automatic version tracking. Each version stores the prompt content and optional system message.

### Inference
Run inference with any prompt + model combination. Supports streaming responses via Server-Sent Events with real-time output display.

### PDF Processing
Upload PDFs for automatic text extraction using:
1. **Docling** — structured extraction for digital PDFs
2. **Tesseract OCR** — fallback for scanned documents

## Project Structure

```
backend/
├── app/
│   ├── main.py           # FastAPI application
│   ├── config.py          # Settings
│   ├── database.py        # Async SQLAlchemy engine
│   ├── models/            # SQLAlchemy models
│   ├── schemas/           # Pydantic request/response schemas
│   ├── routers/           # API endpoints
│   ├── services/          # Business logic
│   └── providers/         # LLM provider integrations
frontend/
├── src/
│   ├── api/               # API client functions
│   ├── stores/            # Zustand state management
│   ├── pages/             # Route pages
│   ├── components/        # UI components
│   └── theme/             # Design tokens and styles
```

## Future Extensibility

The platform is architected to support future post-training workflows. Stub database tables exist for:

- **Experiments** — fine-tuning, SFT, distillation, RLHF, quantization, pruning
- **Datasets** — training data management
- **Training Jobs** — job tracking with hyperparameters and metrics
- **Artifacts** — checkpoints, adapters, quantized models with lineage tracking
- **Evaluations** — benchmark and evaluation result storage

The provider registry pattern allows new LLM providers to be added with a single file. The service layer isolation ensures future training modules can reuse existing inference and model management code.

## API Endpoints

| Area | Endpoints |
|------|-----------|
| Health | `GET /api/v1/health` |
| Projects | `GET/POST /api/v1/projects`, `GET/PUT/DELETE /api/v1/projects/{id}` |
| Prompts | `GET/POST /api/v1/projects/{id}/prompts`, versions CRUD |
| Documents | Paste, upload PDF, list, get, delete |
| Models | `GET/POST /api/v1/models`, `POST /api/v1/models/{id}/test` |
| Inference | Run, stream (SSE), history |
# llm-playground
