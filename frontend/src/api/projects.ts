import { apiFetch } from './client';
import type { Project } from '../types';

export const projectsApi = {
  list: (search?: string) =>
    apiFetch<Project[]>(`/projects${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  get: (id: string) => apiFetch<Project>(`/projects/${id}`),
  create: (data: { name: string; description?: string }) =>
    apiFetch<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Project>) =>
    apiFetch<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => apiFetch<void>(`/projects/${id}`, { method: 'DELETE' }),
};
