import { apiFetch } from './client';
import type { Document } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export const documentsApi = {
  list: (projectId: string) => apiFetch<Document[]>(`/projects/${projectId}/documents`),
  get: (id: string) => apiFetch<Document>(`/documents/${id}`),
  paste: (projectId: string, data: { name: string; content: string }) =>
    apiFetch<Document>(`/projects/${projectId}/documents/paste`, { method: 'POST', body: JSON.stringify(data) }),
  upload: async (projectId: string, file: File): Promise<Document> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${BASE_URL}/projects/${projectId}/documents/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }
    return response.json();
  },
  delete: (id: string) => apiFetch<void>(`/documents/${id}`, { method: 'DELETE' }),
};
