export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PromptVersion {
  id: string;
  prompt_id: string;
  version_number: number;
  label: string | null;
  content: string;
  system_message: string | null;
  is_active: boolean;
  kb_id: string | null;
  kb_top_k: number;
  created_at: string;
}

export interface Prompt {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  versions: PromptVersion[];
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  namespace: string | null;
  base_url: string | null;
  max_tokens: number;
  temperature: number;
  extra_params: Record<string, unknown> | null;
  adapter_path: string | null;
  enable_thinking: boolean;
  // YaRN context extension (mlx_local only)
  yarn_factor: number | null;
  yarn_original_max_position_embeddings: number | null;
  // Quantization / conversion metadata (mlx_local only)
  q_bits: number | null;
  q_group_size: number | null;
  // KV cache constraints (mlx_local only)
  kv_bits: number | null;
  kv_group_size: number | null;
  max_kv_size: number | null;
  // Sampling parameters (all providers; top_k/min_p also work with vLLM)
  top_p: number | null;
  top_k: number | null;
  min_p: number | null;
  is_enabled: boolean;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  project_id: string;
  name: string;
  source_type: string;
  raw_text: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  parse_status: string;
  parse_error: string | null;
  created_at: string;
}

export interface InferenceRun {
  id: string;
  project_id: string;
  prompt_version_id: string;
  model_config_id: string;
  document_id: string | null;
  input_text: string;
  output_text: string | null;
  status: string;
  error_message: string | null;
  latency_ms: number | null;
  token_usage_input: number | null;
  token_usage_output: number | null;
  cost_estimate_usd: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ─── Post-Training Types ─────────────────────────────────────────────────────

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  format: string;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface DatasetItem {
  id: string;
  dataset_id: string;
  // `name`, `tags`, and provenance columns are curation/analysis metadata —
  // never written to the training JSONL. See backend DatasetItem model.
  name: string | null;
  instruction: string | null;
  input_text: string | null;
  output_text: string;
  system_message: string | null;
  tags: string | null;
  // Soft link to the TestCase this item was exported from. Set by BacktestPanel's
  // "+ Add to SFT" flow. Null for hand-curated items.
  source_test_case_id: string | null;
  // Self-link for synthetic items (Phase 3). Null for non-synthetic items.
  parent_item_id: string | null;
  // 'unverified' on synthetic items at creation; null on hand-curated.
  // A future "Verify Synthetic Dataset" action would flip to 'verified' /
  // 'rejected' after re-running each variant through the source prompt.
  verified_status: string | null;
  created_at: string;
}

export interface SyntheticJob {
  id: string;
  project_id: string;
  name: string;
  source_dataset_id: string | null;
  target_dataset_id: string | null;
  model_config_id: string | null;
  variation_prompt: string;
  // JSON string of {tag: count, "_default": N}. Frontend parses for editing.
  tag_multipliers: string;
  // 'pending' | 'running' | 'completed' | 'failed' | 'cancelling' | 'cancelled'
  status: string;
  total_planned: number;
  completed_count: number;
  failed_count: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface TrainingJob {
  id: string;
  project_id: string;
  dataset_id: string;
  name: string;
  base_model: string;
  backend: string;
  status: string;
  hyperparams: Record<string, unknown> | null;
  output_dir: string | null;
  adapter_path: string | null;
  log_text: string | null;
  metrics_json: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface FeedbackRun {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  prompt_version_id: string | null;
  model_config_id: string | null;
  status: string;
  item_count: number;
  reviewed_count: number;
  created_at: string;
  updated_at: string;
}

export interface FeedbackItem {
  id: string;
  run_id: string;
  input_text: string;
  model_output: string | null;
  generation_status: string;
  rating: number | null;
  thumbs: string | null;
  preferred_answer: string | null;
  corrected_output: string | null;
  reviewer_comment: string | null;
  error_tags: string | null;
  review_status: string;
  reviewed_at: string | null;
  created_at: string;
}

export interface AssertionSpec {
  name: string;
  type: 'json_path_exact' | 'json_path_numeric' | 'json_path_contains' | 'llm_judge';
  path?: string | null;
  expected?: unknown;
  weight?: number;
  options?: Record<string, unknown> | null;
}

export interface AssertionResult {
  name: string;
  type: string;
  path: string | null;
  weight: number;
  passed: boolean;
  score: number;
  actual_value: unknown;
  expected_value: unknown;
  reasoning: string | null;
}

export interface TestCase {
  id: string;
  project_id: string;
  name: string;
  input_text: string;
  expected_output: string;
  expected_type: string;
  tags: string | null;
  notes: string | null;
  is_golden: boolean;
  document_id: string | null;
  source_kb_item_id?: string | null;
  // Back-link to the InputDataset item (global "Datasets" sidebar / `input_datasets`),
  // NOT to a post-training SFT dataset item. See CLAUDE.md "Data entities".
  source_input_dataset_item_id?: string | null;
  assertions: string | null;          // raw JSON string; parse with JSON.parse
  pass_threshold: number | null;
  // PII mask state on this test case itself (parallel to the source dataset item).
  // 'unchecked' | 'clean' | 'masked'. The `input_text` field above is already
  // the safe (masked when applicable) version — this is just the badge.
  pii_status: string;
  created_at: string;
  updated_at: string;
}

export interface BacktestRun {
  id: string;
  project_id: string;
  name: string;
  prompt_version_id: string;
  model_config_id: string;
  status: string;
  pass_threshold: number;
  judge_model_config_id: string | null;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  pass_rate: number | null;
  avg_latency_ms: number | null;
  error_message: string | null;
  total_latency_ms: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface BacktestResult {
  id: string;
  backtest_run_id: string;
  test_case_id: string;
  actual_output: string | null;
  status: string;
  pass_score: number | null;
  assertion_results?: string | null;  // JSON string of AssertionResult[]
  cache_hit?: boolean;
  latency_ms: number | null;
  error_message: string | null;
  // Set when inference begins; cleared when the result reaches a terminal state.
  // While set, the row is "running" — the UI shows a live clock.
  started_at?: string | null;
  created_at: string;
  test_case?: TestCase;
}

// Batch Compare (hard-split from Backtest). Owns its own tables —
// pt_comparison_runs / _children / _results / _input_items — and never
// writes into pt_backtest_runs / pt_test_cases.
export interface ComparisonRun {
  id: string;
  project_id: string;
  name: string;
  prompt_version_id: string;
  judge_model_config_id: string | null;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ComparisonInputItem {
  id: string;
  comparison_run_id: string;
  input_text: string;
  // Display label, copied from InputDatasetItem.name at create time. Null
  // for ad-hoc rows or when the source item had no name.
  name: string | null;
  source_input_dataset_item_id?: string | null;
  ordering: number;
  created_at: string;
}

export interface ComparisonResult {
  id: string;
  child_id: string;
  input_item_id: string;
  actual_output: string | null;
  status: string;            // pending | completed | failed | no_judgment | cancelled
  pass_score: number | null;
  latency_ms: number | null;
  cache_hit?: boolean;
  error_message: string | null;
  created_at: string;
}

export interface ComparisonChild {
  id: string;
  comparison_run_id: string;
  kind: 'model' | 'chain';
  model_config_id: string | null;
  prompt_version_id: string | null;
  chain_id: string | null;
  status: string;
  error_message: string | null;
  ordering: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  results: ComparisonResult[];
}

export interface ComparisonRunWithChildren extends ComparisonRun {
  input_items: ComparisonInputItem[];
  children: ComparisonChild[];
}

// ─── Post-training extras ─────────────────────────────────────────────────────

export interface TrainingBackendInfo {
  name: string;
  label: string;
  description: string;
  available: boolean;
}

export interface MlxModelInfo {
  id: string;
  name: string;
  size: string;
  family: string;
  quantization: string;
  hf_original?: string | null;
  notes?: string | null;
}

export interface HfModelInfo {
  id: string;
  name: string;
  size: string;
  family: string;
}

export interface ArtifactInfo {
  job_id: string;
  path: string;
  adapter_path?: string | null;
  size_bytes: number;
  modified_at: string;
}

export interface FusionArtifactInfo {
  fusion_id: string;
  path: string;
  size_bytes: number;
  modified_at: string;
}

export interface FusionJob {
  id: string;
  project_id: string | null;
  name: string;
  source_job_id: string | null;
  backend: string;
  base_model: string;
  adapter_path: string;
  convert_to_gguf: boolean;
  register_with_ollama: boolean;
  ollama_name: string | null;
  merged_path: string | null;
  gguf_path: string | null;
  status: string;
  log_text: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ─── Knowledge Base ──────────────────────────────────────────────────────────

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  item_count: number;
  embedding_provider: string;
  embedding_model: string;
  embedding_dim: number | null;
  chunk_size_tokens: number;
  chunk_overlap_tokens: number;
  chunk_count: number;
  dictionary_filename: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBaseItem {
  id: string;
  kb_id: string;
  name: string;
  description: string | null;
  content: string;
  source_type: string;
  source_filename: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  metadata_json: string | null;
  parse_status: string;
  parse_error: string | null;
  embedding_status: string;
  embedding_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBaseWithItems extends KnowledgeBase {
  items: KnowledgeBaseItem[];
  dictionary_content: string | null;
}

export interface EmbeddingModelInfo {
  provider: string;
  model_id: string;
  display_name: string;
  dim: number | null;
  notes: string | null;
}

export interface RetrievedChunk {
  chunk_id: string;
  item_id: string;
  item_name: string;
  source_type: string;
  chunk_index: number;
  content: string;
  score: number;
  metadata: Record<string, unknown> | null;
}

export interface KbQueryResponse {
  query: string;
  embedding_model: string;
  chunks: RetrievedChunk[];
  dictionary_content: string | null;
}

// ─── Input Datasets (global, for Workspace prompt-input browsing) ───────────

export interface InputDataset {
  id: string;
  name: string;
  description: string | null;
  item_count: number;
  eval_status: string;
  mask_status: string;
  created_at: string;
  updated_at: string;
}

export interface InputDatasetItem {
  id: string;
  dataset_id: string;
  name: string | null;
  content: string;
  tags: string | null;
  metadata_json: string | null;
  source_type: string;
  source_filename: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  parse_status: string;
  parse_error: string | null;
  quality_status: string;
  quality_reason: string | null;
  pii_status: string;
  // NB: `content` is always the PII-safe version. The backend used to expose
  // `pii_masked_content` separately, but it was removed because it allowed
  // callers to bypass the mask by reading the wrong field.
  created_at: string;
}

export interface InputDatasetWithItems extends InputDataset {
  items: InputDatasetItem[];
}

export interface PiiModelStatus {
  model_id: string;
  loaded: boolean;
  downloaded: boolean;
  preload_state: 'running' | 'done' | 'error' | null;
  preload_error: string | null;
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  name: string;
  model_config_id: string;
  system_prompt: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  error_message: string | null;
  created_at: string;
}

export interface ChatSessionWithMessages extends ChatSession {
  messages: ChatMessage[];
}

// ─── Model Chain (DAG) ──────────────────────────────────────────────────────

export interface EdgeAssertion {
  op: 'contains' | 'equals' | 'regex' | 'startswith' | 'endswith';
  value: string;
  case_sensitive?: boolean;
  negate?: boolean;
}

export interface ChainNode {
  id: string;
  chain_id: string;
  name: string;
  position_x: number;
  position_y: number;
  prompt_version_id: string | null;
  model_config_id: string | null;
  kb_id: string | null;
  kb_top_k: number | null;
  kb_query_template: string | null;
  input_text: string | null;
  input_document_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChainEdge {
  id: string;
  chain_id: string;
  source_node_id: string;
  target_node_id: string;
  assertion: EdgeAssertion | null;
  created_at: string;
}

export interface Chain {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  nodes: ChainNode[];
  edges: ChainEdge[];
}

export interface ChainListItem {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  node_count: number;
  edge_count: number;
}

export type ChainRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  // Cancellation flow: user requests stop → backend flips to 'cancelling' →
  // executor finalizes between nodes as 'cancelled' (partial outputs preserved).
  | 'cancelling'
  | 'cancelled';
export type ChainNodeRunStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';

export interface ChainNodeRun {
  id: string;
  run_id: string;
  node_id: string;
  status: ChainNodeRunStatus;
  skip_reason: string | null;
  resolved_input: string | null;
  output_text: string | null;
  error_message: string | null;
  latency_ms: number | null;
  inference_run_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ChainRun {
  id: string;
  chain_id: string;
  status: ChainRunStatus;
  error_message: string | null;
  // JSON string: { [node_name]: output_text }. Populated when the run reaches
  // a terminal state. Treat as the chain's "single result" — Batch Compare
  // will consume this when chains are runnable as models.
  final_output: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  node_runs: ChainNodeRun[];
}

export interface ChainRunListItem {
  id: string;
  chain_id: string;
  status: ChainRunStatus;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}
