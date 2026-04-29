import { create } from 'zustand';
import { chainsApi } from '../api/chains';
import type {
  Chain,
  ChainEdge,
  ChainListItem,
  ChainNode,
  ChainRun,
  ChainRunListItem,
  EdgeAssertion,
} from '../types';

type NodePatch = Partial<{
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
}>;

interface ChainStore {
  chains: ChainListItem[];
  currentChain: Chain | null;
  loading: boolean;
  // Run state
  runs: ChainRunListItem[];
  currentRun: ChainRun | null;
  fetchChains: (projectId: string) => Promise<void>;
  fetchChain: (chainId: string) => Promise<Chain | null>;
  createChain: (projectId: string, data: { name: string; description?: string }) => Promise<Chain>;
  updateChain: (chainId: string, data: { name?: string; description?: string }) => Promise<Chain>;
  duplicateChain: (chainId: string) => Promise<Chain>;
  deleteChain: (chainId: string) => Promise<void>;
  clearCurrent: () => void;
  fetchRuns: (chainId: string) => Promise<void>;
  fetchRun: (runId: string) => Promise<ChainRun | null>;
  startRun: (chainId: string) => Promise<ChainRun>;
  deleteRun: (runId: string) => Promise<void>;
  cancelRun: (runId: string) => Promise<ChainRun>;
  clearCurrentRun: () => void;

  // Node mutations — all update `currentChain` optimistically/after the API call.
  createNode: (
    chainId: string,
    data: {
      name: string;
      position_x: number;
      position_y: number;
      input_text?: string | null;
    },
  ) => Promise<ChainNode>;
  updateNode: (nodeId: string, patch: NodePatch) => Promise<ChainNode>;
  deleteNode: (nodeId: string) => Promise<void>;

  // Edge mutations
  createEdge: (
    chainId: string,
    data: { source_node_id: string; target_node_id: string; assertion?: EdgeAssertion | null },
  ) => Promise<ChainEdge>;
  updateEdgeAssertion: (
    edgeId: string,
    assertion: EdgeAssertion | null,
  ) => Promise<ChainEdge>;
  deleteEdge: (edgeId: string) => Promise<void>;
}

function replaceNode(chain: Chain, node: ChainNode): Chain {
  return { ...chain, nodes: chain.nodes.map((n) => (n.id === node.id ? node : n)) };
}

function appendNode(chain: Chain, node: ChainNode): Chain {
  return { ...chain, nodes: [...chain.nodes, node] };
}

function removeNode(chain: Chain, nodeId: string): Chain {
  return {
    ...chain,
    nodes: chain.nodes.filter((n) => n.id !== nodeId),
    edges: chain.edges.filter(
      (e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId,
    ),
  };
}

function appendEdge(chain: Chain, edge: ChainEdge): Chain {
  return { ...chain, edges: [...chain.edges, edge] };
}

function replaceEdge(chain: Chain, edge: ChainEdge): Chain {
  return { ...chain, edges: chain.edges.map((e) => (e.id === edge.id ? edge : e)) };
}

function removeEdge(chain: Chain, edgeId: string): Chain {
  return { ...chain, edges: chain.edges.filter((e) => e.id !== edgeId) };
}

// Module-scoped counter used to discard stale fetchChain responses. When the
// user clicks rapidly between chains, in-flight fetches can resolve out of
// order — without this, a slow response for chain A could land after the user
// has already moved to chain B and overwrite it.
let chainFetchSeq = 0;

export const useChainStore = create<ChainStore>((set) => ({
  chains: [],
  currentChain: null,
  loading: false,
  runs: [],
  currentRun: null,

  fetchChains: async (projectId) => {
    set({ loading: true });
    try {
      const chains = await chainsApi.list(projectId);
      set({ chains, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchChain: async (chainId) => {
    const seq = ++chainFetchSeq;
    // Clear immediately so the canvas doesn't show stale chain data while the
    // new fetch is in flight.
    set({ currentChain: null });
    try {
      const chain = await chainsApi.get(chainId);
      // Bail if a newer fetch has been started since — its response is the
      // one the user is waiting for.
      if (seq !== chainFetchSeq) return chain;
      set({ currentChain: chain });
      return chain;
    } catch {
      if (seq === chainFetchSeq) {
        set({ currentChain: null });
      }
      return null;
    }
  },

  createChain: async (projectId, data) => {
    const chain = await chainsApi.create(projectId, data);
    set((state) => ({
      chains: [
        {
          id: chain.id,
          project_id: chain.project_id,
          name: chain.name,
          description: chain.description,
          created_at: chain.created_at,
          updated_at: chain.updated_at,
          node_count: chain.nodes.length,
          edge_count: chain.edges.length,
        },
        ...state.chains,
      ],
    }));
    return chain;
  },

  updateChain: async (chainId, data) => {
    const chain = await chainsApi.update(chainId, data);
    set((state) => ({
      chains: state.chains.map((c) =>
        c.id === chainId
          ? {
              ...c,
              name: chain.name,
              description: chain.description,
              updated_at: chain.updated_at,
            }
          : c,
      ),
      // If the renamed chain is the one currently open, swap in the fresh
      // metadata so the header reflects it without a refetch.
      currentChain:
        state.currentChain?.id === chainId
          ? { ...state.currentChain, name: chain.name, description: chain.description, updated_at: chain.updated_at }
          : state.currentChain,
    }));
    return chain;
  },

  duplicateChain: async (chainId) => {
    const chain = await chainsApi.duplicate(chainId);
    set((state) => ({
      chains: [
        {
          id: chain.id,
          project_id: chain.project_id,
          name: chain.name,
          description: chain.description,
          created_at: chain.created_at,
          updated_at: chain.updated_at,
          node_count: chain.nodes.length,
          edge_count: chain.edges.length,
        },
        ...state.chains,
      ],
    }));
    return chain;
  },

  deleteChain: async (chainId) => {
    await chainsApi.delete(chainId);
    set((state) => ({
      chains: state.chains.filter((c) => c.id !== chainId),
      currentChain: state.currentChain?.id === chainId ? null : state.currentChain,
    }));
  },

  clearCurrent: () => set({ currentChain: null }),

  createNode: async (chainId, data) => {
    const node = await chainsApi.createNode(chainId, data);
    set((state) => ({
      currentChain:
        state.currentChain && state.currentChain.id === chainId
          ? appendNode(state.currentChain, node)
          : state.currentChain,
    }));
    return node;
  },

  updateNode: async (nodeId, patch) => {
    // Optimistic merge so the UI reflects edits (especially drag positions)
    // immediately, without waiting on the API round-trip. Otherwise the node
    // briefly snaps back to its server position between mouseup and response.
    set((state) => {
      if (!state.currentChain) return state;
      const optimistic = state.currentChain.nodes.map((n) =>
        n.id === nodeId ? { ...n, ...patch } : n,
      ) as typeof state.currentChain.nodes;
      return { currentChain: { ...state.currentChain, nodes: optimistic } };
    });
    const node = await chainsApi.updateNode(nodeId, patch);
    set((state) => ({
      currentChain: state.currentChain ? replaceNode(state.currentChain, node) : state.currentChain,
    }));
    return node;
  },

  deleteNode: async (nodeId) => {
    await chainsApi.deleteNode(nodeId);
    set((state) => ({
      currentChain: state.currentChain ? removeNode(state.currentChain, nodeId) : state.currentChain,
    }));
  },

  createEdge: async (chainId, data) => {
    const edge = await chainsApi.createEdge(chainId, data);
    set((state) => ({
      currentChain:
        state.currentChain && state.currentChain.id === chainId
          ? appendEdge(state.currentChain, edge)
          : state.currentChain,
    }));
    return edge;
  },

  updateEdgeAssertion: async (edgeId, assertion) => {
    const edge = await chainsApi.updateEdge(
      edgeId,
      assertion === null ? { clear_assertion: true } : { assertion },
    );
    set((state) => ({
      currentChain: state.currentChain ? replaceEdge(state.currentChain, edge) : state.currentChain,
    }));
    return edge;
  },

  deleteEdge: async (edgeId) => {
    await chainsApi.deleteEdge(edgeId);
    set((state) => ({
      currentChain: state.currentChain ? removeEdge(state.currentChain, edgeId) : state.currentChain,
    }));
  },

  fetchRuns: async (chainId) => {
    try {
      const runs = await chainsApi.listRuns(chainId);
      set({ runs });
    } catch {
      set({ runs: [] });
    }
  },

  fetchRun: async (runId) => {
    try {
      const run = await chainsApi.getRun(runId);
      set({ currentRun: run });
      return run;
    } catch {
      return null;
    }
  },

  startRun: async (chainId) => {
    const run = await chainsApi.startRun(chainId);
    set((state) => ({
      currentRun: run,
      runs: [
        {
          id: run.id,
          chain_id: run.chain_id,
          status: run.status,
          error_message: run.error_message,
          started_at: run.started_at,
          completed_at: run.completed_at,
          created_at: run.created_at,
        },
        ...state.runs,
      ],
    }));
    return run;
  },

  deleteRun: async (runId) => {
    await chainsApi.deleteRun(runId);
    set((state) => ({
      runs: state.runs.filter((r) => r.id !== runId),
      currentRun: state.currentRun?.id === runId ? null : state.currentRun,
    }));
  },

  cancelRun: async (runId) => {
    // Server transitions to 'cancelling' (then 'cancelled' between nodes).
    // Update the in-memory run immediately so the Stop button reflects the
    // transition without waiting on the next poll tick.
    const updated = await chainsApi.cancelRun(runId);
    set((state) => ({
      currentRun: state.currentRun?.id === runId ? updated : state.currentRun,
      runs: state.runs.map((r) =>
        r.id === runId ? { ...r, status: updated.status } : r,
      ),
    }));
    return updated;
  },

  clearCurrentRun: () => set({ currentRun: null }),
}));
