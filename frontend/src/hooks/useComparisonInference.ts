import { useCallback, useRef, useState } from 'react';
import { inferenceApi } from '../api/inference';
import { useInferenceStore } from '../stores/inferenceStore';

export interface SlotState {
  output: string;
  isStreaming: boolean;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

const EMPTY_SLOT: SlotState = {
  output: '',
  isStreaming: false,
  error: null,
  startedAt: null,
  completedAt: null,
};

interface ComparisonParams {
  projectId: string;
  prompt_version_id: string;
  document_id?: string;
  input_text?: string;
  modelA_id: string;
  modelB_id: string;
  kb_id?: string | null;
  kb_top_k?: number;
  rag_override_none?: boolean;
}

function parseSSELines(buffer: string, handler: (data: Record<string, unknown>) => void): string {
  const lines = buffer.split('\n');
  const remainder = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data: ')) {
      try {
        handler(JSON.parse(trimmed.slice(6)));
      } catch {
        // skip
      }
    }
  }
  return remainder;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useComparisonInference() {
  const [slots, setSlots] = useState<[SlotState, SlotState]>([{ ...EMPTY_SLOT }, { ...EMPTY_SLOT }]);
  const abortRefs = useRef<[AbortController | null, AbortController | null]>([null, null]);
  const { fetchHistory } = useInferenceStore();

  const updateSlot = (index: 0 | 1, patch: Partial<SlotState>) => {
    setSlots((prev) => {
      const next: [SlotState, SlotState] = [{ ...prev[0] }, { ...prev[1] }];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const streamOne = async (
    index: 0 | 1,
    projectId: string,
    body: {
      prompt_version_id: string;
      model_config_id: string;
      document_id?: string;
      input_text: string;
      kb_id?: string | null;
      kb_top_k?: number;
      rag_override_none?: boolean;
    },
    signal: AbortSignal,
  ) => {
    updateSlot(index, { output: '', isStreaming: true, error: null, startedAt: Date.now(), completedAt: null });

    try {
      const url = inferenceApi.streamUrl(projectId);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Flush remaining buffer: use only functional setSlots updates to avoid
          // stale closure issues (slots captured in closure may be outdated).
          if (buffer.trim()) {
            parseSSELines(buffer + '\n', (data) => {
              if (data.text) {
                setSlots((prev) => {
                  const next: [SlotState, SlotState] = [{ ...prev[0] }, { ...prev[1] }];
                  next[index] = { ...next[index], output: next[index].output + (data.text as string) };
                  return next;
                });
              }
              if (data.error) {
                setSlots((prev) => {
                  const next: [SlotState, SlotState] = [{ ...prev[0] }, { ...prev[1] }];
                  next[index] = { ...next[index], error: data.error as string };
                  return next;
                });
              }
            });
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        buffer = parseSSELines(buffer, (data) => {
          if (data.text) {
            setSlots((prev) => {
              const next: [SlotState, SlotState] = [{ ...prev[0] }, { ...prev[1] }];
              next[index] = { ...next[index], output: next[index].output + (data.text as string) };
              return next;
            });
          }
          if (data.error) updateSlot(index, { error: data.error as string });
        });
      }

      updateSlot(index, { isStreaming: false, completedAt: Date.now() });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        updateSlot(index, { error: (e as Error).message });
      }
      updateSlot(index, { isStreaming: false, completedAt: Date.now() });
    }
  };

  const startComparison = useCallback((params: ComparisonParams) => {
    // Abort any existing
    abortRefs.current[0]?.abort();
    abortRefs.current[1]?.abort();

    const controllerA = new AbortController();
    const controllerB = new AbortController();
    abortRefs.current = [controllerA, controllerB];

    setSlots([{ ...EMPTY_SLOT, isStreaming: true, startedAt: Date.now() }, { ...EMPTY_SLOT, isStreaming: true, startedAt: Date.now() }]);

    const body: {
      prompt_version_id: string;
      document_id?: string;
      input_text: string;
      kb_id?: string | null;
      kb_top_k?: number;
      rag_override_none?: boolean;
    } = {
      prompt_version_id: params.prompt_version_id,
      document_id: params.document_id,
      input_text: params.input_text || '',
    };
    if (params.kb_id !== undefined) body.kb_id = params.kb_id;
    if (params.kb_top_k !== undefined) body.kb_top_k = params.kb_top_k;
    if (params.rag_override_none) body.rag_override_none = true;

    // Run both in parallel
    const promiseA = streamOne(0, params.projectId, { ...body, model_config_id: params.modelA_id }, controllerA.signal);
    const promiseB = streamOne(1, params.projectId, { ...body, model_config_id: params.modelB_id }, controllerB.signal);

    // After both finish, refresh history
    Promise.allSettled([promiseA, promiseB]).then(async () => {
      await delay(500);
      await fetchHistory(params.projectId);
    });
  }, [fetchHistory]);

  const stopComparison = useCallback(() => {
    abortRefs.current[0]?.abort();
    abortRefs.current[1]?.abort();
    abortRefs.current = [null, null];
    setSlots((prev) => [
      { ...prev[0], isStreaming: false, completedAt: prev[0].completedAt ?? Date.now() },
      { ...prev[1], isStreaming: false, completedAt: prev[1].completedAt ?? Date.now() },
    ]);
  }, []);

  const isActive = slots[0].isStreaming || slots[1].isStreaming;

  return { slots, isActive, startComparison, stopComparison };
}
