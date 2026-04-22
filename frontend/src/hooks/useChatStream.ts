/**
 * useChatStream — sends a user message to a chat session and streams back
 * the assistant reply via SSE.  Keeps a local optimistic view of the new
 * user + assistant messages so the UI can render as tokens arrive.
 */
import { useCallback, useRef, useState } from 'react';
import { chatApi } from '../api/chat';
import type { ChatMessage } from '../types';

export interface StreamingMessage {
  id: string | null;   // populated from meta event once the backend assigns one
  role: 'user' | 'assistant';
  content: string;
  isStreaming: boolean;
  error: string | null;
  created_at: string;
}

export function useChatStream() {
  const [pending, setPending] = useState<[StreamingMessage, StreamingMessage] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending((prev) => prev && [
      { ...prev[0], isStreaming: false },
      { ...prev[1], isStreaming: false },
    ]);
  }, []);

  const reset = useCallback(() => {
    setPending(null);
  }, []);

  const send = useCallback(async (
    sessionId: string,
    content: string,
    onDone?: (persisted: { userId: string | null; assistantId: string | null; assistantText: string }) => void,
  ) => {
    // Abort any in-flight
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const now = new Date().toISOString();
    const userMsg: StreamingMessage = {
      id: null,
      role: 'user',
      content,
      isStreaming: false,
      error: null,
      created_at: now,
    };
    const assistantMsg: StreamingMessage = {
      id: null,
      role: 'assistant',
      content: '',
      isStreaming: true,
      error: null,
      created_at: now,
    };
    setPending([userMsg, assistantMsg]);

    try {
      const response = await fetch(chatApi.sendMessageUrl(sessionId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';
      let userId: string | null = null;
      let assistantId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse complete SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim());
            if (payload.meta) {
              userId = payload.meta.user_id;
              assistantId = payload.meta.assistant_id;
              setPending((prev) => prev && [
                { ...prev[0], id: userId },
                { ...prev[1], id: assistantId },
              ]);
            } else if (payload.text) {
              assistantText += payload.text as string;
              setPending((prev) => prev && [
                prev[0],
                { ...prev[1], content: assistantText },
              ]);
            } else if (payload.error) {
              setPending((prev) => prev && [
                prev[0],
                { ...prev[1], isStreaming: false, error: payload.error as string },
              ]);
            }
          } catch {
            // ignore malformed SSE line
          }
        }
      }

      setPending((prev) => prev && [
        prev[0],
        { ...prev[1], isStreaming: false },
      ]);

      onDone?.({ userId, assistantId, assistantText });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setPending((prev) => prev && [
        prev[0],
        { ...prev[1], isStreaming: false, error: (e as Error).message },
      ]);
    } finally {
      abortRef.current = null;
    }
  }, []);

  return { pending, send, stop, reset };
}

/** Merge the server-persisted history with an optional pending pair. */
export function mergeMessages(
  history: ChatMessage[],
  pending: [StreamingMessage, StreamingMessage] | null,
): Array<ChatMessage | StreamingMessage> {
  if (!pending) return history;
  // If the pending pair has no IDs yet, or the history doesn't include them,
  // append them.  Otherwise history already has the authoritative versions.
  const [u, a] = pending;
  const historyHasAssistant = a.id && history.some((m) => m.id === a.id);
  if (historyHasAssistant) return history;
  return [...history, u, a];
}
