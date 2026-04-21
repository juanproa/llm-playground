import { create } from 'zustand';
import type { Prompt, PromptVersion } from '../types';
import { promptsApi } from '../api/prompts';

interface PromptStore {
  prompts: Prompt[];
  loading: boolean;
  fetchPrompts: (projectId: string) => Promise<void>;
  createPrompt: (projectId: string, data: { name: string; content: string; system_message?: string }) => Promise<Prompt>;
  deletePrompt: (id: string) => Promise<void>;
  createVersion: (promptId: string, data: { content: string; system_message?: string; label?: string }) => Promise<PromptVersion>;
  setActiveVersion: (versionId: string) => Promise<void>;
}

export const usePromptStore = create<PromptStore>((set) => ({
  prompts: [],
  loading: false,

  fetchPrompts: async (projectId) => {
    set({ loading: true });
    try {
      const prompts = await promptsApi.list(projectId);
      set({ prompts, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createPrompt: async (projectId, data) => {
    const prompt = await promptsApi.create(projectId, data);
    set((state) => ({ prompts: [prompt, ...state.prompts] }));
    return prompt;
  },

  deletePrompt: async (id) => {
    await promptsApi.delete(id);
    set((state) => ({ prompts: state.prompts.filter((p) => p.id !== id) }));
  },

  createVersion: async (promptId, data) => {
    const version = await promptsApi.createVersion(promptId, data);
    const updated = await promptsApi.get(promptId);
    set((state) => ({
      prompts: state.prompts.map((p) => (p.id === promptId ? updated : p)),
    }));
    return version;
  },

  setActiveVersion: async (versionId) => {
    await promptsApi.updateVersion(versionId, { is_active: true });
  },
}));
