import { apiFetch } from './client';
import type { ModelConfig } from '../types';

interface ModelConfigCreate {
  name: string;
  provider: string;
  model_id: string;
  namespace?: string;
  api_key?: string;
  base_url?: string;
  max_tokens?: number;
  temperature?: number;
  extra_params?: Record<string, unknown>;
  adapter_path?: string;
  enable_thinking?: boolean;
}

export interface MlxStatus {
  model_id: string;
  adapter_path: string | null;
  loaded: boolean;
  downloaded: boolean;
  preload_state: 'running' | 'done' | 'error' | null;
  preload_error: string | null;
  download_state: 'listing' | 'downloading' | 'done' | 'error' | null;
  download_total_bytes: number;
  download_done_bytes: number;
  download_pct: number;
  download_current_file: string | null;
}

export const modelsApi = {
  list: () => apiFetch<ModelConfig[]>('/models'),
  get: (id: string) => apiFetch<ModelConfig>(`/models/${id}`),
  create: (data: ModelConfigCreate) =>
    apiFetch<ModelConfig>('/models', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<ModelConfigCreate & { is_enabled?: boolean }>) =>
    apiFetch<ModelConfig>(`/models/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => apiFetch<void>(`/models/${id}`, { method: 'DELETE' }),
  test: (id: string) => apiFetch<{ status: string; response: string }>(`/models/${id}/test`, { method: 'POST' }),

  // MLX-local status + preload + unload
  mlxStatus: (id: string) => apiFetch<MlxStatus>(`/models/${id}/mlx-status`),
  mlxPreload: (id: string) =>
    apiFetch<MlxStatus>(`/models/${id}/mlx-preload`, { method: 'POST' }),
  mlxUnload: (id: string) =>
    apiFetch<MlxStatus & { unloaded: boolean }>(`/models/${id}/mlx-unload`, { method: 'POST' }),
};
