import { apiFetch } from './client';
import type {
  ArtifactInfo,
  AssertionSpec,
  BacktestResult,
  BacktestRun,
  ComparisonRun,
  ComparisonRunWithChildren,
  Dataset,
  DatasetItem,
  FeedbackItem,
  FeedbackRun,
  FusionArtifactInfo,
  FusionJob,
  HfModelInfo,
  MlxModelInfo,
  TestCase,
  TrainingBackendInfo,
  TrainingJob,
} from '../types';

const base = (projectId: string) => `/projects/${projectId}/post-training`;

// ─── Datasets ────────────────────────────────────────────────────────────────

export interface DatasetWithItems extends Dataset {
  items: DatasetItem[];
}

export const postTrainingApi = {
  // Datasets
  listDatasets: (projectId: string) =>
    apiFetch<Dataset[]>(`${base(projectId)}/datasets`),

  createDataset: (
    projectId: string,
    data: { name: string; description?: string; format?: string },
  ) =>
    apiFetch<Dataset>(`${base(projectId)}/datasets`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getDataset: (projectId: string, datasetId: string) =>
    apiFetch<DatasetWithItems>(`${base(projectId)}/datasets/${datasetId}`),

  addDatasetItems: (
    projectId: string,
    datasetId: string,
    items: Array<{
      instruction?: string;
      input_text?: string;
      output_text: string;
      system_message?: string;
      tags?: string;
    }>,
  ) =>
    apiFetch<DatasetItem[]>(`${base(projectId)}/datasets/${datasetId}/items`, {
      method: 'POST',
      body: JSON.stringify(items),
    }),

  deleteDataset: (projectId: string, datasetId: string) =>
    apiFetch<void>(`${base(projectId)}/datasets/${datasetId}`, { method: 'DELETE' }),

  deleteDatasetItem: (projectId: string, datasetId: string, itemId: string) =>
    apiFetch<void>(`${base(projectId)}/datasets/${datasetId}/items/${itemId}`, {
      method: 'DELETE',
    }),

  cleanDataset: (projectId: string, datasetId: string, opts?: { dedup?: boolean; normalize?: boolean; strip_html?: boolean }) =>
    apiFetch<{
      initial_count: number;
      duplicates_removed: number;
      normalized_count: number;
      final_count: number;
    }>(`${base(projectId)}/datasets/${datasetId}/clean`, {
      method: 'POST',
      body: JSON.stringify(opts || {}),
    }),

  uploadDatasetFile: (projectId: string, datasetId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiFetch<Dataset>(`${base(projectId)}/datasets/${datasetId}/upload`, {
      method: 'POST',
      headers: {},
      body: formData,
    });
  },

  // Training Jobs (SFT)
  listTrainingJobs: (projectId: string) =>
    apiFetch<TrainingJob[]>(`${base(projectId)}/training-jobs`),

  createTrainingJob: (
    projectId: string,
    data: {
      project_id: string;
      dataset_id: string;
      name: string;
      base_model: string;
      backend?: string;
      hyperparams?: Record<string, unknown>;
    },
  ) =>
    apiFetch<TrainingJob>(`${base(projectId)}/training-jobs`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getTrainingJob: (projectId: string, jobId: string) =>
    apiFetch<TrainingJob>(`${base(projectId)}/training-jobs/${jobId}`),

  startTrainingJob: (projectId: string, jobId: string) =>
    apiFetch<TrainingJob>(`${base(projectId)}/training-jobs/${jobId}/start`, {
      method: 'POST',
    }),

  stopTrainingJob: (projectId: string, jobId: string) =>
    apiFetch<TrainingJob>(`${base(projectId)}/training-jobs/${jobId}/stop`, {
      method: 'POST',
    }),

  // SFT: backends, catalogs, artifacts
  listSftBackends: () =>
    apiFetch<TrainingBackendInfo[]>(`/post-training/sft/backends`),

  listMlxModels: () =>
    apiFetch<MlxModelInfo[]>(`/post-training/sft/mlx-models`),

  listHfModels: () =>
    apiFetch<HfModelInfo[]>(`/post-training/sft/hf-models`),

  listSftArtifacts: () =>
    apiFetch<ArtifactInfo[]>(`/post-training/sft/artifacts`),

  deleteSftArtifact: (jobId: string) =>
    apiFetch<void>(`/post-training/sft/artifacts/${jobId}`, { method: 'DELETE' }),

  // Fusion
  listFusionBackends: () =>
    apiFetch<TrainingBackendInfo[]>(`/post-training/fusion/backends`),

  listFusionTools: () =>
    apiFetch<{ ollama: boolean; mlx_fuse: boolean; peft_fuse: boolean }>(
      `/post-training/fusion/tools`,
    ),

  listFusionJobs: () =>
    apiFetch<FusionJob[]>(`/post-training/fusion/jobs`),

  createFusionJob: (data: {
    name: string;
    project_id?: string;
    backend: string;
    base_model: string;
    adapter_path: string;
    source_job_id?: string;
    convert_to_gguf: boolean;
    register_with_ollama: boolean;
    ollama_name?: string;
  }) =>
    apiFetch<FusionJob>(`/post-training/fusion/jobs`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getFusionJob: (fusionId: string) =>
    apiFetch<FusionJob>(`/post-training/fusion/jobs/${fusionId}`),

  deleteFusionJob: (fusionId: string) =>
    apiFetch<void>(`/post-training/fusion/jobs/${fusionId}`, { method: 'DELETE' }),

  listFusionArtifacts: () =>
    apiFetch<FusionArtifactInfo[]>(`/post-training/fusion/artifacts`),

  deleteFusionArtifact: (fusionId: string) =>
    apiFetch<void>(`/post-training/fusion/artifacts/${fusionId}`, { method: 'DELETE' }),

  // Feedback Runs
  parseFeedbackInputFile: (projectId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiFetch<{ inputs: string[] }>(`${base(projectId)}/feedback-runs/parse-file`, {
      method: 'POST',
      headers: {},
      body: formData,
    });
  },

  listFeedbackRuns: (projectId: string) =>
    apiFetch<FeedbackRun[]>(`${base(projectId)}/feedback-runs`),

  createFeedbackRun: (
    projectId: string,
    data: {
      name: string;
      description?: string;
      prompt_version_id?: string;
      model_config_id?: string;
    },
  ) =>
    apiFetch<FeedbackRun>(`${base(projectId)}/feedback-runs`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getFeedbackRun: (projectId: string, runId: string) =>
    apiFetch<FeedbackRun & { items: FeedbackItem[] }>(
      `${base(projectId)}/feedback-runs/${runId}`,
    ),

  addFeedbackItems: (
    projectId: string,
    runId: string,
    items: Array<{ input_text: string }>,
  ) =>
    apiFetch<FeedbackItem[]>(`${base(projectId)}/feedback-runs/${runId}/items`, {
      method: 'POST',
      body: JSON.stringify(items),
    }),

  generateFeedbackOutputs: (projectId: string, runId: string) =>
    apiFetch<{ detail: string }>(
      `${base(projectId)}/feedback-runs/${runId}/generate`,
      { method: 'POST' },
    ),

  submitFeedback: (
    projectId: string,
    runId: string,
    itemId: string,
    data: {
      rating?: number;
      thumbs?: string;
      preferred_answer?: string;
      corrected_output?: string;
      reviewer_comment?: string;
      error_tags?: string;
      review_status?: string;
    },
  ) =>
    apiFetch<FeedbackItem>(
      `${base(projectId)}/feedback-runs/${runId}/items/${itemId}/review`,
      { method: 'PUT', body: JSON.stringify(data) },
    ),

  deleteFeedbackRun: (projectId: string, runId: string) =>
    apiFetch<void>(`${base(projectId)}/feedback-runs/${runId}`, { method: 'DELETE' }),

  exportFeedbackRun: (projectId: string, runId: string) =>
    apiFetch<string>(`${base(projectId)}/feedback-runs/${runId}/export`),

  feedbackRunToDpoDataset: (projectId: string, runId: string, name: string) =>
    apiFetch<Dataset>(`${base(projectId)}/feedback-runs/${runId}/to-dpo-dataset`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  // Test Cases
  listTestCases: (projectId: string) =>
    apiFetch<TestCase[]>(`${base(projectId)}/test-cases`),

  createTestCase: (
    projectId: string,
    data: {
      name: string;
      input_text: string;
      expected_output: string;
      expected_type?: string;
      tags?: string;
      notes?: string;
      is_golden?: boolean;
      document_id?: string;
      assertions?: AssertionSpec[] | null;
      pass_threshold?: number | null;
    },
  ) =>
    apiFetch<TestCase>(`${base(projectId)}/test-cases`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateTestCase: (
    projectId: string,
    tcId: string,
    data: Partial<{
      name: string;
      input_text: string;
      expected_output: string;
      expected_type: string;
      tags: string;
      notes: string;
      is_golden: boolean;
      assertions: AssertionSpec[] | null;
      pass_threshold: number | null;
    }>,
  ) =>
    apiFetch<TestCase>(`${base(projectId)}/test-cases/${tcId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteTestCase: (projectId: string, tcId: string) =>
    apiFetch<void>(`${base(projectId)}/test-cases/${tcId}`, {
      method: 'DELETE',
    }),

  bulkDeleteTestCases: (projectId: string, ids: string[]) =>
    apiFetch<void>(`${base(projectId)}/test-cases/bulk-delete`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  // Backtest Runs
  listBacktestRuns: (projectId: string) =>
    apiFetch<BacktestRun[]>(`${base(projectId)}/backtest-runs`),

  createBacktestRun: (
    projectId: string,
    data: {
      name: string;
      prompt_version_id: string;
      model_config_id: string;
      pass_threshold?: number;
      judge_model_config_id?: string;
      test_case_ids?: string[];
    },
  ) =>
    apiFetch<BacktestRun>(`${base(projectId)}/backtest-runs`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getBacktestRun: (projectId: string, runId: string) =>
    apiFetch<BacktestRun & { results: BacktestResult[] }>(
      `${base(projectId)}/backtest-runs/${runId}`,
    ),

  deleteBacktestRun: (projectId: string, runId: string) =>
    apiFetch<void>(`${base(projectId)}/backtest-runs/${runId}`, { method: 'DELETE' }),

  // ── Comparison Runs ────────────────────────────────────────────────────────
  listComparisonRuns: (projectId: string) =>
    apiFetch<ComparisonRun[]>(`${base(projectId)}/comparison-runs`),

  createComparisonRun: (
    projectId: string,
    data: {
      name: string;
      // Optional: when omitted, every model_config_id MUST be in `prompt_version_overrides`.
      prompt_version_id?: string;
      model_config_ids: string[];
      // Chain columns: each chain runs end-to-end and the cell stores `{node_name: text}`
      // JSON. Either model_config_ids or chain_ids must be non-empty.
      chain_ids?: string[];
      // {model_config_id: prompt_version_id}. Models not present inherit `prompt_version_id`.
      prompt_version_overrides?: Record<string, string>;
      // Inputs — pass ONE of these:
      //   input_dataset_id (+ optional input_dataset_item_ids): pull rows from a global
      //     InputDataset (sidebar "Datasets" — `input_datasets`, NOT SFT `pt_datasets`).
      //   input_texts: ad-hoc free-text rows.
      input_dataset_id?: string;
      input_dataset_item_ids?: string[];
      input_texts?: string[];
      judge_model_config_id?: string;
    },
  ) =>
    apiFetch<ComparisonRun>(`${base(projectId)}/comparison-runs`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getComparisonRun: (projectId: string, comparisonId: string) =>
    apiFetch<ComparisonRunWithChildren>(`${base(projectId)}/comparison-runs/${comparisonId}`),

  deleteComparisonRun: (projectId: string, comparisonId: string) =>
    apiFetch<void>(`${base(projectId)}/comparison-runs/${comparisonId}`, { method: 'DELETE' }),

  cancelComparisonRun: (projectId: string, comparisonId: string) =>
    apiFetch<ComparisonRun>(`${base(projectId)}/comparison-runs/${comparisonId}/cancel`, {
      method: 'POST',
    }),
};
