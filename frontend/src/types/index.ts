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
  instruction: string | null;
  input_text: string | null;
  output_text: string;
  system_message: string | null;
  tags: string | null;
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
  assertions: string | null;          // raw JSON string; parse with JSON.parse
  pass_threshold: number | null;
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
  error_message: string | null;
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
  created_at: string;
  test_case?: TestCase;
}

export interface ComparisonRun {
  id: string;
  project_id: string;
  name: string;
  prompt_version_id: string;
  model_config_ids: string;             // JSON string
  test_case_ids: string | null;
  child_backtest_run_ids: string | null;
  judge_model_config_id: string | null;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ComparisonRunWithChildren extends ComparisonRun {
  children: (BacktestRun & { results: BacktestResult[] })[];
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
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBaseWithItems extends KnowledgeBase {
  items: KnowledgeBaseItem[];
}
