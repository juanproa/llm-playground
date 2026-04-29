# LLM Playground — Agent Notes

## Data entities (read this before touching anything that says "dataset")

There are **four** distinct data concepts in this codebase. They share overlapping
words ("dataset", "items", "knowledge") and have been confused before. Always
identify which one you're working with by its **table name** — that's the only
unambiguous identifier.

| # | Concept | Table | Backend model | Backend router | Frontend API | UI surface | Holds | Scope |
|---|---|---|---|---|---|---|---|---|
| 1 | **Knowledge Base (RAG)** | `knowledge_bases` / `knowledge_base_items` / `knowledge_base_chunks` | `KnowledgeBase` (`app/models/knowledge_base.py`) | `/api/v1/knowledge-bases` | `knowledgeBaseApi` (`api/knowledgeBase.ts`) | Sidebar **"Knowledge Base & RAG"**; bound to a prompt via `PromptVersion.kb_id` / `kb_top_k` | Chunked + embedded content for retrieval. Attached to a **prompt**, used as RAG context at inference time. | Global |
| 2 | **Input Dataset** | `input_datasets` / `input_dataset_items` | `InputDataset` (`app/models/input_dataset.py`) | `/api/v1/input-datasets` | `inputDatasetsApi` (`api/inputDatasets.ts`) | Sidebar **"Datasets"**; Workspace **InputPanel**; **Batch Compare** input picker | Inputs only — `content` field. **No expected output.** Library of "things to feed a prompt." | Global |
| 3 | **SFT Dataset** | `pt_datasets` / `pt_dataset_items` | `Dataset` (`app/models/post_training.py`) | `/api/v1/projects/{id}/post-training/datasets` | `postTrainingApi.listDatasets` / `getDataset` / `addDatasetItems` (`api/postTraining.ts`) | **Post-Training → Fine-Tuning (SFT)**; Batch Compare cells have a "+ Dataset" CTA that appends to one of these | `(instruction, input_text, output_text, system_message)` tuples. Training data for SFT/DPO. | Project-scoped |
| 4 | **Test Case** | `pt_test_cases` | `TestCase` (`app/models/post_training.py`) | `/api/v1/projects/{id}/post-training/test-cases` | `postTrainingApi.listTestCases` etc. (`api/postTraining.ts`) | **Post-Training → Backtesting**. Also auto-materialized by **Batch Compare** from #2 (one TestCase per InputDatasetItem, linked via `source_input_dataset_item_id`). | `(input_text, expected_output, assertions[], pass_threshold)` for evaluation. Workspace runs can be promoted into TestCases. | Project-scoped |

### Hard rules (do not violate)

1. **#1 (KB) is RAG context, not an input source.** Attach via `PromptVersion.kb_id` / `kb_top_k`. Never wire KB items directly into Batch Compare or any inference pipeline as the *prompt input*.
2. **#2 (InputDataset) is the only "feed inputs to a prompt" entity.** It's the right concept for Workspace InputPanel and for Batch Compare. Items have `content`, not `output_text`.
3. **#3 (SFT Dataset / `pt_datasets`) is for fine-tuning only.** Never use it as an inference input source. The "+ Dataset" button in Batch Compare appends curated outputs *to* an SFT dataset; that's the only place it's mentioned outside the Post-Training UI.
4. **#4 (TestCase) is the evaluation primitive.** Both Backtesting and Batch Compare run through this. When Batch Compare ingests an InputDataset, each `InputDatasetItem` becomes a `TestCase` with `source_input_dataset_item_id` set (idempotent on re-runs).
5. **Never add a field/param/UI string named just `dataset_id` or `dataset` if the entity is #2 or #3.** Always use the discriminating prefix (`input_dataset_id`, `sft_dataset_id`, `source_input_dataset_item_id`, etc.). The bare word "dataset" caused a bug — keep the column/field names self-disambiguating.

### Quick checks before writing code

- Picking inputs to **send to a model**? → use `InputDataset` (#2).
- Picking data to **fine-tune a model**? → use `Dataset` / `pt_datasets` (#3).
- Wiring **retrieval context** into a prompt? → use `KnowledgeBase` (#1) via `PromptVersion.kb_id`.
- Building an **eval/scoring loop**? → use `TestCase` (#4); materialize from #2 if you start from a curated input list.

### Provenance fields on TestCase

`TestCase` has two back-link columns so a materialized case can be traced to its origin:

- `source_kb_item_id` — legacy, set when test cases were auto-created from KB items (no longer the path Batch Compare takes).
- `source_input_dataset_item_id` — current path: set when Batch Compare materializes from an InputDataset item.

There is intentionally **no** `source_dataset_item_id` (would have referred to #3 / SFT). Don't add one — SFT data flows in the opposite direction (curated outputs from Batch Compare get appended *into* SFT datasets).

## Lightweight migrations

The DB is SQLite and migrations are inline `ALTER TABLE` statements in `_run_migrations` at `backend/app/main.py`. The pattern is `try SELECT col, except → ALTER ADD COLUMN`. When adding a new column to an existing model, also add the corresponding line there or fresh boots will work but existing DBs won't get the column.
