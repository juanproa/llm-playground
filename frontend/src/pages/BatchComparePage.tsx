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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';
import { useEscapeKey } from '../hooks/useEscapeKey';
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

/* ─── Full Row Expansion Modal ───────────────────────────────────────────── */

const FullRowOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 150;
`;

const FullRowModal = styled.div`
  background: ${tokens.colors.bg.secondary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  width: 90vw;
  max-width: 1400px;
  max-height: 85vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

const FullRowHead = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
`;

const FullRowHeadTitle = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${tokens.colors.text.muted};
`;

const FullRowBody = styled.div`
  padding: ${tokens.spacing.md};
  overflow: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: ${tokens.spacing.md};
`;

const FullRowInput = styled.pre`
  background: ${tokens.colors.bg.primary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  padding: 12px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${tokens.colors.text.primary};
  margin: 0;
  max-height: 150px;
  overflow-y: auto;
`;

const FullRowGrid = styled.div`
  display: flex;
  gap: ${tokens.spacing.md};
  overflow-x: auto;
  padding-bottom: 8px;
`;

const FullRowCell = styled.div`
  flex: 0 0 minmax(300px, 1fr);
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  background: ${tokens.colors.bg.primary};
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

const FullRowCellHead = styled.div`
  padding: 10px 12px;
  background: ${tokens.colors.bg.secondary};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  font-weight: 600;
  font-size: 0.8rem;
  color: ${tokens.colors.text.primary};
`;

const FullRowCellBody = styled.div`
  padding: 10px 12px;
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const FullRowCellOutput = styled.pre`
  background: ${tokens.colors.bg.primary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  padding: 8px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.7rem;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${tokens.colors.text.primary};
  margin: 0;
  max-height: 300px;
  overflow-y: auto;
  flex: 1;
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

// CSV escape: wrap in quotes if value contains comma, quote, or newline.
// Inner quotes are doubled per RFC 4180.
function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeFilename(name: string): string {
  return (name || 'comparison').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'comparison';
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
  const [scrollLock, setScrollLock] = useState(false);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [fullRowScrollLock, setFullRowScrollLock] = useState(false);
  const [expandFullRowData, setExpandFullRowData] = useState<{ row: MatrixRow; cols: MatrixCol[] } | null>(null);
  const [inputCopied, setInputCopied] = useState(false);
  const scrollRefs = useRef<Map<string, HTMLPreElement>>(new Map());
  const isSyncingScroll = useRef(false);

  const handleSyncScroll = useCallback((rowId: string, source: HTMLPreElement) => {
    if (!scrollLock) return;
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    const top = source.scrollTop;
    scrollRefs.current.forEach((el, key) => {
      if (el === source) return;
      if (!key.startsWith(`${rowId}:`)) return;
      if (el.scrollTop !== top) el.scrollTop = top;
    });
    requestAnimationFrame(() => { isSyncingScroll.current = false; });
  }, [scrollLock]);

  // Add-to-dataset state
  const [addTarget, setAddTarget] = useState<AddToDatasetTarget | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [newDatasetName, setNewDatasetName] = useState<string>('');
  const [savingToDataset, setSavingToDataset] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Add-to-backtest state — saves a (input, expected_output) pair as a TestCase
  // in Post-Training → Backtesting. Mirrors Workspace's "Save as Test Case".
  const [backtestTarget, setBacktestTarget] = useState<AddToDatasetTarget | null>(null);
  const [tcName, setTcName] = useState('');
  const [tcExpectedOutput, setTcExpectedOutput] = useState('');
  const [tcExpectedType, setTcExpectedType] = useState('classification');
  const [tcTags, setTcTags] = useState('');
  const [tcNotes, setTcNotes] = useState('');
  const [tcIsGolden, setTcIsGolden] = useState(false);
  const [savingToBacktest, setSavingToBacktest] = useState(false);
  const [backtestSaveSuccess, setBacktestSaveSuccess] = useState(false);
  const [backtestSaveError, setBacktestSaveError] = useState<string | null>(null);

  // Bulk backtest selection — cellKey format matches the per-cell expanded
  // state key (`${rowId}:${col.kind}:${col.id}`) so they're interchangeable.
  const [selectedCellKeys, setSelectedCellKeys] = useState<Set<string>>(new Set());
  const [bulkBacktestOpen, setBulkBacktestOpen] = useState(false);
  const [bulkExpectedType, setBulkExpectedType] = useState('classification');
  const [bulkTags, setBulkTags] = useState('batch_compare');
  const [bulkNotes, setBulkNotes] = useState('');
  const [bulkIsGolden, setBulkIsGolden] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [bulkDone, setBulkDone] = useState(false);

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

  // Esc-to-close: each modal registers its own handler; the topmost active one
  // closes when Escape is pressed (handled by the useEscapeKey hook's stack).
  useEscapeKey(() => setShowModal(false), showModal);
  useEscapeKey(() => setAddTarget(null), !!addTarget);
  useEscapeKey(() => setBacktestTarget(null), !!backtestTarget);
  useEscapeKey(
    () => { if (!bulkSaving) closeBulkBacktest(); },
    bulkBacktestOpen,
  );
  useEscapeKey(() => setExpandFullRowData(null), !!expandFullRowData);

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
    // Clear stale bulk selection — cellKeys reference the previous run's rows.
    setSelectedCellKeys(new Set());
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

  function openAddToBacktest(target: AddToDatasetTarget) {
    setBacktestTarget(target);
    setBacktestSaveSuccess(false);
    setBacktestSaveError(null);
    const sourceName = target.inputItem.name?.trim();
    setTcName(
      sourceName
        ? `${sourceName} – ${target.modelName}`
        : `Test case – ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${target.modelName}`,
    );
    // Pre-fill the expected output with the model's actual output (think tags
    // stripped) so the user can edit it down to the canonical answer.
    const cleaned = target.cell.child.kind === 'chain'
      ? prettyChainOutput(target.cell.result.actual_output)
      : stripThinkTags(target.cell.result.actual_output);
    setTcExpectedOutput(cleaned);
    setTcExpectedType('classification');
    setTcTags(`batch_compare,model:${target.modelName}`);
    setTcNotes('');
    setTcIsGolden(false);
  }

  async function handleSaveToBacktest() {
    if (!projectId || !backtestTarget || !tcName.trim()) return;
    setSavingToBacktest(true);
    setBacktestSaveError(null);
    try {
      await postTrainingApi.createTestCase(projectId, {
        name: tcName.trim(),
        input_text: backtestTarget.inputItem.input_text,
        expected_output: tcExpectedOutput,
        expected_type: tcExpectedType,
        tags: tcTags.trim() || undefined,
        notes: tcNotes.trim() || undefined,
        is_golden: tcIsGolden,
      });
      setBacktestSaveSuccess(true);
    } catch (e) {
      setBacktestSaveError(e instanceof Error ? e.message : 'Failed to save');
    }
    setSavingToBacktest(false);
  }

  // ─── Bulk backtest helpers ───────────────────────────────────────────────

  function toggleCellSelected(cellKey: string) {
    setSelectedCellKeys((prev) => {
      const next = new Set(prev);
      if (next.has(cellKey)) next.delete(cellKey);
      else next.add(cellKey);
      return next;
    });
  }

  function clearCellSelection() {
    setSelectedCellKeys(new Set());
  }

  function openBulkBacktest() {
    setBulkBacktestOpen(true);
    setBulkDone(false);
    setBulkProgress(null);
    setBulkExpectedType('classification');
    setBulkTags('batch_compare');
    setBulkNotes('');
    setBulkIsGolden(false);
  }

  function closeBulkBacktest() {
    setBulkBacktestOpen(false);
    if (bulkDone) {
      // Clear selection only after a successful (or partial) save so users
      // can retry without re-checking everything if they cancelled mid-form.
      setSelectedCellKeys(new Set());
      setBulkDone(false);
      setBulkProgress(null);
    }
  }

  function openExpandFullRow(row: MatrixRow, cols: MatrixCol[]) {
    setExpandFullRowData({ row, cols });
    setFullRowScrollLock(false);
  }

  function handleDownloadCsv() {
    if (!detail) return;
    const cols = matrix.cols;
    const colLabels = cols.map((col) => {
      if (col.kind === 'chain') {
        return chains.find((c) => c.id === col.id)?.name ?? `chain:${col.id.slice(0, 8)}`;
      }
      return models.find((m) => m.id === col.id)?.name ?? `model:${col.id.slice(0, 8)}`;
    });

    const headers = ['#', 'input_name', 'input_text', ...colLabels];

    const lines: string[] = [headers.map(csvCell).join(',')];
    matrix.rows.forEach((row, idx) => {
      const cells: (string | number | null)[] = [
        idx + 1,
        row.inputItem.name ?? '',
        row.inputItem.input_text ?? '',
      ];
      cols.forEach((col, colIdx) => {
        const cell = row.cells[colIdx];
        if (!cell) {
          cells.push('');
          return;
        }
        const output = col.kind === 'chain'
          ? prettyChainOutput(cell.result.actual_output)
          : stripThinkTags(cell.result.actual_output);
        cells.push(output);
      });
      lines.push(cells.map(csvCell).join(','));
    });

    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(`${safeFilename(detail.name)}-${date}.csv`, lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  async function handleClone(runId: string) {
    if (!projectId) return;
    try {
      const full = await postTrainingApi.getComparisonRun(projectId, runId);
      // Form fields derivable directly from the run
      setName(`${full.name} (clone)`);
      setPromptVersionId(full.prompt_version_id ?? '');
      setJudgeModelId(full.judge_model_config_id ?? '');

      // Models and chains: split children by kind
      const modelIds = new Set<string>();
      const chainIds = new Set<string>();
      const overrides: Record<string, string> = {};
      for (const child of full.children) {
        if (child.kind === 'model' && child.model_config_id) {
          modelIds.add(child.model_config_id);
          // A child whose prompt diverges from the parent's was an override
          if (child.prompt_version_id && child.prompt_version_id !== full.prompt_version_id) {
            overrides[child.model_config_id] = child.prompt_version_id;
          }
        } else if (child.kind === 'chain' && child.chain_id) {
          chainIds.add(child.chain_id);
        }
      }
      setSelectedModelIds(modelIds);
      setSelectedChainIds(chainIds);
      setPromptOverrides(overrides);

      // Resolve the input dataset by looking up any source item id across known
      // datasets. If the source dataset was deleted we just leave it blank.
      const sourceItemIds = full.input_items
        .map((it) => it.source_input_dataset_item_id)
        .filter((x): x is string => !!x);
      setInputDatasetId('');
      setDatasetItems([]);
      setSelectedItemIds(new Set());
      if (sourceItemIds.length > 0 && inputDatasets.length > 0) {
        const wanted = new Set(sourceItemIds);
        for (const ds of inputDatasets) {
          try {
            const items = await inputDatasetsApi.listItems(ds.id);
            if (items.some((it) => wanted.has(it.id))) {
              setInputDatasetId(ds.id);
              setDatasetItems(items);
              setSelectedItemIds(new Set(items.filter((it) => wanted.has(it.id)).map((it) => it.id)));
              break;
            }
          } catch { /* ignore and try next */ }
        }
      }

      setShowModal(true);
    } catch (e) {
      alert((e as Error).message);
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

  // Cells eligible for bulk backtest: completed + non-empty output. Mirrors
  // the gate used to render the per-cell "+ Backtest" button (line ~1283).
  const selectableCellKeys = useMemo(() => {
    const keys: string[] = [];
    for (const row of matrix.rows) {
      row.cells.forEach((cell, colIdx) => {
        if (!cell) return;
        if (cell.result.status !== 'completed') return;
        if (!cell.result.actual_output) return;
        const col = matrix.cols[colIdx];
        keys.push(`${row.inputItem.id}:${col.kind}:${col.id}`);
      });
    }
    return keys;
  }, [matrix]);

  function selectAllSelectableCells() {
    setSelectedCellKeys(new Set(selectableCellKeys));
  }

  // Resolve a cellKey back to (row, col, cell, modelName) — needed for bulk
  // save and the dialog preview list.
  function resolveCellKey(cellKey: string): { row: MatrixRow; col: MatrixCol; cell: CellData; modelName: string } | null {
    const idx = cellKey.indexOf(':');
    if (idx < 0) return null;
    const rowId = cellKey.slice(0, idx);
    const rest = cellKey.slice(idx + 1);
    const sepIdx = rest.indexOf(':');
    if (sepIdx < 0) return null;
    const kind = rest.slice(0, sepIdx);
    const colId = rest.slice(sepIdx + 1);
    const row = matrix.rows.find((r) => r.inputItem.id === rowId);
    if (!row) return null;
    const colIdx = matrix.cols.findIndex((c) => c.kind === kind && c.id === colId);
    if (colIdx < 0) return null;
    const col = matrix.cols[colIdx];
    const cell = row.cells[colIdx];
    if (!cell) return null;
    const modelName = col.kind === 'chain'
      ? (chains.find((c) => c.id === col.id)?.name ?? col.id.slice(0, 8))
      : (models.find((x) => x.id === col.id)?.name ?? col.id.slice(0, 8));
    return { row, col, cell, modelName };
  }

  async function handleBulkSaveBacktest() {
    if (!projectId) return;
    const keys = Array.from(selectedCellKeys);
    if (keys.length === 0) return;
    setBulkSaving(true);
    setBulkProgress({ done: 0, total: keys.length, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const key of keys) {
      const resolved = resolveCellKey(key);
      if (!resolved) {
        failed++;
        done++;
        setBulkProgress({ done, total: keys.length, failed });
        continue;
      }
      const { row, col, cell, modelName } = resolved;
      const cleaned = col.kind === 'chain'
        ? prettyChainOutput(cell.result.actual_output)
        : stripThinkTags(cell.result.actual_output);
      const baseName = row.inputItem.name?.trim();
      const name = baseName
        ? `${baseName} – ${modelName}`
        : `Test case – ${modelName} – ${done + 1}`;
      const sharedTags = bulkTags.trim();
      const tags = sharedTags
        ? `${sharedTags},model:${modelName}`
        : `model:${modelName}`;
      try {
        await postTrainingApi.createTestCase(projectId, {
          name,
          input_text: row.inputItem.input_text,
          expected_output: cleaned,
          expected_type: bulkExpectedType,
          tags,
          notes: bulkNotes.trim() || undefined,
          is_golden: bulkIsGolden,
        });
      } catch {
        failed++;
      }
      done++;
      setBulkProgress({ done, total: keys.length, failed });
    }
    setBulkSaving(false);
    setBulkDone(true);
  }

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
                      title="Clone — open New Comparison with this run's settings"
                      onClick={(e) => { e.stopPropagation(); handleClone(r.id); }}
                      style={{ fontSize: '0.8rem', padding: '4px 10px', color: tokens.colors.accent.primary }}
                    >
                      ⎘ Clone
                    </Button>
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
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                {matrix.rows.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleDownloadCsv}
                    title="Download comparison results as CSV"
                  >
                    ↓ CSV
                  </Button>
                )}
                {(detail.status === 'running' || detail.status === 'pending') && (
                  <Button size="sm" variant="danger" onClick={handleStop}>
                    Stop
                  </Button>
                )}
                {detail.status === 'cancelling' && (
                  <Button size="sm" variant="ghost" disabled>
                    Stopping…
                  </Button>
                )}
              </div>
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
                <label title="Expand a whole row at once and sync scroll across its cells">
                  <input
                    type="checkbox"
                    checked={scrollLock}
                    onChange={(e) => {
                      setScrollLock(e.target.checked);
                      setExpandedCellKey(null);
                      setExpandedRowId(null);
                    }}
                  /> Scroll lock
                </label>
                {selectableCellKeys.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={selectAllSelectableCells}
                      title="Check every completed cell with output"
                    >
                      Select all cells ({selectableCellKeys.length})
                    </Button>
                    {selectedCellKeys.size > 0 && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={clearCellSelection}
                        >
                          Clear ({selectedCellKeys.size})
                        </Button>
                        <Button
                          size="sm"
                          onClick={openBulkBacktest}
                          title="Save every selected cell as a Backtest test case"
                        >
                          + Backtest ({selectedCellKeys.size})
                        </Button>
                      </>
                    )}
                  </>
                )}
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
                        <Row style={{ marginBottom: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500 }}>
                              {row.inputItem.name || `#${rowIdx + 1}`}
                            </div>
                            {row.inputItem.name && (
                              <Muted style={{ marginTop: 2 }}>#{rowIdx + 1}</Muted>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Expand full row comparison"
                            style={{ padding: '4px 8px', fontSize: '0.7rem', flexShrink: 0 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              openExpandFullRow(row, matrix.cols);
                            }}
                          >
                            ↗
                          </Button>
                        </Row>
                        <Muted style={{
                          color: tokens.colors.text.primary,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: tokens.fonts.mono,
                        }}>
                          {inputPreview(row.inputItem.input_text, 160)}
                        </Muted>
                      </Td>
                      {row.cells.map((cell, colIdx) => {
                        const col = matrix.cols[colIdx];
                        const colKey = `${col.kind}:${col.id}`;
                        const cellKey = `${row.inputItem.id}:${colKey}`;
                        const isExpanded = scrollLock
                          ? expandedRowId === row.inputItem.id
                          : expandedCellKey === cellKey;
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
                            onClick={() => {
                              if (scrollLock) {
                                setExpandedRowId(isExpanded ? null : row.inputItem.id);
                              } else {
                                setExpandedCellKey(isExpanded ? null : cellKey);
                              }
                            }}
                            style={{ cursor: 'pointer' }}
                          >
                            <Row>
                              {status === 'completed' && cell.result.actual_output && (
                                <input
                                  type="checkbox"
                                  checked={selectedCellKeys.has(cellKey)}
                                  onChange={() => toggleCellSelected(cellKey)}
                                  onClick={(e) => e.stopPropagation()}
                                  title="Select this cell for bulk backtest"
                                  style={{ margin: 0, cursor: 'pointer' }}
                                />
                              )}
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
                                  <>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      title="Add this output to a Fine-Tuning (SFT) dataset"
                                      style={{ padding: '1px 6px', fontSize: '0.65rem', opacity: 0.7 }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openAddToDataset({ inputItem: row.inputItem, cell, modelName });
                                      }}
                                    >
                                      + SFT Dataset
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      title="Save this input/output as a Backtest test case"
                                      style={{ padding: '1px 6px', fontSize: '0.65rem', opacity: 0.7 }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openAddToBacktest({ inputItem: row.inputItem, cell, modelName });
                                      }}
                                    >
                                      + Backtest
                                    </Button>
                                  </>
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
                            {!cleanedOutput && !isPending && !isFailed && !isCancelled && (
                              <Muted style={{
                                marginTop: 4,
                                color: tokens.colors.accent.warning,
                                fontStyle: 'italic',
                                whiteSpace: 'normal',
                              }}>
                                ⚠ Empty output. Likely max_tokens reached during reasoning. Try a larger max_tokens, or add "detailed thinking off" to the system prompt.
                              </Muted>
                            )}

                            {isExpanded && (
                              <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                                <pre
                                  ref={(el) => {
                                    if (el) scrollRefs.current.set(cellKey, el);
                                    else scrollRefs.current.delete(cellKey);
                                  }}
                                  onScroll={(e) => handleSyncScroll(row.inputItem.id, e.currentTarget)}
                                  style={{
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    background: tokens.colors.bg.primary,
                                    padding: 8,
                                    borderRadius: 4,
                                    maxHeight: 300,
                                    overflow: 'auto',
                                    fontSize: '0.7rem',
                                    margin: 0,
                                  }}
                                >
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

      {/* ── Add to SFT (Fine-Tuning) Dataset dialog ── */}
      {addTarget && (
        <DialogOverlay onClick={() => setAddTarget(null)}>
          <Dialog onClick={(e) => e.stopPropagation()}>
            <ModalHead>
              <PaneTitle>Add to SFT Dataset</PaneTitle>
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

      {/* ── Add to Backtest (Test Case) dialog ── */}
      {backtestTarget && (
        <DialogOverlay onClick={() => setBacktestTarget(null)}>
          <Dialog onClick={(e) => e.stopPropagation()}>
            <ModalHead>
              <PaneTitle>Save as Backtest Test Case</PaneTitle>
              <Button size="sm" variant="ghost" onClick={() => setBacktestTarget(null)}>Close</Button>
            </ModalHead>
            <ModalBody>
              {backtestSaveSuccess ? (
                <div style={{ textAlign: 'center', padding: '16px 0', color: tokens.colors.accent.success }}>
                  ✓ Test case saved to Post-Training → Backtesting{' '}
                  <Button size="sm" variant="ghost" onClick={() => setBacktestTarget(null)}>Close</Button>
                </div>
              ) : (
                <>
                  <FormGroup>
                    <Label>Name</Label>
                    <Input
                      value={tcName}
                      onChange={(e) => setTcName(e.target.value)}
                      placeholder="Describe what this test case validates"
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label>Input</Label>
                    <PreviewBox>{backtestTarget.inputItem.input_text}</PreviewBox>
                  </FormGroup>

                  <FormGroup>
                    <Label>Expected Output ({backtestTarget.modelName}) — edit if needed</Label>
                    <textarea
                      value={tcExpectedOutput}
                      onChange={(e) => setTcExpectedOutput(e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: 100,
                        maxHeight: 220,
                        background: tokens.colors.bg.tertiary,
                        border: `1px solid ${tokens.colors.border.subtle}`,
                        borderRadius: tokens.radii.sm,
                        color: tokens.colors.text.primary,
                        padding: '8px 10px',
                        fontFamily: tokens.fonts.mono,
                        fontSize: '0.78rem',
                        outline: 'none',
                        resize: 'vertical',
                        boxSizing: 'border-box',
                      }}
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label>Expected Output Type</Label>
                    <Select value={tcExpectedType} onChange={(e) => setTcExpectedType(e.target.value)}>
                      <option value="generative">Generative</option>
                      <option value="classification">Classification</option>
                      <option value="extraction">Extraction</option>
                      <option value="structured">Structured</option>
                    </Select>
                  </FormGroup>

                  <FormGroup>
                    <Label>Tags (comma-separated)</Label>
                    <Input
                      value={tcTags}
                      onChange={(e) => setTcTags(e.target.value)}
                      placeholder="e.g. ocr, medical, v2-prompt"
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label>Notes (optional)</Label>
                    <textarea
                      value={tcNotes}
                      onChange={(e) => setTcNotes(e.target.value)}
                      placeholder="Why is this output good? What should the model preserve?"
                      style={{
                        width: '100%',
                        minHeight: 60,
                        background: tokens.colors.bg.tertiary,
                        border: `1px solid ${tokens.colors.border.subtle}`,
                        borderRadius: tokens.radii.sm,
                        color: tokens.colors.text.primary,
                        padding: '8px 10px',
                        fontFamily: tokens.fonts.body,
                        fontSize: '0.82rem',
                        outline: 'none',
                        resize: 'vertical',
                        boxSizing: 'border-box',
                      }}
                    />
                  </FormGroup>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: tokens.colors.text.secondary, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={tcIsGolden}
                      onChange={(e) => setTcIsGolden(e.target.checked)}
                      style={{ accentColor: tokens.colors.accent.primary }}
                    />
                    Mark as golden dataset entry (high-confidence ground truth)
                  </label>

                  {backtestSaveError && (
                    <div style={{ fontSize: '0.8rem', color: tokens.colors.accent.error }}>
                      Error: {backtestSaveError}
                    </div>
                  )}

                  <Button
                    disabled={savingToBacktest || !tcName.trim()}
                    onClick={handleSaveToBacktest}
                  >
                    {savingToBacktest ? 'Saving…' : 'Save Test Case'}
                  </Button>
                </>
              )}
            </ModalBody>
          </Dialog>
        </DialogOverlay>
      )}

      {/* ── Bulk Add to Backtest dialog ── */}
      {bulkBacktestOpen && (
        <DialogOverlay onClick={() => { if (!bulkSaving) closeBulkBacktest(); }}>
          <Dialog onClick={(e) => e.stopPropagation()}>
            <ModalHead>
              <PaneTitle>
                Save {selectedCellKeys.size} cell{selectedCellKeys.size === 1 ? '' : 's'} as Backtest test cases
              </PaneTitle>
              <Button size="sm" variant="ghost" disabled={bulkSaving} onClick={closeBulkBacktest}>Close</Button>
            </ModalHead>
            <ModalBody>
              {bulkDone ? (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <div style={{ color: tokens.colors.accent.success, marginBottom: 8 }}>
                    ✓ Created {bulkProgress ? bulkProgress.done - bulkProgress.failed : 0} test case{(bulkProgress?.done ?? 1) === 1 ? '' : 's'}
                    {bulkProgress && bulkProgress.failed > 0 && (
                      <span style={{ color: tokens.colors.accent.error }}>
                        {' '}· {bulkProgress.failed} failed
                      </span>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" onClick={closeBulkBacktest}>Close</Button>
                </div>
              ) : (
                <>
                  <FormGroup>
                    <Label>Selected cells ({selectedCellKeys.size})</Label>
                    <div
                      style={{
                        background: tokens.colors.bg.primary,
                        border: `1px solid ${tokens.colors.border.subtle}`,
                        borderRadius: tokens.radii.sm,
                        padding: 8,
                        maxHeight: 140,
                        overflowY: 'auto',
                        fontSize: '0.75rem',
                        fontFamily: tokens.fonts.mono,
                        color: tokens.colors.text.secondary,
                      }}
                    >
                      {Array.from(selectedCellKeys).slice(0, 10).map((key) => {
                        const r = resolveCellKey(key);
                        if (!r) return <div key={key}>(removed)</div>;
                        const rowLabel = r.row.inputItem.name || inputPreview(r.row.inputItem.input_text, 40);
                        return (
                          <div key={key} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {rowLabel} → {r.modelName}
                          </div>
                        );
                      })}
                      {selectedCellKeys.size > 10 && (
                        <div style={{ color: tokens.colors.text.muted, marginTop: 4 }}>
                          … and {selectedCellKeys.size - 10} more
                        </div>
                      )}
                    </div>
                    <Muted style={{ marginTop: 4 }}>
                      Each test case auto-named <code>{'{input}'} – {'{model}'}</code>. Outputs cleaned of <code>{'<think>'}</code> blocks.
                    </Muted>
                  </FormGroup>

                  <FormGroup>
                    <Label>Expected Output Type (applied to all)</Label>
                    <Select value={bulkExpectedType} onChange={(e) => setBulkExpectedType(e.target.value)}>
                      <option value="generative">Generative</option>
                      <option value="classification">Classification</option>
                      <option value="extraction">Extraction</option>
                      <option value="structured">Structured</option>
                    </Select>
                  </FormGroup>

                  <FormGroup>
                    <Label>Shared tags (per-case <code>model:{'{name}'}</code> appended)</Label>
                    <Input
                      value={bulkTags}
                      onChange={(e) => setBulkTags(e.target.value)}
                      placeholder="batch_compare"
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label>Notes (applied to every case, optional)</Label>
                    <textarea
                      value={bulkNotes}
                      onChange={(e) => setBulkNotes(e.target.value)}
                      placeholder="Shared note for this bulk import"
                      style={{
                        width: '100%',
                        minHeight: 50,
                        background: tokens.colors.bg.tertiary,
                        border: `1px solid ${tokens.colors.border.subtle}`,
                        borderRadius: tokens.radii.sm,
                        color: tokens.colors.text.primary,
                        padding: '8px 10px',
                        fontFamily: tokens.fonts.body,
                        fontSize: '0.82rem',
                        outline: 'none',
                        resize: 'vertical',
                        boxSizing: 'border-box',
                      }}
                    />
                  </FormGroup>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: tokens.colors.text.secondary, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={bulkIsGolden}
                      onChange={(e) => setBulkIsGolden(e.target.checked)}
                      style={{ accentColor: tokens.colors.accent.primary }}
                    />
                    Mark all as golden dataset entries
                  </label>

                  {bulkSaving && bulkProgress && (
                    <Muted style={{ color: tokens.colors.text.primary }}>
                      Saving {bulkProgress.done}/{bulkProgress.total}
                      {bulkProgress.failed > 0 && (
                        <span style={{ color: tokens.colors.accent.error }}>
                          {' '}· {bulkProgress.failed} failed
                        </span>
                      )}
                      …
                    </Muted>
                  )}

                  <Button
                    disabled={bulkSaving || selectedCellKeys.size === 0}
                    onClick={handleBulkSaveBacktest}
                  >
                    {bulkSaving
                      ? `Saving ${bulkProgress?.done ?? 0}/${bulkProgress?.total ?? selectedCellKeys.size}…`
                      : `Save ${selectedCellKeys.size} test case${selectedCellKeys.size === 1 ? '' : 's'}`}
                  </Button>
                </>
              )}
            </ModalBody>
          </Dialog>
        </DialogOverlay>
      )}

      {expandFullRowData && (
        <FullRowOverlay onClick={() => setExpandFullRowData(null)}>
          <FullRowModal onClick={(e) => e.stopPropagation()}>
            <FullRowHead>
              <FullRowHeadTitle>Expand Comparison</FullRowHeadTitle>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginLeft: 'auto' }}>
                <label title="Sync scroll across all outputs">
                  <input
                    type="checkbox"
                    checked={fullRowScrollLock}
                    onChange={(e) => setFullRowScrollLock(e.target.checked)}
                  /> Scroll lock
                </label>
                <Button size="sm" variant="ghost" onClick={() => setExpandFullRowData(null)}>Close</Button>
              </div>
            </FullRowHead>
            <FullRowBody>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                    <Label style={{ marginBottom: 0 }}>Input</Label>
                    {expandFullRowData.row.inputItem.name && (
                      <span
                        title={expandFullRowData.row.inputItem.name}
                        style={{
                          fontFamily: tokens.fonts.mono,
                          fontSize: '0.78rem',
                          color: tokens.colors.text.primary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {expandFullRowData.row.inputItem.name}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Copy input to clipboard"
                    style={{ fontSize: '0.7rem', padding: '2px 8px', flexShrink: 0 }}
                    onClick={async () => {
                      const text = expandFullRowData.row.inputItem.input_text || '';
                      try {
                        await navigator.clipboard.writeText(text);
                      } catch {
                        // Clipboard API can be blocked (insecure context, denied perm).
                        // Fall back to a hidden textarea + execCommand.
                        const ta = document.createElement('textarea');
                        ta.value = text;
                        ta.style.position = 'fixed';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        try { document.execCommand('copy'); } catch { /* give up silently */ }
                        document.body.removeChild(ta);
                      }
                      setInputCopied(true);
                      setTimeout(() => setInputCopied(false), 1500);
                    }}
                  >
                    {inputCopied ? '✓ Copied' : '⧉ Copy'}
                  </Button>
                </div>
                <FullRowInput>{expandFullRowData.row.inputItem.input_text || '(empty)'}</FullRowInput>
              </div>

              <div>
                <Label style={{ marginBottom: 8 }}>Outputs</Label>
                <FullRowGrid>
                  {expandFullRowData.cols.map((col, colIdx) => {
                    const cell = expandFullRowData.row.cells[colIdx];
                    const modelName = col.kind === 'chain'
                      ? (chains.find((c) => c.id === col.id)?.name ?? col.id.slice(0, 8))
                      : (models.find((x) => x.id === col.id)?.name ?? col.id.slice(0, 8));

                    const cleanedOutput = col.kind === 'chain'
                      ? prettyChainOutput(cell?.result.actual_output)
                      : stripThinkTags(cell?.result.actual_output);

                    const cellKey = `fullrow:${expandFullRowData.row.inputItem.id}:${col.kind}:${col.id}`;

                    return (
                      <FullRowCell key={`${col.kind}:${col.id}`}>
                        <FullRowCellHead>
                          <div>{modelName}</div>
                          {col.kind === 'model' && (
                            <Muted style={{ fontSize: '0.7rem', marginTop: 2 }}>
                              {col.child.status}
                            </Muted>
                          )}
                        </FullRowCellHead>
                        <FullRowCellBody>
                          {!cell ? (
                            <Muted>—</Muted>
                          ) : (
                            <>
                              <Row style={{ gap: 4, fontSize: '0.7rem' }}>
                                {cell.result.status === 'pending' ? (
                                  <Badge color="secondary">pending</Badge>
                                ) : cell.result.status === 'failed' ? (
                                  <Badge color="error">failed</Badge>
                                ) : cell.result.status === 'cancelled' ? (
                                  <Badge color="secondary">cancelled</Badge>
                                ) : (
                                  <Badge color="success">ok</Badge>
                                )}
                                {cell.result.cache_hit && <span title="From cache">⚡</span>}
                                {cell.result.latency_ms != null && <span>{cell.result.latency_ms}ms</span>}
                              </Row>
                              {cleanedOutput && (
                                <FullRowCellOutput
                                  ref={(el) => {
                                    if (el) scrollRefs.current.set(cellKey, el);
                                    else scrollRefs.current.delete(cellKey);
                                  }}
                                  onScroll={(e) => {
                                    if (!fullRowScrollLock) return;
                                    const source = e.currentTarget;
                                    const top = source.scrollTop;
                                    scrollRefs.current.forEach((el, key) => {
                                      if (!key.startsWith('fullrow:')) return;
                                      if (el === source) return;
                                      if (el.scrollTop !== top) el.scrollTop = top;
                                    });
                                  }}
                                >
                                  {cleanedOutput || '(no output)'}
                                </FullRowCellOutput>
                              )}
                              {!cleanedOutput && cell.result.status !== 'pending' && cell.result.status !== 'failed' && cell.result.status !== 'cancelled' && (
                                <Muted style={{
                                  color: tokens.colors.accent.warning,
                                  fontStyle: 'italic',
                                  fontSize: '0.7rem',
                                }}>
                                  ⚠ Empty output. Likely max_tokens reached during reasoning. Try a larger max_tokens, or add "detailed thinking off" to the system prompt.
                                </Muted>
                              )}
                              {cell.result.error_message && (
                                <Muted style={{ color: tokens.colors.accent.error, fontSize: '0.7rem' }}>
                                  Error: {cell.result.error_message}
                                </Muted>
                              )}
                            </>
                          )}
                        </FullRowCellBody>
                      </FullRowCell>
                    );
                  })}
                </FullRowGrid>
              </div>
            </FullRowBody>
          </FullRowModal>
        </FullRowOverlay>
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
