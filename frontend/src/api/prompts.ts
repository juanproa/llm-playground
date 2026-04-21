import { apiFetch } from './client';
import type { Prompt, PromptVersion } from '../types';

export const promptsApi = {
  list: (projectId: string) => apiFetch<Prompt[]>(`/projects/${projectId}/prompts`),
  get: (id: string) => apiFetch<Prompt>(`/prompts/${id}`),
  create: (projectId: string, data: { name: string; content: string; system_message?: string; label?: string }) =>
    apiFetch<Prompt>(`/projects/${projectId}/prompts`, { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string }) =>
    apiFetch<Prompt>(`/prompts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => apiFetch<void>(`/prompts/${id}`, { method: 'DELETE' }),
  createVersion: (promptId: string, data: { content: string; system_message?: string; label?: string }) =>
    apiFetch<PromptVersion>(`/prompts/${promptId}/versions`, { method: 'POST', body: JSON.stringify(data) }),
  listVersions: (promptId: string) => apiFetch<PromptVersion[]>(`/prompts/${promptId}/versions`),
  updateVersion: (versionId: string, data: { label?: string; is_active?: boolean }) =>
    apiFetch<PromptVersion>(`/prompt-versions/${versionId}`, { method: 'PUT', body: JSON.stringify(data) }),
};
