import { apiFetch } from './client';
import type { KnowledgeBase, KnowledgeBaseItem, KnowledgeBaseWithItems } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export const knowledgeBaseApi = {
  // Bases
  list: () => apiFetch<KnowledgeBase[]>(`/knowledge-bases`),
  get: (id: string) => apiFetch<KnowledgeBaseWithItems>(`/knowledge-bases/${id}`),
  create: (data: { name: string; description?: string }) =>
    apiFetch<KnowledgeBase>(`/knowledge-bases`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { name?: string; description?: string }) =>
    apiFetch<KnowledgeBase>(`/knowledge-bases/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<void>(`/knowledge-bases/${id}`, { method: 'DELETE' }),

  // Items
  listItems: (kbId: string) =>
    apiFetch<KnowledgeBaseItem[]>(`/knowledge-bases/${kbId}/items`),

  createItem: (
    kbId: string,
    data: { name: string; description?: string; content: string; source_type?: string },
  ) =>
    apiFetch<KnowledgeBaseItem>(`/knowledge-bases/${kbId}/items`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateItem: (
    kbId: string,
    itemId: string,
    data: { name?: string; description?: string; content?: string },
  ) =>
    apiFetch<KnowledgeBaseItem>(`/knowledge-bases/${kbId}/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteItem: (kbId: string, itemId: string) =>
    apiFetch<void>(`/knowledge-bases/${kbId}/items/${itemId}`, { method: 'DELETE' }),

  // Uploads (multipart — use raw fetch so we don't force JSON content-type)
  uploadPdf: async (kbId: string, file: File, description?: string): Promise<KnowledgeBaseItem> => {
    const fd = new FormData();
    fd.append('file', file);
    if (description) fd.append('description', description);
    const res = await fetch(`${BASE_URL}/knowledge-bases/${kbId}/items/upload-pdf`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },

  uploadBatchPdf: async (kbId: string, files: File[]): Promise<KnowledgeBaseItem[]> => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const res = await fetch(`${BASE_URL}/knowledge-bases/${kbId}/items/upload-pdfs`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },

  uploadCsv: async (kbId: string, file: File): Promise<KnowledgeBaseItem[]> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE_URL}/knowledge-bases/${kbId}/items/upload-csv`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },
};
