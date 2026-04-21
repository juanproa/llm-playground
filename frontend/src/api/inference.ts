import { apiFetch, apiStreamUrl } from './client';
import type { InferenceRun } from '../types';

interface InferenceRequest {
  prompt_version_id: string;
  model_config_id: string;
  document_id?: string;
  input_text?: string;
}

export const inferenceApi = {
  run: (projectId: string, data: InferenceRequest) =>
    apiFetch<InferenceRun>(`/projects/${projectId}/inference/run`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  history: (projectId: string) =>
    apiFetch<InferenceRun[]>(`/projects/${projectId}/inference/history`),
  get: (runId: string) => apiFetch<InferenceRun>(`/inference/${runId}`),
  streamUrl: (projectId: string) => apiStreamUrl(`/projects/${projectId}/inference/stream`),
  deleteRun: (runId: string) => apiFetch<void>(`/inference/${runId}`, { method: 'DELETE' }),
  deleteBulk: (projectId: string, runIds: string[]) =>
    apiFetch<void>(`/projects/${projectId}/inference/delete-bulk`, {
      method: 'POST',
      body: JSON.stringify({ run_ids: runIds }),
    }),
  clearHistory: (projectId: string) =>
    apiFetch<void>(`/projects/${projectId}/inference/history`, { method: 'DELETE' }),
};
