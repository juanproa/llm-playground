import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';
import { TopBar } from '../components/layout/TopBar';
import { WorkspaceSubNav } from '../components/workspace/WorkspaceSubNav';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import { Input, TextArea, Label, FormGroup } from '../components/common/Input';
import { ChainCanvas } from '../components/chain/ChainCanvas';
import { ChainList } from '../components/chain/ChainList';
import { ChainNodeConfigModal } from '../components/chain/ChainNodeConfigModal';
import { EdgeAssertionModal } from '../components/chain/EdgeAssertionModal';
import { NodeRunInspectorModal } from '../components/chain/NodeRunInspectorModal';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useProjectStore } from '../stores/projectStore';
import { useChainStore } from '../stores/chainStore';
import type { ChainEdge, ChainListItem, ChainNode, ChainNodeRunStatus } from '../types';

const Page = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: 320px 1fr;
  overflow: hidden;
`;

const LeftPane = styled.div`
  border-right: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const PaneHeader = styled.div`
  padding: ${tokens.spacing.md};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const PaneTitle = styled.h3`
  font-family: ${tokens.fonts.accent};
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${tokens.colors.text.secondary};
  margin: 0;
`;

const RightPane = styled.div`
  display: flex;
  flex-direction: column;
  padding: ${tokens.spacing.md};
  gap: ${tokens.spacing.md};
  overflow: hidden;
  min-height: 0;
  min-width: 0;
`;

const ChainHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
`;

const ChainTitle = styled.h2`
  font-family: ${tokens.fonts.display};
  font-size: 1.2rem;
  margin: 0;
`;

const Toolbar = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const EmptyState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${tokens.colors.text.muted};
  font-size: 0.9rem;
`;

const LoadingState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: ${tokens.spacing.md};
  color: ${tokens.colors.text.muted};
  font-size: 0.85rem;
`;

const Hint = styled.div`
  font-size: 0.75rem;
  color: ${tokens.colors.text.muted};
`;

const FinalOutputPanel = styled.div`
  margin-top: ${tokens.spacing.sm};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  background: ${tokens.colors.bg.secondary};
  overflow: hidden;
`;

const FinalOutputHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  font-family: ${tokens.fonts.accent};
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${tokens.colors.text.secondary};
`;

function prettyJson(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// Deep-parse: for each leaf string value, try parsing it as JSON. The chain's
// `final_output` is `{node_name: output_text}` where each `output_text` is
// often itself a JSON string emitted by the model — rendering it nested gives
// a much more readable tree than a flat blob of escaped quotes.
function deepParse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  // Strip ```json fences if present so the inner JSON parses cleanly.
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenced ? fenced[1] : trimmed;
  if (!/^[\[{]/.test(candidate)) return value;
  try {
    return deepParseAll(JSON.parse(candidate));
  } catch {
    return value;
  }
}

function deepParseAll(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deepParseAll);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = deepParseAll(v);
    return out;
  }
  return deepParse(node);
}

function prettyFinalOutput(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(deepParseAll(parsed), null, 2);
  } catch {
    return raw;
  }
}

const FinalOutputPre = styled.pre`
  margin: 0;
  padding: 10px 14px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.78rem;
  color: ${tokens.colors.text.primary};
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
  background: ${tokens.colors.bg.tertiary};
`;

export function ModelChainPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { currentProject, fetchProject } = useProjectStore();
  const {
    chains,
    currentChain,
    fetchChains,
    fetchChain,
    createChain,
    updateChain,
    duplicateChain,
    deleteChain,
    clearCurrent,
    createNode,
    updateNode,
    createEdge,
    currentRun,
    fetchRuns,
    fetchRun,
    startRun,
    cancelRun,
    clearCurrentRun,
  } = useChainStore();

  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  // Rename modal — `renamingChain` doubles as both the open flag and the
  // payload (which chain we're editing).
  const [renamingChain, setRenamingChain] = useState<ChainListItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  // Editor state
  const [connectMode, setConnectMode] = useState(false);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<ChainNode | null>(null);
  const [editingEdge, setEditingEdge] = useState<ChainEdge | null>(null);

  // Run state
  const [inspectingNode, setInspectingNode] = useState<ChainNode | null>(null);
  // When set, the "View JSON" modal is open with this run's final_output
  // pretty-printed. Kept separate from `inspectingNode` because the user can
  // legitimately want both open at once (read a node's raw output while
  // cross-referencing the compiled JSON).
  const [showFinalOutputJson, setShowFinalOutputJson] = useState(false);
  // Minimize the inline preview (header stays so the user knows the run produced
  // a result and can re-expand or open the modal). Default expanded — most users
  // want to glance at it; minimize is for when it's eating canvas space.
  const [finalOutputCollapsed, setFinalOutputCollapsed] = useState(false);

  useEffect(() => {
    if (projectId) {
      fetchProject(projectId);
      fetchChains(projectId);
    }
    return () => clearCurrent();
  }, [projectId, fetchProject, fetchChains, clearCurrent]);

  useEffect(() => {
    if (!selectedChainId) return;
    fetchChain(selectedChainId);
    clearCurrentRun();
    // Chains keep only the latest run server-side, so just fetch the list and
    // hydrate the (at most one) run into currentRun. No drawer, no history.
    (async () => {
      await fetchRuns(selectedChainId);
      const latest = useChainStore.getState().runs[0];
      if (latest) await fetchRun(latest.id);
    })();
  }, [selectedChainId, fetchChain, fetchRuns, fetchRun, clearCurrentRun]);

  // Poll the current run while it's in a non-terminal state. Includes
  // 'cancelling' so the UI catches the transition to 'cancelled' that the
  // executor performs between nodes.
  useEffect(() => {
    if (!currentRun || !selectedChainId) return;
    const inFlight = ['pending', 'running', 'cancelling'];
    if (!inFlight.includes(currentRun.status)) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const fresh = await fetchRun(currentRun.id);
      if (!fresh || cancelled) return;
      if (inFlight.includes(fresh.status)) {
        setTimeout(tick, 1000);
      }
    };
    const handle = setTimeout(tick, 1000);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [currentRun, selectedChainId, fetchRun]);

  // Cancel connect mode on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setConnectMode(false);
        setPendingSourceId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Re-resolve `editingNode` from currentChain after store updates so the modal
  // reflects fresh data (e.g. after a save).
  useEffect(() => {
    if (!editingNode || !currentChain) return;
    const fresh = currentChain.nodes.find((n) => n.id === editingNode.id);
    if (fresh && fresh !== editingNode) setEditingNode(fresh);
  }, [currentChain, editingNode]);

  const handleSelect = (c: ChainListItem) => {
    if (c.id === selectedChainId) return;
    setSelectedChainId(c.id);
    setConnectMode(false);
    setPendingSourceId(null);
    // Drop any open modals — they belong to the previous chain.
    setEditingNode(null);
    setEditingEdge(null);
    setInspectingNode(null);
  };

  const handleDelete = async (c: ChainListItem) => {
    if (!confirm(`Delete chain "${c.name}"?`)) return;
    try {
      await deleteChain(c.id);
      if (selectedChainId === c.id) setSelectedChainId(null);
    } catch (e) {
      alert(`Failed to delete chain: ${(e as Error).message}`);
    }
  };

  const handleRenameOpen = (c: ChainListItem) => {
    setRenamingChain(c);
    setRenameValue(c.name);
  };

  const handleRenameSave = async () => {
    if (!renamingChain) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renamingChain.name) {
      setRenamingChain(null);
      return;
    }
    setRenameSaving(true);
    try {
      await updateChain(renamingChain.id, { name: trimmed });
      setRenamingChain(null);
    } catch (e) {
      alert(`Failed to rename chain: ${(e as Error).message}`);
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDuplicate = async (c: ChainListItem) => {
    try {
      const copy = await duplicateChain(c.id);
      // Surface the new copy so the user sees the result of their action.
      setSelectedChainId(copy.id);
    } catch (e) {
      alert(`Failed to duplicate chain: ${(e as Error).message}`);
    }
  };

  const handleCreate = async () => {
    if (!projectId || !newName.trim()) return;
    const chain = await createChain(projectId, {
      name: newName.trim(),
      description: newDescription.trim() || undefined,
    });
    setNewName('');
    setNewDescription('');
    setShowCreate(false);
    setSelectedChainId(chain.id);
  };

  const handleAddNode = async () => {
    if (!currentChain) return;
    // Place new node in a free-ish spot near the existing nodes.
    const xs = currentChain.nodes.map((n) => n.position_x);
    const ys = currentChain.nodes.map((n) => n.position_y);
    const baseX = xs.length ? Math.max(...xs) + 240 : 0;
    const baseY = ys.length ? Math.min(...ys) : 0;
    const node = await createNode(currentChain.id, {
      name: `Node ${currentChain.nodes.length + 1}`,
      position_x: baseX,
      position_y: baseY,
    });
    setEditingNode(node);
  };

  const handleNodePositionCommit = (nodeId: string, x: number, y: number) => {
    updateNode(nodeId, { position_x: x, position_y: y });
  };

  const handleSourcePick = (nodeId: string) => setPendingSourceId(nodeId);

  const handleTargetPick = async (targetId: string) => {
    if (!currentChain || !pendingSourceId) return;
    const exists = currentChain.edges.some(
      (e) => e.source_node_id === pendingSourceId && e.target_node_id === targetId,
    );
    if (!exists) {
      await createEdge(currentChain.id, {
        source_node_id: pendingSourceId,
        target_node_id: targetId,
      });
    }
    setPendingSourceId(null);
    setConnectMode(false);
  };

  const isRoot = (n: ChainNode | null): boolean => {
    if (!n || !currentChain) return false;
    return !currentChain.edges.some((e) => e.target_node_id === n.id);
  };

  const edgeEndpoints = (e: ChainEdge | null): { source: string; target: string } => {
    if (!e || !currentChain) return { source: '', target: '' };
    return {
      source: currentChain.nodes.find((n) => n.id === e.source_node_id)?.name || 'unknown',
      target: currentChain.nodes.find((n) => n.id === e.target_node_id)?.name || 'unknown',
    };
  };

  // Single-click on a node: show its run artifacts when a run is selected,
  // otherwise no-op (we don't want a stray click to pop the config modal —
  // double-click is the deliberate gesture for editing).
  const handleNodeInspect = (n: ChainNode) => {
    if (currentRun) {
      setInspectingNode(n);
    }
  };

  // Double-click always opens the editor — works regardless of run mode so the
  // user can tweak a node's prompt/model/input between runs without losing the
  // currently-selected run.
  const handleNodeEdit = (n: ChainNode) => {
    setEditingNode(n);
  };

  const handleStartRun = async () => {
    if (!currentChain) return;
    // Backend wipes the previous run; this just kicks off the new one and
    // sets currentRun in the store (polling effect picks up node-level state).
    await startRun(currentChain.id);
  };

  const handleStopRun = async () => {
    if (!currentRun) return;
    try {
      await cancelRun(currentRun.id);
    } catch (e) {
      alert(`Failed to cancel run: ${(e as Error).message}`);
    }
  };

  const runStateByNodeId: Record<string, ChainNodeRunStatus> | null = currentRun
    ? Object.fromEntries(currentRun.node_runs.map((nr) => [nr.node_id, nr.status]))
    : null;

  const inspectingNodeRun = inspectingNode && currentRun
    ? currentRun.node_runs.find((nr) => nr.node_id === inspectingNode.id) || null
    : null;

  if (!projectId) return null;

  return (
    <>
      <TopBar title={currentProject?.name ?? 'Model Chain'} breadcrumb="Projects" />
      <WorkspaceSubNav projectId={projectId} />
      <Page>
        <LeftPane>
          <PaneHeader>
            <PaneTitle>Chains ({chains.length})</PaneTitle>
            <Button size="sm" onClick={() => setShowCreate(true)}>+ New</Button>
          </PaneHeader>
          <ChainList
            chains={chains}
            selectedChainId={selectedChainId}
            onSelect={handleSelect}
            onRename={handleRenameOpen}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
          />
        </LeftPane>

        <RightPane>
          {selectedChainId && (!currentChain || currentChain.id !== selectedChainId) ? (
            <LoadingState>
              <LoadingSpinner />
              <span>Loading chain…</span>
            </LoadingState>
          ) : currentChain && selectedChainId ? (
            <>
              <ChainHeader>
                <div>
                  <ChainTitle>{currentChain.name}</ChainTitle>
                  {currentChain.description && (
                    <Hint style={{ marginTop: 4 }}>{currentChain.description}</Hint>
                  )}
                </div>
                <Toolbar>
                  <Hint>
                    {currentChain.nodes.length} node
                    {currentChain.nodes.length === 1 ? '' : 's'} · {currentChain.edges.length} edge
                    {currentChain.edges.length === 1 ? '' : 's'}
                  </Hint>
                  <Button size="sm" onClick={handleAddNode}>+ Node</Button>
                  <Button
                    size="sm"
                    variant={connectMode ? 'primary' : 'secondary'}
                    onClick={() => {
                      setConnectMode((v) => !v);
                      setPendingSourceId(null);
                    }}
                    disabled={currentChain.nodes.length < 2}
                  >
                    {connectMode ? 'Cancel connect' : 'Connect'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleStartRun}
                    disabled={
                      currentChain.nodes.length === 0 ||
                      currentRun?.status === 'pending' ||
                      currentRun?.status === 'running' ||
                      currentRun?.status === 'cancelling'
                    }
                  >
                    {currentRun?.status === 'running' ? 'Running…' : 'Run'}
                  </Button>
                  {(currentRun?.status === 'running' ||
                    currentRun?.status === 'pending' ||
                    currentRun?.status === 'cancelling') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleStopRun}
                      disabled={currentRun.status === 'cancelling'}
                      title="Stop after the current node finishes"
                    >
                      {currentRun.status === 'cancelling' ? 'Stopping…' : 'Stop'}
                    </Button>
                  )}
                </Toolbar>
              </ChainHeader>
              <ChainCanvas
                chain={currentChain}
                connectMode={connectMode}
                pendingSourceId={pendingSourceId}
                onSourcePick={handleSourcePick}
                onTargetPick={handleTargetPick}
                onNodeInspect={handleNodeInspect}
                onNodeEdit={handleNodeEdit}
                onEdgeClick={setEditingEdge}
                onNodePositionCommit={handleNodePositionCommit}
                runStateByNodeId={runStateByNodeId}
              />
              <Hint>
                {currentRun?.status === 'cancelling' ? (() => {
                  // Surface which node we're blocked on — provider calls can't be
                  // aborted, so the user must wait for it to finish. Showing the
                  // node name + elapsed makes "stuck" feel less stuck.
                  const runningNr = currentRun.node_runs.find((nr) => nr.status === 'running');
                  const runningNode = runningNr
                    ? currentChain?.nodes.find((n) => n.id === runningNr.node_id)
                    : null;
                  // Backend serializes datetimes as ISO without a 'Z' but the
                  // values are UTC. Tack on Z so Date doesn't reinterpret them
                  // as local time — otherwise elapsed swings by the local
                  // offset and can go negative.
                  const startedIso = runningNr?.started_at
                    ? (runningNr.started_at.endsWith('Z') ? runningNr.started_at : runningNr.started_at + 'Z')
                    : null;
                  const elapsedMs = startedIso
                    ? Date.now() - new Date(startedIso).getTime()
                    : null;
                  const elapsedLabel = elapsedMs != null
                    ? (elapsedMs >= 1000 ? `${Math.round(elapsedMs / 1000)} s` : `${elapsedMs} ms`)
                    : null;
                  return runningNode
                    ? `Stopping — waiting for "${runningNode.name}" to finish (${elapsedLabel} elapsed). In-flight inference can't be aborted; remaining nodes will be skipped.`
                    : "Stopping — waiting for the current node to finish. Remaining nodes will be skipped.";
                })()
                  : currentRun
                  ? 'Run mode — click the 👁 icon on a node to see its resolved prompt + output. Double-click a node to edit it. Drag to reposition.'
                  : 'Drag a node to reposition. Double-click a node to configure it. Click an edge to set its assertion. "Connect" mode pairs a source then a target to create an edge.'}
              </Hint>
              {currentRun?.final_output && (
                <FinalOutputPanel>
                  <FinalOutputHeader>
                    <span>Final output ({currentRun.status})</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowFinalOutputJson(true)}
                      >
                        View JSON
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigator.clipboard?.writeText(currentRun.final_output ?? '')}
                      >
                        Copy JSON
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setFinalOutputCollapsed((v) => !v)}
                        title={finalOutputCollapsed ? 'Expand' : 'Minimize'}
                      >
                        {finalOutputCollapsed ? '▾ Expand' : '▴ Minimize'}
                      </Button>
                    </div>
                  </FinalOutputHeader>
                  {!finalOutputCollapsed && (
                    <FinalOutputPre>{prettyJson(currentRun.final_output)}</FinalOutputPre>
                  )}
                </FinalOutputPanel>
              )}
            </>
          ) : (
            <EmptyState>
              {chains.length === 0
                ? 'Create a chain to start building an inference DAG.'
                : 'Select a chain on the left to view its graph.'}
            </EmptyState>
          )}
        </RightPane>
      </Page>

      <Modal
        title="Rename chain"
        open={!!renamingChain}
        onClose={() => setRenamingChain(null)}
      >
        <FormGroup>
          <Label>Name</Label>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameValue.trim()) {
                e.preventDefault();
                handleRenameSave();
              }
            }}
            autoFocus
          />
        </FormGroup>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setRenamingChain(null)}>Cancel</Button>
          <Button
            onClick={handleRenameSave}
            disabled={
              !renameValue.trim() ||
              renameValue.trim() === renamingChain?.name ||
              renameSaving
            }
          >
            {renameSaving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Modal>

      <Modal title="New Model Chain" open={showCreate} onClose={() => setShowCreate(false)}>
        <FormGroup>
          <Label>Name</Label>
          <Input
            placeholder="e.g. Classification router"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
        </FormGroup>
        <FormGroup>
          <Label>Description (optional)</Label>
          <TextArea
            placeholder="What does this chain do?"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            rows={3}
          />
        </FormGroup>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!newName.trim()}>Create</Button>
        </div>
      </Modal>

      <ChainNodeConfigModal
        open={!!editingNode}
        onClose={() => setEditingNode(null)}
        projectId={projectId}
        node={editingNode}
        isRoot={isRoot(editingNode)}
      />

      <EdgeAssertionModal
        open={!!editingEdge}
        onClose={() => setEditingEdge(null)}
        edge={editingEdge}
        sourceName={edgeEndpoints(editingEdge).source}
        targetName={edgeEndpoints(editingEdge).target}
      />

      <NodeRunInspectorModal
        open={!!inspectingNode}
        onClose={() => setInspectingNode(null)}
        node={inspectingNode}
        nodeRun={inspectingNodeRun}
      />

      <Modal
        title="Final output (JSON)"
        size="lg"
        open={showFinalOutputJson}
        onClose={() => setShowFinalOutputJson(false)}
      >
        <Hint style={{ marginBottom: tokens.spacing.sm }}>
          Each node's output is parsed if it looks like JSON (so model JSON nests cleanly under its node name).
        </Hint>
        <FinalOutputPre style={{ maxHeight: '60vh' }}>
          {prettyFinalOutput(currentRun?.final_output)}
        </FinalOutputPre>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: tokens.spacing.lg }}>
          <Button
            variant="ghost"
            onClick={() => navigator.clipboard?.writeText(prettyFinalOutput(currentRun?.final_output))}
          >
            Copy formatted
          </Button>
          <Button onClick={() => setShowFinalOutputJson(false)}>Close</Button>
        </div>
      </Modal>
    </>
  );
}
