import { apiFetch } from './client';
import type { ChatSession, ChatSessionWithMessages } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export const chatApi = {
  listSessions: () => apiFetch<ChatSession[]>(`/chat/sessions`),

  getSession: (id: string) => apiFetch<ChatSessionWithMessages>(`/chat/sessions/${id}`),

  createSession: (data: { name: string; model_config_id: string; system_prompt?: string }) =>
    apiFetch<ChatSession>(`/chat/sessions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateSession: (
    id: string,
    data: { name?: string; model_config_id?: string; system_prompt?: string },
  ) =>
    apiFetch<ChatSession>(`/chat/sessions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteSession: (id: string) =>
    apiFetch<void>(`/chat/sessions/${id}`, { method: 'DELETE' }),

  /**
   * Stream a new turn.  Returns a Response whose body should be read as SSE.
   * Each `data: ...` line is a JSON object with one of:
   *   {meta: {user_id, assistant_id}}
   *   {text: "chunk"}
   *   {error: "..."}
   */
  sendMessageUrl: (sessionId: string): string =>
    `${BASE_URL}/chat/sessions/${sessionId}/messages`,
};
