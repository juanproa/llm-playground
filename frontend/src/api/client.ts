const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

/**
 * Error thrown by `apiFetch` for non-2xx responses. Includes the HTTP status
 * and the parsed response body so callers can react to specific status codes
 * (e.g. 409 for backtest duplicates) without re-fetching or string-parsing.
 */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    // FastAPI puts custom error payloads under `detail` — surface a string for
    // .message, but keep the full structured body on `error.body` so callers
    // who care (e.g. duplicate-backtest 409s) can read structured fields.
    const detail = (body as { detail?: unknown })?.detail;
    let message: string;
    if (typeof detail === 'string') {
      message = detail;
    } else if (detail && typeof detail === 'object' && 'message' in detail) {
      message = String((detail as { message: unknown }).message);
    } else {
      message = `HTTP ${response.status}`;
    }
    throw new ApiError(message, response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function apiStreamUrl(path: string): string {
  return `${BASE_URL}${path}`;
}
