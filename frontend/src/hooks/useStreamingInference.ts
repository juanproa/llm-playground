import { useCallback, useRef } from 'react';
import { inferenceApi } from '../api/inference';
import { useInferenceStore } from '../stores/inferenceStore';

interface StreamParams {
  projectId: string;
  prompt_version_id: string;
  model_config_id: string;
  document_id?: string;
  input_text?: string;
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
        // skip malformed JSON
      }
    }
  }
  return remainder;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useStreamingInference() {
  const { clearOutput, setStreaming, appendOutput, setError, fetchHistory } = useInferenceStore();
  const abortRef = useRef<AbortController | null>(null);

  const refreshUntilSaved = useCallback(async (projectId: string, maxRetries = 5) => {
    for (let i = 0; i < maxRetries; i++) {
      await delay(i === 0 ? 300 : 800);
      await fetchHistory(projectId);
      const { history } = useInferenceStore.getState();
      const hasRunning = history.some((r) => r.status === 'running');
      if (!hasRunning) return;
    }
  }, [fetchHistory]);

  const stopStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStreaming(false);
  }, [setStreaming]);

  const startStream = useCallback(async (params: StreamParams) => {
    // Abort any existing stream
    if (abortRef.current) abortRef.current.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    clearOutput();
    setStreaming(true);
    setError(null);

    try {
      const url = inferenceApi.streamUrl(params.projectId);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt_version_id: params.prompt_version_id,
          model_config_id: params.model_config_id,
          document_id: params.document_id,
          input_text: params.input_text || '',
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            parseSSELines(buffer + '\n', (data) => {
              if (data.text) appendOutput(data.text as string);
              if (data.error) setError(data.error as string);
            });
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        buffer = parseSSELines(buffer, (data) => {
          if (data.text) appendOutput(data.text as string);
          if (data.error) setError(data.error as string);
        });
      }

      setStreaming(false);
      abortRef.current = null;
      await refreshUntilSaved(params.projectId);
    } catch (e) {
      const isAbort = (e as Error).name === 'AbortError';
      if (!isAbort) {
        setError((e as Error).message);
      }
      setStreaming(false);
      abortRef.current = null;
      await delay(500);
      await fetchHistory(params.projectId).catch(() => {});
    }
  }, [clearOutput, setStreaming, appendOutput, setError, fetchHistory, refreshUntilSaved]);

  return { startStream, stopStream };
}
