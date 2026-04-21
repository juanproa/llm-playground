import { create } from 'zustand';
import type { ModelConfig } from '../types';
import { modelsApi } from '../api/models';

interface ModelStore {
  models: ModelConfig[];
  loading: boolean;
  error: string | null;
  fetchModels: () => Promise<void>;
  createModel: (data: Parameters<typeof modelsApi.create>[0]) => Promise<ModelConfig>;
  updateModel: (id: string, data: Parameters<typeof modelsApi.update>[1]) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  testModel: (id: string) => Promise<string>;
}

export const useModelStore = create<ModelStore>((set) => ({
  models: [],
  loading: false,
  error: null,

  fetchModels: async () => {
    set({ loading: true, error: null });
    try {
      const models = await modelsApi.list();
      set({ models, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  createModel: async (data) => {
    const model = await modelsApi.create(data);
    set((state) => ({ models: [model, ...state.models] }));
    return model;
  },

  updateModel: async (id, data) => {
    const updated = await modelsApi.update(id, data);
    set((state) => ({
      models: state.models.map((m) => (m.id === id ? updated : m)),
    }));
  },

  deleteModel: async (id) => {
    await modelsApi.delete(id);
    set((state) => ({ models: state.models.filter((m) => m.id !== id) }));
  },

  testModel: async (id) => {
    const result = await modelsApi.test(id);
    return result.response;
  },
}));
