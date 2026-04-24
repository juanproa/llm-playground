import { apiFetch } from './client';
import type {
  InputDataset,
  InputDatasetItem,
  InputDatasetWithItems,
} from '../types';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export const inputDatasetsApi = {
  list: () => apiFetch<InputDataset[]>(`/input-datasets`),
  get: (id: string) => apiFetch<InputDatasetWithItems>(`/input-datasets/${id}`),
  create: (data: { name: string; description?: string }) =>
    apiFetch<InputDataset>(`/input-datasets`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { name?: string; description?: string }) =>
    apiFetch<InputDataset>(`/input-datasets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<void>(`/input-datasets/${id}`, { method: 'DELETE' }),

  listItems: (id: string) =>
    apiFetch<InputDatasetItem[]>(`/input-datasets/${id}/items`),

  createItem: (
    id: string,
    data: { name?: string; content: string; tags?: string; metadata_json?: string },
  ) =>
    apiFetch<InputDatasetItem>(`/input-datasets/${id}/items`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateItem: (
    datasetId: string,
    itemId: string,
    data: { name?: string; content?: string; tags?: string; metadata_json?: string },
  ) =>
    apiFetch<InputDatasetItem>(`/input-datasets/${datasetId}/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteItem: (datasetId: string, itemId: string) =>
    apiFetch<void>(`/input-datasets/${datasetId}/items/${itemId}`, { method: 'DELETE' }),

  uploadPdf: async (
    id: string,
    file: File,
    opts?: { name?: string; tags?: string },
  ): Promise<InputDatasetItem> => {
    const fd = new FormData();
    fd.append('file', file);
    if (opts?.name) fd.append('name', opts.name);
    if (opts?.tags) fd.append('tags', opts.tags);
    const res = await fetch(`${BASE_URL}/input-datasets/${id}/items/upload-pdf`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },

  uploadBatchPdf: async (id: string, files: File[]): Promise<InputDatasetItem[]> => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const res = await fetch(`${BASE_URL}/input-datasets/${id}/items/upload-pdfs`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },

  uploadCsv: async (
    id: string,
    file: File,
    opts?: { contentColumn?: string; nameColumn?: string },
  ): Promise<InputDatasetItem[]> => {
    const fd = new FormData();
    fd.append('file', file);
    if (opts?.contentColumn) fd.append('content_column', opts.contentColumn);
    if (opts?.nameColumn) fd.append('name_column', opts.nameColumn);
    const res = await fetch(`${BASE_URL}/input-datasets/${id}/upload-csv`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },

  copyFromKb: (
    kbId: string,
    data?: { dataset_name?: string; dataset_description?: string },
  ) =>
    apiFetch<InputDatasetWithItems>(`/input-datasets/copy-from-kb/${kbId}`, {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    }),
};
