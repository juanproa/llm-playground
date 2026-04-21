import { create } from 'zustand';
import type { InferenceRun } from '../types';
import { inferenceApi } from '../api/inference';

interface InferenceStore {
  history: InferenceRun[];
  currentOutput: string;
  isStreaming: boolean;
  error: string | null;
  fetchHistory: (projectId: string) => Promise<void>;
  clearOutput: () => void;
  setStreaming: (streaming: boolean) => void;
  appendOutput: (text: string) => void;
  setError: (error: string | null) => void;
  addRun: (run: InferenceRun) => void;
  deleteRun: (runId: string) => Promise<void>;
  deleteBulk: (projectId: string, runIds: string[]) => Promise<void>;
  clearHistory: (projectId: string) => Promise<void>;
}

export const useInferenceStore = create<InferenceStore>((set) => ({
  history: [],
  currentOutput: '',
  isStreaming: false,
  error: null,

  fetchHistory: async (projectId) => {
    try {
      const history = await inferenceApi.history(projectId);
      set({ history });
    } catch {
      // silent
    }
  },

  clearOutput: () => set({ currentOutput: '', error: null }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  appendOutput: (text) => set((state) => ({ currentOutput: state.currentOutput + text })),
  setError: (error) => set({ error }),
  addRun: (run) => set((state) => ({ history: [run, ...state.history] })),

  deleteRun: async (runId) => {
    await inferenceApi.deleteRun(runId);
    set((state) => ({ history: state.history.filter((r) => r.id !== runId) }));
  },

  deleteBulk: async (projectId, runIds) => {
    await inferenceApi.deleteBulk(projectId, runIds);
    set((state) => ({ history: state.history.filter((r) => !runIds.includes(r.id)) }));
  },

  clearHistory: async (projectId) => {
    await inferenceApi.clearHistory(projectId);
    set({ history: [] });
  },
}));
