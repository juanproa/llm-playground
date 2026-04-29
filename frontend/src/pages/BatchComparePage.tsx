/**
 * Batch Compare: run the same prompt across N models (and/or chains) over M
 * input rows and display the results in a matrix:
 *   rows    = ComparisonInputItem (input_text)
 *   columns = ComparisonChild (kind='model' or 'chain')
 *   cell    = ComparisonResult
 *
 * Lives on its own tables (pt_comparison_runs / _children / _results /
 * _input_items) — does not touch BacktestRun / TestCase.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';
import { TopBar } from '../components/layout/TopBar';
import { WorkspaceSubNav } from '../components/workspace/WorkspaceSubNav';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { postTrainingApi } from '../api/postTraining';
import { inputDatasetsApi } from '../api/inputDatasets';
import { chainsApi } from '../api/chains';
import { useProjectStore } from '../stores/projectStore';
import { usePromptStore } from '../stores/promptStore';
import { useModelStore } from '../stores/modelStore';
import type {
  ChainListItem,
  ComparisonChild,
  ComparisonInputItem,
  ComparisonResult,
  ComparisonRun,
  ComparisonRunWithChildren,
  Dataset,
  InputDataset,
  InputDatasetItem,
} from '../types';

/* ─── Layout ─────────────────────────────────────────────────────────────── */

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

const RightPane = styled.div`
  overflow: auto;
  padding: ${tokens.spacing.md};
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
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: ${tokens.colors.text.secondary};
  margin: 0;
`;

const PaneBody = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${tokens.spacing.md};
`;

const Card = styled.div<{ $active?: boolean }>`
  padding: 10px 12px;
  background: ${({ $active }) => $active ? 'rgba(108,92,231,0.12)' : tokens.colors.bg.tertiary};
  border: 1px solid ${({ $active }) => $active ? tokens.colors.accent.primary : tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  margin-bottom: 8px;
  cursor: pointer;
  &:hover { border-color: ${tokens.colors.accent.primary}; }
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
`;

const Muted = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 0.72rem;
  color: ${tokens.colors.text.muted};
  margin-top: 4px;
`;

const Empty = styled.div`
  color: ${tokens.colors.text.muted};
  font-size: 0.85rem;
  text-align: center;
  padding: ${tokens.spacing.lg};
`;

/* ─── Modal ──────────────────────────────────────────────────────────────── */

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
`;

const Modal = styled.div`
  background: ${tokens.colors.bg.secondary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  width: 520px;
  max-height: 90vh;
  overflow-y: auto;
`;

const ModalHead = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const ModalBody = styled.div`
  padding: ${tokens.spacing.md};
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.label`
  font-family: ${tokens.fonts.accent};
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${tokens.colors.text.muted};
`;

const Input = styled.input`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  color: ${tokens.colors.text.primary};
  padding: 8px 10px;
  font-size: 0.85rem;
  outline: none;
`;

const Select = styled.select`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  color: ${tokens.colors.text.primary};
  padding: 8px 10px;
  font-size: 0.85rem;
  outline: none;
`;

const CheckList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  background: ${tokens.colors.bg.primary};
`;

const CheckRow = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
  color: ${tokens.colors.text.primary};
  padding: 4px;
  cursor: pointer;
  &:hover { background: ${tokens.colors.bg.tertiary}; }
`;

/* ─── Add-to-Dataset dialog ──────────────────────────────────────────────── */

const DialogOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
`;

const Dialog = styled.div`
  background: ${tokens.colors.bg.secondary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  width: 540px;
  max-height: 90vh;
  overflow-y: auto;
`;

const PreviewBox = styled.pre`
  background: ${tokens.colors.bg.primary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  padding: 8px 10px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.72rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 100px;
  overflow-y: auto;
  color: ${tokens.colors.text.primary};
  margin: 0;
`;

/* ─── Matrix ─────────────────────────────────────────────────────────────── */

const Matrix = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
`;

const Th = styled.th`
  text-align: left;
  padding: 10px 12px;
  background: ${tokens.colors.bg.secondary};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  color: ${tokens.colors.text.primary};
  font-family: ${tokens.fonts.mono};
  font-size: 0.8rem;
  font-weight: 600;
  vertical-align: top;
  position: sticky;
  top: 0;
  z-index: 1;
`;

const Td = styled.td<{ $fail?: boolean }>`
  padding: 10px 12px;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  vertical-align: top;
  background: ${({ $fail }) => $fail ? 'rgba(255, 82, 82, 0.04)' : 'transparent'};
`;

const FilterBar = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  padding: 10px;
  background: ${tokens.colors.bg.secondary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  font-size: 0.8rem;
`;

/* ─── Helpers ────────────────────────────────────────────────────────────── */

// Reasoning models (Qwen3, DeepSeek-R1, etc.) emit <think>…</think> blocks
// containing private chain-of-thought before the real answer. The user-facing
// answer is everything outside those tags; the inside is debugging noise.
// Strip well-formed pairs only — leave malformed/truncated content visible so
// "stream got cut mid-think" stays a noticeable signal in the UI.
function stripThinkTags(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// Deep-parse: for each leaf string value, try parsing it as JSON. Mirrors the
// helper on ModelChainPage — chain comparison cells store the chain's
// `final_output` ({node_name: text}) verbatim, where each value is itself a
// JSON string. Rendering it nested is much more readable than a blob of
// escaped quotes. Strips ```json fences before parsing.
function deepParseChain(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenced ? fenced[1] : trimmed;
  if (!/^[\[{]/.test(candidate)) return value;
  try {
    return deepParseAllChain(JSON.parse(candidate));
  } catch {
    return value;
  }
}

function deepParseAllChain(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deepParseAllChain);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = deepParseAllChain(v);
    return out;
  }
  return deepParseChain(node);
}

function prettyChainOutput(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    return JSON.stringify(deepParseAllChain(JSON.parse(raw)), null, 2);
  } catch {
    return raw;
  }
}

function inputPreview(text: string, max = 80): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '(empty)';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export function BatchComparePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { currentProject, fetchProject } = useProjectStore();
  const { prompts, fetchPrompts } = usePromptStore();
  const { models, fetchModels } = useModelStore();

  const [runs, setRuns] = useState<ComparisonRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ComparisonRunWithChildren | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [expandedCellKey, setExpandedCellKey] = useState<string | null>(null);
  const [showOnlyFailures, setShowOnlyFailures] = useState(false);

  // Add-to-dataset state
  const [addTarget, setAddTarget] = useState<AddToDatasetTarget | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [newDatasetName, setNewDatasetName] = useState<string>('');
  const [savingToDataset, setSavingToDataset] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Chains available as columns. A chain runs as a single canonical column —
  // the chain's full `final_output` JSON ({node_name: text}) is the cell value.
  // Chains carry their own prompts and per-node models, so prompt overrides /
  // judge models do not apply.
  const [chains, setChains] = useState<ChainListItem[]>([]);
  const [selectedChainIds, setSelectedChainIds] = useState<Set<string>>(new Set());

  // New-comparison form
  const [name, setName] = useState('');
  const [promptVersionId, setPromptVersionId] = useState('');
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  // Optional per-model prompt override: key = model_config_id, value = prompt_version_id.
  // Models not present here inherit the form's `promptVersionId`. Useful for comparing
  // a small (3B) model's tuned prompt against a frontier model's tighter prompt.
  const [promptOverrides, setPromptOverrides] = useState<Record<string, string>>({});
  const [judgeModelId, setJudgeModelId] = useState('');

  // Input Dataset picker state — Batch Compare pulls inputs from a global
  // InputDataset (sidebar "Datasets" / `input_datasets`). NOT the post-training
  // SFT `pt_datasets`. See CLAUDE.md "Data entities".
  const [inputDatasets, setInputDatasets] = useState<InputDataset[]>([]);
  const [inputDatasetId, setInputDatasetId] = useState<string>('');
  const [datasetItems, setDatasetItems] = useState<InputDatasetItem[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [loadingDatasetItems, setLoadingDatasetItems] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    fetchProject(projectId);
    fetchPrompts(projectId);
    fetchModels();
    inputDatasetsApi.list().then(setInputDatasets).catch(() => setInputDatasets([]));
    chainsApi.list(projectId).then(setChains).catch(() => setChains([]));
    void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Fetch items when the selected dataset changes; default-select all so the
  // common case ("use the whole dataset") still requires zero clicks.
  useEffect(() => {
    if (!inputDatasetId) {
      setDatasetItems([]);
      setSelectedItemIds(new Set());
      return;
    }
    setLoadingDatasetItems(true);
    inputDatasetsApi.listItems(inputDatasetId)
      .then((items) => {
        setDatasetItems(items);
        setSelectedItemIds(new Set(items.map((it) => it.id)));
      })
      .catch(() => {
        setDatasetItems([]);
        setSelectedItemIds(new Set());
      })
      .finally(() => setLoadingDatasetItems(false));
  }, [inputDatasetId]);

  const loadRuns = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await postTrainingApi.listComparisonRuns(projectId);
      setRuns(data);
    } catch {}
  }, [projectId]);

  // Poll selected run if it's running
  useEffect(() => {
    if (!selectedId || !projectId) {
      setDetail(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fetchDetail = async () => {
      try {
        const d = await postTrainingApi.getComparisonRun(projectId, selectedId);
        setDetail(d);
        if (d.status === 'running' || d.status === 'pending' || d.status === 'cancelling') {
          timer = setTimeout(fetchDetail, 3000);
        } else {
          // Also refresh the run list to update statuses
          loadRuns();
        }
      } catch {}
    };
    fetchDetail();
    return () => { if (timer) clearTimeout(timer); };
  }, [selectedId, projectId, loadRuns]);

  const enabledModels = useMemo(
    () => models.filter((m) => m.is_enabled),
    [models],
  );

  const promptVersions = useMemo(
    () => prompts.flatMap((p) => p.versions.map((v) => ({
      ...v,
      promptName: p.name,
    }))),
    [prompts],
  );

  async function handleCreate() {
    if (!projectId || !name.trim()) return;
    if (selectedModelIds.size < 1 && selectedChainIds.size < 1) {
      alert('Pick at least one model or chain to compare.');
      return;
    }
    if (!inputDatasetId) {
      alert('Pick a dataset to use as input for the comparison.');
      return;
    }
    if (selectedItemIds.size === 0) {
      alert('Pick at least one item from the dataset.');
      return;
    }
    // Drop overrides for models that are no longer selected (the user may have
    // toggled them off after picking an override).
    const cleanOverrides: Record<string, string> = {};
    for (const [mid, pv] of Object.entries(promptOverrides)) {
      if (selectedModelIds.has(mid) && pv && pv !== promptVersionId) cleanOverrides[mid] = pv;
    }
    // Main prompt is optional iff every selected model has an override.
    // Chains carry their own prompts, so they don't factor into this check.
    const everyModelHasOverride = selectedModelIds.size > 0
      && Array.from(selectedModelIds).every((mid) => !!cleanOverrides[mid]);
    if (selectedModelIds.size > 0 && !promptVersionId && !everyModelHasOverride) {
      alert('Pick a default prompt, or set an override for each selected model.');
      return;
    }
    try {
      // If user only picked some items, send the subset; otherwise omit so the
      // backend just ingests the whole dataset.
      const itemIds = selectedItemIds.size === datasetItems.length
        ? undefined
        : Array.from(selectedItemIds);
      const created = await postTrainingApi.createComparisonRun(projectId, {
        name: name.trim(),
        prompt_version_id: promptVersionId || undefined,
        model_config_ids: Array.from(selectedModelIds),
        chain_ids: selectedChainIds.size > 0 ? Array.from(selectedChainIds) : undefined,
        prompt_version_overrides: Object.keys(cleanOverrides).length ? cleanOverrides : undefined,
        input_dataset_id: inputDatasetId,
        input_dataset_item_ids: itemIds,
        judge_model_config_id: judgeModelId || undefined,
      });
      setRuns((prev) => [created, ...prev]);
      setSelectedId(created.id);
      setShowModal(false);
      setName('');
      setSelectedModelIds(new Set());
      setSelectedChainIds(new Set());
      setPromptOverrides({});
      setInputDatasetId('');
      setDatasetItems([]);
      setSelectedItemIds(new Set());
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!projectId) return;
    if (!confirm('Delete this comparison run and all its child results?')) return;
    try {
      await postTrainingApi.deleteComparisonRun(projectId, id);
      if (selectedId === id) setSelectedId(null);
      await loadRuns();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleStop() {
    if (!projectId || !selectedId) return;
    try {
      const updated = await postTrainingApi.cancelComparisonRun(projectId, selectedId);
      setDetail((prev) => (prev ? { ...prev, status: updated.status } : prev));
      setRuns((prev) => prev.map((r) => (r.id === updated.id ? { ...r, status: updated.status } : r)));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function openAddToDataset(target: AddToDatasetTarget) {
    setAddTarget(target);
    setSaveSuccess(false);
    setSelectedDatasetId('');
    setNewDatasetName('');
    if (!projectId) return;
    try {
      const list = await postTrainingApi.listDatasets(projectId);
      setDatasets(list);
    } catch {
      setDatasets([]);
    }
  }

  async function handleSaveToDataset() {
    if (!projectId || !addTarget) return;
    setSavingToDataset(true);
    try {
      let datasetId = selectedDatasetId;
      if (!datasetId) {
        const created = await postTrainingApi.createDataset(projectId, {
          name: newDatasetName.trim() || `From Batch Compare — ${new Date().toLocaleDateString()}`,
        });
        datasetId = created.id;
        setDatasets((prev) => [created, ...prev]);
        setSelectedDatasetId(created.id);
      }
      await postTrainingApi.addDatasetItems(projectId, datasetId, [{
        input_text: addTarget.inputItem.input_text,
        // Strip <think>…</think> reasoning before persisting — we don't want to
        // train on a model's private chain-of-thought.
        output_text: stripThinkTags(addTarget.cell.result.actual_output),
        instruction: inputPreview(addTarget.inputItem.input_text, 60),
        tags: `batch_compare,model:${addTarget.modelName}`,
      }]);
      setSaveSuccess(true);
    } catch (e) {
      alert((e as Error).message);
    }
    setSavingToDataset(false);
  }

  // Build the matrix data from detail
  const matrix = useMemo(() => buildMatrix(detail), [detail]);

  // Lookup helper: a column-level label for the prompt actually used by this child run.
  // Lets the header surface "custom prompt" badges for models running an override.
  const promptVersionLabel = useCallback((vid: string | null | undefined): string | null => {
    if (!vid) return null;
    for (const p of prompts) {
      const v = p.versions.find((vv) => vv.id === vid);
      if (v) return `${p.name} v${v.version_number}${v.label ? ` (${v.label})` : ''}`;
    }
    return vid.slice(0, 8);
  }, [prompts]);

  // Apply filters to rows
  const filteredRows = useMemo(() => {
    if (!showOnlyFailures) return matrix.rows;
    return matrix.rows.filter((row) =>
      row.cells.some((c) => c && c.result.status === 'failed'),
    );
  }, [matrix, showOnlyFailures]);

  // Column-level aggregates
  const colAggregates = useMemo(() => {
    return matrix.cols.map((col, colIdx) => {
      const cells = matrix.rows.map((r) => r.cells[colIdx]).filter(Boolean) as CellData[];
      // "done" = any non-pending result. A child finishes by transitioning every
      // result row out of pending (completed/failed/cancelled).
      const done = cells.filter((c) => c.result.status !== 'pending').length;
      const failed = cells.filter((c) => c.result.status === 'failed').length;
      const latencies = cells.filter((c) => c.result.latency_ms != null).map((c) => c.result.latency_ms!);
      const meanLatency = latencies.length === 0 ? null : latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const child = col.child;
      const childStatus = child.status;
      const isInFlight = childStatus === 'pending' || childStatus === 'running';
      return {
        col,
        done,
        failed,
        total: cells.length,
        meanLatency,
        isInFlight,
        childStatus,
      };
    });
  }, [matrix]);

  // Cross-run progress for the in-flight selected run
  const runProgress = useMemo(() => {
    if (!detail) return null;
    if (!(detail.status === 'pending' || detail.status === 'running')) return null;
    const totalDone = detail.children.reduce(
      (acc, c) => acc + c.results.filter((r) => r.status !== 'pending').length,
      0,
    );
    const totalTotal = detail.children.reduce((acc, c) => acc + c.results.length, 0);
    return totalTotal > 0 ? `${totalDone}/${totalTotal} cells` : null;
  }, [detail]);

  if (!projectId) return null;

  return (
    <>
      <TopBar title={currentProject?.name ?? 'Batch Compare'} breadcrumb="Projects" />
      <WorkspaceSubNav projectId={projectId} />
      <Page>
        {/* Left: list of comparison runs */}
        <LeftPane>
          <PaneHeader>
            <PaneTitle>Comparison Runs ({runs.length})</PaneTitle>
            <Button size="sm" onClick={() => setShowModal(true)}>+ New</Button>
          </PaneHeader>
          <PaneBody>
            {runs.length === 0 && <Empty>No comparison runs yet.</Empty>}
            {runs.map((r) => {
              const isSelected = selectedId === r.id;
              return (
                <Card
                  key={r.id}
                  $active={isSelected}
                  onClick={() => setSelectedId(r.id)}
                >
                  <Row>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 500 }}>{r.name}</div>
                      <Muted>
                        <Badge color={
                          r.status === 'completed' ? 'success'
                          : r.status === 'failed' ? 'error'
                          : r.status === 'running' ? 'primary'
                          : 'secondary'
                        }>{r.status}</Badge>
                        {isSelected && runProgress && (
                          <> · <span style={{ color: tokens.colors.text.primary }}>{runProgress}</span></>
                        )}
                      </Muted>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                      style={{ color: tokens.colors.accent.error, fontSize: '0.75rem' }}
                    >
                      ✕
                    </Button>
                  </Row>
                </Card>
              );
            })}
          </PaneBody>
        </LeftPane>

        {/* Right: matrix view */}
        <RightPane>
          {!selectedId && <Empty>Select a run on the left, or create a new one.</Empty>}
          {selectedId && !detail && <Empty>Loading…</Empty>}
          {selectedId && detail && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginBottom: tokens.spacing.md,
              }}
            >
              <strong style={{ color: tokens.colors.text.primary }}>{detail.name}</strong>
              <span
                style={{
                  fontFamily: tokens.fonts.mono,
                  fontSize: '0.72rem',
                  textTransform: 'uppercase',
                  color: tokens.colors.text.muted,
                }}
              >
                {detail.status}
              </span>
              {(detail.status === 'running' || detail.status === 'pending') && (
                <Button size="sm" variant="danger" onClick={handleStop} style={{ marginLeft: 'auto' }}>
                  Stop
                </Button>
              )}
              {detail.status === 'cancelling' && (
                <Button size="sm" variant="ghost" disabled style={{ marginLeft: 'auto' }}>
                  Stopping…
                </Button>
              )}
            </div>
          )}
          {selectedId && detail && matrix.rows.length === 0 && <Empty>No inputs or no results yet.</Empty>}
          {selectedId && detail && matrix.rows.length > 0 && (
            <>
              <FilterBar>
                <label>
                  <input
                    type="checkbox"
                    checked={showOnlyFailures}
                    onChange={(e) => setShowOnlyFailures(e.target.checked)}
                  /> Only rows with failures
                </label>
                <div style={{ marginLeft: 'auto', color: tokens.colors.text.muted }}>
                  {filteredRows.length} / {matrix.rows.length} rows
                </div>
              </FilterBar>

              <Matrix>
                <thead>
                  <tr>
                    <Th style={{ minWidth: 200 }}>Input</Th>
                    {matrix.cols.map((col, colIdx) => {
                      const agg = colAggregates[colIdx];
                      if (col.kind === 'chain') {
                        // Chain columns own their internal prompts/models, so we
                        // intentionally show only the chain name — no provider, no
                        // prompt badge.
                        const ch = chains.find((c) => c.id === col.id);
                        return (
                          <Th key={`chain:${col.id}`} style={{ minWidth: 220 }}>
                            <div>{ch?.name ?? col.id.slice(0, 8)}</div>
                            <Muted>chain</Muted>
                            {agg && agg.total > 0 && (
                              <div style={{ marginTop: 6 }}>
                                {agg.isInFlight ? (
                                  <Badge color="primary">
                                    {agg.childStatus === 'running' ? '⟳ ' : ''}
                                    {agg.done}/{agg.total} cells
                                  </Badge>
                                ) : (
                                  <Badge color={agg.failed > 0 ? 'error' : 'secondary'}>
                                    {agg.total - agg.failed}/{agg.total} ok
                                    {agg.failed > 0 ? ` · ${agg.failed} failed` : ''}
                                  </Badge>
                                )}
                                {!agg.isInFlight && agg.meanLatency !== null && (
                                  <Muted>mean: {Math.round(agg.meanLatency)} ms</Muted>
                                )}
                              </div>
                            )}
                          </Th>
                        );
                      }
                      const mid = col.id;
                      const m = models.find((x) => x.id === mid);
                      // Source of truth for "this column ran an override prompt" is
                      // the per-child prompt_version_id vs the parent's. A child
                      // pinned to a different version than the parent ran an override.
                      const usedPromptId = col.child.prompt_version_id;
                      const hasOverride = !!usedPromptId
                        && !!detail.prompt_version_id
                        && usedPromptId !== detail.prompt_version_id;
                      return (
                        <Th key={`model:${mid}`} style={{ minWidth: 220 }}>
                          <div>{m?.name ?? mid.slice(0, 8)}</div>
                          <Muted>{m?.provider}</Muted>
                          {usedPromptId && (
                            <div style={{ marginTop: 4 }} title={`Prompt: ${promptVersionLabel(usedPromptId) ?? ''}`}>
                              {hasOverride && (
                                <>
                                  <Badge color="primary">custom prompt</Badge>{' '}
                                </>
                              )}
                              <Muted style={{ display: 'inline' }}>
                                {promptVersionLabel(usedPromptId)}
                              </Muted>
                            </div>
                          )}
                          {agg && agg.total > 0 && (
                            <div style={{ marginTop: 6 }}>
                              {agg.isInFlight ? (
                                <>
                                  <Badge color="primary">
                                    {agg.childStatus === 'running' ? '⟳ ' : ''}
                                    {agg.done}/{agg.total} cells
                                  </Badge>
                                  {agg.meanLatency !== null && agg.done < agg.total && (() => {
                                    const remaining = agg.total - agg.done;
                                    const etaSec = Math.round((agg.meanLatency * remaining) / 1000);
                                    return <Muted>ETA ~{etaSec >= 60 ? `${Math.round(etaSec / 60)} min` : `${etaSec} s`}</Muted>;
                                  })()}
                                  {agg.meanLatency !== null && (
                                    <Muted>{Math.round(agg.meanLatency)} ms / cell avg</Muted>
                                  )}
                                </>
                              ) : (
                                <Badge color={agg.failed > 0 ? 'error' : 'secondary'}>
                                  {agg.total - agg.failed}/{agg.total} ok
                                  {agg.failed > 0 ? ` · ${agg.failed} failed` : ''}
                                </Badge>
                              )}
                              {!agg.isInFlight && agg.meanLatency !== null && (
                                <Muted>mean: {Math.round(agg.meanLatency)} ms</Muted>
                              )}
                            </div>
                          )}
                        </Th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, rowIdx) => (
                    <tr key={row.inputItem.id}>
                      <Td>
                        <div style={{ fontWeight: 500 }}>
                          {row.inputItem.name || `#${rowIdx + 1}`}
                        </div>
                        {row.inputItem.name && (
                          <Muted style={{ marginTop: 2 }}>#{rowIdx + 1}</Muted>
                        )}
                        <Muted style={{
                          color: tokens.colors.text.primary,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: tokens.fonts.mono,
                          marginTop: 4,
                        }}>
                          {inputPreview(row.inputItem.input_text, 160)}
                        </Muted>
                      </Td>
                      {row.cells.map((cell, colIdx) => {
                        const col = matrix.cols[colIdx];
                        const colKey = `${col.kind}:${col.id}`;
                        const cellKey = `${row.inputItem.id}:${colKey}`;
                        const isExpanded = expandedCellKey === cellKey;
                        if (!cell) {
                          return <Td key={colKey}><Muted>—</Muted></Td>;
                        }

                        const status = cell.result.status;
                        const isFailed = status === 'failed';
                        const isPending = status === 'pending';
                        const isCancelled = status === 'cancelled';

                        const modelName = col.kind === 'chain'
                          ? (chains.find((c) => c.id === col.id)?.name ?? col.id.slice(0, 8))
                          : (models.find((x) => x.id === col.id)?.name ?? col.id.slice(0, 8));

                        const cleanedOutput = col.kind === 'chain'
                          ? prettyChainOutput(cell.result.actual_output)
                          : stripThinkTags(cell.result.actual_output);

                        return (
                          <Td
                            key={colKey}
                            $fail={isFailed}
                            onClick={() => setExpandedCellKey(isExpanded ? null : cellKey)}
                            style={{ cursor: 'pointer' }}
                          >
                            <Row>
                              {isPending ? (
                                <Badge color="secondary">pending</Badge>
                              ) : isFailed ? (
                                <Badge color="error">failed</Badge>
                              ) : isCancelled ? (
                                <Badge color="secondary">cancelled</Badge>
                              ) : (
                                <Badge color="success">ok</Badge>
                              )}
                              <div style={{ display: 'flex', gap: 4, fontSize: '0.7rem', color: tokens.colors.text.muted, alignItems: 'center' }}>
                                {cell.result.cache_hit && <span title="From cache">⚡</span>}
                                {cell.result.latency_ms != null && <span>{cell.result.latency_ms}ms</span>}
                                {cell.result.actual_output && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    title="Add this output to a Fine-Tuning dataset"
                                    style={{ padding: '1px 6px', fontSize: '0.65rem', opacity: 0.7 }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openAddToDataset({ inputItem: row.inputItem, cell, modelName });
                                    }}
                                  >
                                    + Dataset
                                  </Button>
                                )}
                              </div>
                            </Row>
                            {cleanedOutput && (
                              <Muted style={{
                                marginTop: 4,
                                fontFamily: tokens.fonts.mono,
                                color: tokens.colors.text.primary,
                                maxHeight: 60,
                                overflow: 'hidden',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}>
                                {cleanedOutput.slice(0, 180)}
                                {cleanedOutput.length > 180 && '…'}
                              </Muted>
                            )}

                            {isExpanded && (
                              <div style={{ marginTop: 8 }}>
                                <pre style={{
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  background: tokens.colors.bg.primary,
                                  padding: 8,
                                  borderRadius: 4,
                                  maxHeight: 300,
                                  overflow: 'auto',
                                  fontSize: '0.7rem',
                                  margin: 0,
                                }}>
                                  {cleanedOutput || '(no output)'}
                                </pre>
                                {cell.result.error_message && (
                                  <Muted style={{ color: tokens.colors.accent.error, marginTop: 4 }}>
                                    {cell.result.error_message}
                                  </Muted>
                                )}
                              </div>
                            )}
                          </Td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </Matrix>
            </>
          )}
        </RightPane>
      </Page>

      {/* ── Add to Fine-Tuning Dataset dialog ── */}
      {addTarget && (
        <DialogOverlay onClick={() => setAddTarget(null)}>
          <Dialog onClick={(e) => e.stopPropagation()}>
            <ModalHead>
              <PaneTitle>Add to Fine-Tuning Dataset</PaneTitle>
              <Button size="sm" variant="ghost" onClick={() => setAddTarget(null)}>Close</Button>
            </ModalHead>
            <ModalBody>
              {saveSuccess ? (
                <div style={{ textAlign: 'center', padding: '16px 0', color: tokens.colors.accent.success }}>
                  Saved successfully!{' '}
                  <Button size="sm" variant="ghost" onClick={() => setAddTarget(null)}>Close</Button>
                </div>
              ) : (
                <>
                  <FormGroup>
                    <Label>Input</Label>
                    <PreviewBox>{addTarget.inputItem.input_text}</PreviewBox>
                  </FormGroup>
                  <FormGroup>
                    <Label>Output ({addTarget.modelName})</Label>
                    <PreviewBox>{stripThinkTags(addTarget.cell.result.actual_output) || '(no output)'}</PreviewBox>
                  </FormGroup>

                  <FormGroup>
                    <Label>Target Dataset</Label>
                    <Select
                      value={selectedDatasetId}
                      onChange={(e) => { setSelectedDatasetId(e.target.value); setNewDatasetName(''); }}
                    >
                      <option value="">— Create new dataset —</option>
                      {datasets.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.item_count} items)
                        </option>
                      ))}
                    </Select>
                  </FormGroup>

                  {!selectedDatasetId && (
                    <FormGroup>
                      <Label>New Dataset Name</Label>
                      <Input
                        value={newDatasetName}
                        onChange={(e) => setNewDatasetName(e.target.value)}
                        placeholder={`From Batch Compare — ${new Date().toLocaleDateString()}`}
                      />
                    </FormGroup>
                  )}

                  <Button
                    disabled={savingToDataset}
                    onClick={handleSaveToDataset}
                  >
                    {savingToDataset ? 'Saving…' : 'Save to Dataset'}
                  </Button>
                </>
              )}
            </ModalBody>
          </Dialog>
        </DialogOverlay>
      )}

      {showModal && (
        <ModalOverlay onClick={() => setShowModal(false)}>
          <Modal onClick={(e) => e.stopPropagation()}>
            <ModalHead>
              <PaneTitle>New Batch Comparison</PaneTitle>
              <Button size="sm" variant="ghost" onClick={() => setShowModal(false)}>Close</Button>
            </ModalHead>
            <ModalBody>
              <FormGroup>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude vs Qwen3 vs MedGemma" />
              </FormGroup>

              <FormGroup>
                <Label>Default Prompt Version (optional if every model has an override)</Label>
                <Select value={promptVersionId} onChange={(e) => setPromptVersionId(e.target.value)}>
                  <option value="">— none (each model must have its own override) —</option>
                  {promptVersions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.promptName} v{v.version_number}{v.label ? ` (${v.label})` : ''}
                    </option>
                  ))}
                </Select>
              </FormGroup>

              <FormGroup>
                <Label>Models to run (optional if you pick at least one chain below)</Label>
                <Muted style={{ marginBottom: 6 }}>
                  Each selected model uses the prompt version above by default. Click
                  <em> override</em> to give a model its own prompt — handy when a 3B model
                  needs a longer, more explicit prompt than a frontier model.
                </Muted>
                <CheckList>
                  {enabledModels.map((m) => {
                    const checked = selectedModelIds.has(m.id);
                    const overrideVid = promptOverrides[m.id] ?? '';
                    return (
                      <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <CheckRow>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setSelectedModelIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(m.id); else next.delete(m.id);
                                return next;
                              });
                              if (!e.target.checked) {
                                setPromptOverrides((prev) => {
                                  if (!(m.id in prev)) return prev;
                                  const next = { ...prev };
                                  delete next[m.id];
                                  return next;
                                });
                              }
                            }}
                          />
                          <span style={{ flex: 1 }}>
                            {m.name} <Muted>{m.provider}</Muted>
                          </span>
                          {overrideVid && <Badge color="primary">custom prompt</Badge>}
                        </CheckRow>
                        {checked && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 24 }}>
                            <Muted style={{ marginTop: 0 }}>prompt:</Muted>
                            <Select
                              value={overrideVid}
                              onChange={(e) => {
                                const v = e.target.value;
                                setPromptOverrides((prev) => {
                                  const next = { ...prev };
                                  if (!v) delete next[m.id];
                                  else next[m.id] = v;
                                  return next;
                                });
                              }}
                              style={{ flex: 1, padding: '4px 8px', fontSize: '0.75rem' }}
                            >
                              <option value="">— inherit from above —</option>
                              {promptVersions.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.promptName} v{v.version_number}{v.label ? ` (${v.label})` : ''}
                                </option>
                              ))}
                            </Select>
                            {overrideVid && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setPromptOverrides((prev) => {
                                  const next = { ...prev };
                                  delete next[m.id];
                                  return next;
                                })}
                                style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                              >
                                reset
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CheckList>
              </FormGroup>

              {chains.length > 0 && (
                <FormGroup>
                  <Label>Chains as columns (optional)</Label>
                  <Muted style={{ marginBottom: 6 }}>
                    Each selected chain runs end-to-end per input row; the chain's
                    full <code>{'{node_name: text}'}</code> output becomes the column value.
                    Chains carry their own prompts and per-node models, so the prompt picker
                    above doesn't apply.
                  </Muted>
                  <CheckList>
                    {chains.map((c) => {
                      const checked = selectedChainIds.has(c.id);
                      return (
                        <CheckRow key={c.id}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setSelectedChainIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(c.id); else next.delete(c.id);
                                return next;
                              });
                            }}
                          />
                          <span style={{ flex: 1 }}>
                            {c.name} <Muted>{c.node_count} nodes</Muted>
                          </span>
                        </CheckRow>
                      );
                    })}
                  </CheckList>
                </FormGroup>
              )}

              <FormGroup>
                <Label>Input Dataset</Label>
                <Select value={inputDatasetId} onChange={(e) => setInputDatasetId(e.target.value)}>
                  <option value="">— pick an input dataset —</option>
                  {inputDatasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.item_count} items)
                    </option>
                  ))}
                </Select>
                <Muted style={{ marginTop: 4 }}>
                  Pulls from the global "Datasets" sidebar (input libraries) — not the
                  Fine-Tuning datasets in Post-Training. Every item's <code>content</code> is
                  sent to each model as one input row. RAG retrieval, if any, comes from
                  the prompt version's KB binding — not from here.
                </Muted>
              </FormGroup>

              {inputDatasetId && (
                <FormGroup>
                  <Label>Items to include ({selectedItemIds.size}/{datasetItems.length})</Label>
                  {loadingDatasetItems ? (
                    <Muted>Loading items…</Muted>
                  ) : datasetItems.length === 0 ? (
                    <Muted>This dataset has no items yet.</Muted>
                  ) : (
                    <>
                      <Row style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedItemIds(new Set(datasetItems.map((it) => it.id)))}
                        >
                          Select all
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedItemIds(new Set())}
                        >
                          Clear
                        </Button>
                      </Row>
                      <CheckList>
                        {datasetItems.map((it, i) => {
                          const preview = it.name || it.content || '(empty)';
                          const checked = selectedItemIds.has(it.id);
                          return (
                            <CheckRow key={it.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  setSelectedItemIds((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(it.id); else next.delete(it.id);
                                    return next;
                                  });
                                }}
                              />
                              <span style={{
                                flex: 1,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}>
                                <Muted style={{ display: 'inline', marginRight: 6 }}>#{i + 1}</Muted>
                                {preview}
                              </span>
                              <Badge color={
                                it.source_type === 'pdf' ? 'primary'
                                : it.source_type === 'csv_row' ? 'warning'
                                : 'secondary'
                              }>
                                {it.source_type}
                              </Badge>
                              <Muted>{(it.content?.length ?? 0).toLocaleString()} ch</Muted>
                            </CheckRow>
                          );
                        })}
                      </CheckList>
                    </>
                  )}
                </FormGroup>
              )}

              <FormGroup>
                <Label>LLM Judge Model (reserved — no scoring runs without expected outputs)</Label>
                <Select value={judgeModelId} onChange={(e) => setJudgeModelId(e.target.value)}>
                  <option value="">— none —</option>
                  {enabledModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
                  ))}
                </Select>
              </FormGroup>

              <Button
                disabled={
                  !name.trim()
                  || (selectedModelIds.size < 1 && selectedChainIds.size < 1)
                  || !inputDatasetId
                  || selectedItemIds.size === 0
                  // Default-prompt requirement only applies when at least one
                  // model column is selected. Chain-only runs ignore it.
                  || (selectedModelIds.size > 0
                      && !promptVersionId
                      && !Array.from(selectedModelIds).every((mid) => !!promptOverrides[mid]))
                }
                onClick={handleCreate}
              >
                Start Comparison
              </Button>
            </ModalBody>
          </Modal>
        </ModalOverlay>
      )}
    </>
  );
}

/* ─── Matrix building ────────────────────────────────────────────────────── */

interface AddToDatasetTarget {
  inputItem: ComparisonInputItem;
  cell: CellData;
  modelName: string;
}

interface CellData {
  child: ComparisonChild;
  result: ComparisonResult;
}

interface MatrixRow {
  inputItem: ComparisonInputItem;
  cells: (CellData | null)[];
}

// A column corresponds 1:1 with a ComparisonChild. We carry the full child
// so the renderer has prompt_version_id, status, and friends without re-lookup.
type MatrixCol =
  | { kind: 'model'; id: string; child: ComparisonChild }
  | { kind: 'chain'; id: string; child: ComparisonChild };

interface MatrixData {
  cols: MatrixCol[];
  rows: MatrixRow[];
}

function buildMatrix(detail: ComparisonRunWithChildren | null): MatrixData {
  if (!detail) return { cols: [], rows: [] };

  // Children already arrive in `ordering` from the backend. Discriminate by
  // `kind` (the canonical field) — `chain_id` / `model_config_id` are just
  // typed lookup keys.
  const cols: MatrixCol[] = detail.children.map((c) => {
    if (c.kind === 'chain') {
      return { kind: 'chain' as const, id: c.chain_id ?? c.id, child: c };
    }
    return { kind: 'model' as const, id: c.model_config_id ?? c.id, child: c };
  });

  // Index results by (child_id, input_item_id) for O(1) lookup.
  const resultIndex = new Map<string, ComparisonResult>();
  for (const child of detail.children) {
    for (const r of child.results) {
      resultIndex.set(`${child.id}:${r.input_item_id}`, r);
    }
  }

  const rows: MatrixRow[] = detail.input_items.map((item) => {
    const cells = cols.map((col) => {
      const r = resultIndex.get(`${col.child.id}:${item.id}`);
      if (!r) return null;
      return { child: col.child, result: r };
    });
    return { inputItem: item, cells };
  });

  return { cols, rows };
}
