import { apiFetch } from './client';
import type {
  Chain,
  ChainEdge,
  ChainListItem,
  ChainNode,
  ChainRun,
  ChainRunListItem,
  EdgeAssertion,
} from '../types';

export const chainsApi = {
  list: (projectId: string) => apiFetch<ChainListItem[]>(`/projects/${projectId}/chains`),
  get: (id: string) => apiFetch<Chain>(`/chains/${id}`),
  create: (projectId: string, data: { name: string; description?: string }) =>
    apiFetch<Chain>(`/projects/${projectId}/chains`, { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; description?: string }) =>
    apiFetch<Chain>(`/chains/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => apiFetch<void>(`/chains/${id}`, { method: 'DELETE' }),
  duplicate: (id: string) =>
    apiFetch<Chain>(`/chains/${id}/duplicate`, { method: 'POST', body: '{}' }),

  createNode: (
    chainId: string,
    data: {
      name: string;
      position_x?: number;
      position_y?: number;
      prompt_version_id?: string | null;
      model_config_id?: string | null;
      kb_id?: string | null;
      kb_top_k?: number | null;
      kb_query_template?: string | null;
      input_text?: string | null;
      input_document_id?: string | null;
    },
  ) => apiFetch<ChainNode>(`/chains/${chainId}/nodes`, { method: 'POST', body: JSON.stringify(data) }),
  updateNode: (
    nodeId: string,
    data: Partial<{
      name: string;
      position_x: number;
      position_y: number;
      prompt_version_id: string | null;
      model_config_id: string | null;
      kb_id: string | null;
      kb_top_k: number | null;
      kb_query_template: string | null;
      input_text: string | null;
      input_document_id: string | null;
    }>,
  ) => apiFetch<ChainNode>(`/chain-nodes/${nodeId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNode: (nodeId: string) => apiFetch<void>(`/chain-nodes/${nodeId}`, { method: 'DELETE' }),

  createEdge: (
    chainId: string,
    data: { source_node_id: string; target_node_id: string; assertion?: EdgeAssertion | null },
  ) => apiFetch<ChainEdge>(`/chains/${chainId}/edges`, { method: 'POST', body: JSON.stringify(data) }),
  updateEdge: (edgeId: string, data: { assertion?: EdgeAssertion | null; clear_assertion?: boolean }) =>
    apiFetch<ChainEdge>(`/chain-edges/${edgeId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEdge: (edgeId: string) => apiFetch<void>(`/chain-edges/${edgeId}`, { method: 'DELETE' }),

  // Runs
  startRun: (chainId: string) =>
    apiFetch<ChainRun>(`/chains/${chainId}/runs`, { method: 'POST', body: '{}' }),
  listRuns: (chainId: string) => apiFetch<ChainRunListItem[]>(`/chains/${chainId}/runs`),
  getRun: (runId: string) => apiFetch<ChainRun>(`/chain-runs/${runId}`),
  deleteRun: (runId: string) => apiFetch<void>(`/chain-runs/${runId}`, { method: 'DELETE' }),
  // Idempotent: server returns the (now 'cancelling' or terminal) run state.
  cancelRun: (runId: string) =>
    apiFetch<ChainRun>(`/chain-runs/${runId}/cancel`, { method: 'POST', body: '{}' }),
};
