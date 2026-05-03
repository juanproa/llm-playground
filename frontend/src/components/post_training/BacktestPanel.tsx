import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import * as XLSX from 'xlsx';
import { tokens } from '../../theme/tokens';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { postTrainingApi } from '../../api/postTraining';
import { usePromptStore } from '../../stores/promptStore';
import { useModelStore } from '../../stores/modelStore';
import type { AssertionSpec, BacktestResult, BacktestRun, TestCase } from '../../types';
import { AssertionsEditor } from './AssertionsEditor';
import { ExpectedOutputPicker } from './ExpectedOutputPicker';
import { AddToDatasetModal, type AddToDatasetItem } from './AddToDatasetModal';

function parseAssertions(raw: string | null): AssertionSpec[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Format an assertion as a single readable line for CSV export. */
function formatAssertion(a: AssertionSpec): string {
  const parts: string[] = [];
  parts.push(a.name || '(unnamed)');
  parts.push(`${a.type}${a.path ? ` @${a.path}` : ''}`);
  if (a.expected !== undefined && a.expected !== null) {
    const expected =
      typeof a.expected === 'string' ? a.expected : JSON.stringify(a.expected);
    parts.push(`expected=${expected}`);
  }
  if (a.weight != null && a.weight !== 1) {
    parts.push(`weight=${a.weight}`);
  }
  return parts.join(' | ');
}

/**
 * Excel hard-caps cell text at 32,767 characters. Any longer content has to be
 * truncated or the workbook generation throws "Text length must not exceed 32767
 * characters". We leave room for a clear "[…truncated]" suffix.
 */
const EXCEL_CELL_LIMIT = 32767;
const EXCEL_TRUNCATION_SUFFIX = '\n\n[…truncated for Excel]';
function clipForExcel(value: string | number | null): string | number | null {
  if (typeof value !== 'string') return value;
  if (value.length <= EXCEL_CELL_LIMIT) return value;
  return value.slice(0, EXCEL_CELL_LIMIT - EXCEL_TRUNCATION_SUFFIX.length) + EXCEL_TRUNCATION_SUFFIX;
}

/**
 * Build an .xlsx workbook from a header row and data rows, then trigger a download.
 * Sheet column widths are auto-sized (capped) and the header row is bold.
 */
function downloadXlsx(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: (string | number | null)[][],
) {
  // Clip every cell to Excel's 32,767-char limit so writing never throws on
  // long PDF dumps or model outputs.
  const safeRows = rows.map((row) => row.map(clipForExcel));
  const aoa: (string | number | null)[][] = [headers, ...safeRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Auto-fit column widths (capped at 80 chars to keep wide cells readable)
  const colWidths = headers.map((h, i) => {
    const maxLen = Math.max(
      h.length,
      ...rows.map((r) => {
        const v = r[i];
        if (v == null) return 0;
        const s = String(v);
        // For multi-line cells, use the longest single line so columns aren't unreadable
        return s.split('\n').reduce((m, line) => Math.max(m, line.length), 0);
      }),
    );
    return { wch: Math.min(Math.max(maxLen + 2, 12), 80) };
  });
  ws['!cols'] = colWidths;

  // Bold the header row
  for (let c = 0; c < headers.length; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[cellRef]) {
      ws[cellRef].s = { font: { bold: true } };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Generate a binary array buffer and trigger our own download (consistent
  // across browsers and easier to reason about than XLSX.writeFile).
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

interface Props {
  projectId: string;
}

// ─── Styled Components ────────────────────────────────────────────────────────

const Layout = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: 100%;
  overflow: hidden;
`;

const Panel = styled.div`
  border-right: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &:last-child { border-right: none; }
`;

const PanelHeader = styled.div`
  padding: ${tokens.spacing.md};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const PanelTitle = styled.h3`
  font-family: ${tokens.fonts.accent};
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: ${tokens.colors.text.secondary};
  margin: 0;
`;

const PanelBody = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${tokens.spacing.md};
  display: flex;
  flex-direction: column;
  gap: ${tokens.spacing.sm};
`;

const Card = styled.div<{ $selected?: boolean }>`
  padding: ${tokens.spacing.sm} ${tokens.spacing.md};
  background: ${({ $selected }) => ($selected ? 'rgba(108, 92, 231, 0.12)' : tokens.colors.bg.tertiary)};
  border: 1px solid ${({ $selected }) => ($selected ? tokens.colors.accent.primary : tokens.colors.border.subtle)};
  border-radius: ${tokens.radii.md};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: ${tokens.colors.accent.primary};
  }
`;

const CardTitle = styled.div`
  font-family: ${tokens.fonts.body};
  font-size: 0.875rem;
  font-weight: 500;
  color: ${tokens.colors.text.primary};
  margin-bottom: 4px;
`;

const CardMeta = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 0.7rem;
  color: ${tokens.colors.text.muted};
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
`;

const Label = styled.label`
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  font-weight: 500;
  color: ${tokens.colors.text.secondary};
`;

const Input = styled.input`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  color: ${tokens.colors.text.primary};
  font-family: ${tokens.fonts.body};
  font-size: 0.875rem;
  padding: 8px 12px;
  outline: none;
  width: 100%;
  box-sizing: border-box;

  &:focus { border-color: ${tokens.colors.accent.primary}; }
`;

const Textarea = styled.textarea`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  color: ${tokens.colors.text.primary};
  font-family: ${tokens.fonts.body};
  font-size: 0.875rem;
  padding: 8px 12px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 70px;

  &:focus { border-color: ${tokens.colors.accent.primary}; }
`;

const Select = styled.select`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  color: ${tokens.colors.text.primary};
  font-family: ${tokens.fonts.body};
  font-size: 0.875rem;
  padding: 8px 12px;
  outline: none;
  width: 100%;
  box-sizing: border-box;

  &:focus { border-color: ${tokens.colors.accent.primary}; }
`;

const CheckboxRow = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: ${tokens.fonts.body};
  font-size: 0.875rem;
  color: ${tokens.colors.text.secondary};
  cursor: pointer;
`;

const Row = styled.div`
  display: flex;
  gap: ${tokens.spacing.sm};
  align-items: center;
`;

const PassRate = styled.span<{ $rate: number }>`
  font-family: ${tokens.fonts.mono};
  font-weight: 700;
  font-size: 0.9rem;
  color: ${({ $rate }) =>
    $rate >= 0.8
      ? tokens.colors.accent.success
      : $rate >= 0.5
      ? tokens.colors.accent.warning
      : tokens.colors.accent.error};
`;

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Modal = styled.div`
  background: ${tokens.colors.bg.secondary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.lg};
  width: 860px;
  max-width: 95vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: ${tokens.shadows.elevated};
`;

const ModalHeader = styled.div`
  padding: ${tokens.spacing.md} ${tokens.spacing.lg};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const ModalTitle = styled.h2`
  font-family: ${tokens.fonts.display};
  font-size: 1rem;
  font-weight: 700;
  color: ${tokens.colors.text.primary};
  margin: 0;
`;

const ModalBody = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${tokens.spacing.lg};
`;

const ResultTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-family: ${tokens.fonts.body};
  font-size: 0.8rem;
`;

const Th = styled.th`
  text-align: left;
  padding: 8px 10px;
  background: ${tokens.colors.bg.tertiary};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  color: ${tokens.colors.text.secondary};
  font-family: ${tokens.fonts.accent};
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const Td = styled.td`
  padding: 8px 10px;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  color: ${tokens.colors.text.primary};
  vertical-align: top;
`;

const DiffSection = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${tokens.spacing.sm};
  margin-top: ${tokens.spacing.sm};
`;

const DiffBox = styled.div<{ $type: 'expected' | 'actual' }>`
  background: ${({ $type }) =>
    $type === 'expected'
      ? 'rgba(0, 230, 118, 0.05)'
      : 'rgba(255, 82, 82, 0.05)'};
  border: 1px solid ${({ $type }) =>
    $type === 'expected'
      ? 'rgba(0, 230, 118, 0.2)'
      : 'rgba(255, 82, 82, 0.2)'};
  border-radius: ${tokens.radii.sm};
  padding: ${tokens.spacing.sm};
  font-family: ${tokens.fonts.mono};
  font-size: 0.72rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
  color: ${tokens.colors.text.primary};
`;

const DiffLabel = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${tokens.colors.text.muted};
  margin-bottom: 4px;
`;

const EmptyState = styled.div`
  color: ${tokens.colors.text.muted};
  font-family: ${tokens.fonts.body};
  font-size: 0.8rem;
  text-align: center;
  padding: ${tokens.spacing.lg};
`;

const DetailSection = styled.div`
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const DetailField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const DetailFieldHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const CopyButton = styled.button`
  background: transparent;
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  color: ${tokens.colors.text.secondary};
  font-family: ${tokens.fonts.accent};
  font-size: 0.65rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  cursor: pointer;
  transition: all 0.12s ease;

  &:hover {
    color: ${tokens.colors.text.primary};
    border-color: ${tokens.colors.accent.primary};
  }

  &:active {
    transform: scale(0.96);
  }
`;

const TestCaseLink = styled.button`
  background: transparent;
  border: none;
  color: ${tokens.colors.accent.primary};
  font-family: inherit;
  font-size: inherit;
  padding: 0;
  cursor: pointer;
  text-align: left;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;

  &:hover {
    text-decoration-style: solid;
  }
`;

const DetailLabel = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${tokens.colors.text.muted};
`;

const DetailValue = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 0.78rem;
  line-height: 1.6;
  color: ${tokens.colors.text.primary};
  white-space: pre-wrap;
  word-break: break-word;
  background: ${tokens.colors.bg.primary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  padding: 8px 10px;
  max-height: 180px;
  overflow-y: auto;
`;

const DetailRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
`;

const DetailActions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
`;

const SummaryRow = styled.div`
  display: flex;
  gap: ${tokens.spacing.md};
  margin-bottom: ${tokens.spacing.md};
`;

const SummaryCard = styled.div`
  flex: 1;
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: ${tokens.spacing.sm} ${tokens.spacing.md};
  text-align: center;
`;

const SummaryValue = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 1.4rem;
  font-weight: 700;
  color: ${tokens.colors.text.primary};
`;

const SummaryLabel = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${tokens.colors.text.muted};
  margin-top: 2px;
`;

function getStatusColor(status: string): 'success' | 'error' | 'secondary' | 'warning' {
  switch (status) {
    case 'passed': return 'success';
    case 'failed': return 'error';
    case 'error': return 'error';
    default: return 'secondary';
  }
}

function getRunBadgeColor(status: string): 'primary' | 'success' | 'error' | 'secondary' {
  switch (status) {
    case 'running': return 'primary';
    case 'completed': return 'success';
    case 'failed': return 'error';
    default: return 'secondary';
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BacktestPanel({ projectId }: Props) {
  const { prompts, fetchPrompts } = usePromptStore();
  const { models, fetchModels } = useModelStore();

  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [backtestRuns, setBacktestRuns] = useState<BacktestRun[]>([]);
  const [showCaseForm, setShowCaseForm] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [selectedRun, setSelectedRun] = useState<(BacktestRun & { results: BacktestResult[] }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());
  const [copiedCaseId, setCopiedCaseId] = useState<string | null>(null);

  // Add-to-SFT-Dataset modal state
  const [addToDatasetItems, setAddToDatasetItems] = useState<AddToDatasetItem[]>([]);
  const [addToDatasetTitle, setAddToDatasetTitle] = useState('Add to SFT Dataset');
  const [addToDatasetDefaults, setAddToDatasetDefaults] = useState<{
    instruction?: string;
    systemMessage?: string;
  }>({});
  const [showAddToDataset, setShowAddToDataset] = useState(false);

  // New test case form
  const [caseName, setCaseName] = useState('');
  const [caseInput, setCaseInput] = useState('');
  const [caseExpected, setCaseExpected] = useState('');
  const [caseType, setCaseType] = useState('generative');
  const [caseTags, setCaseTags] = useState('');
  const [caseNotes, setCaseNotes] = useState('');
  const [caseIsGolden, setCaseIsGolden] = useState(false);

  // New backtest run form
  const [runName, setRunName] = useState('');
  const [runPromptVersionId, setRunPromptVersionId] = useState('');
  const [runModelConfigId, setRunModelConfigId] = useState('');
  const [runPassThreshold, setRunPassThreshold] = useState(0.5);
  const [runJudgeModelId, setRunJudgeModelId] = useState('');

  useEffect(() => {
    fetchPrompts(projectId);
    fetchModels();
    loadData();
  }, [projectId]);

  async function loadData() {
    try {
      const [cases, runs] = await Promise.all([
        postTrainingApi.listTestCases(projectId),
        postTrainingApi.listBacktestRuns(projectId),
      ]);
      setTestCases(cases);
      setBacktestRuns(runs);
    } catch {
      // silently fail
    }
  }

  async function handleCreateCase() {
    if (!caseName.trim() || !caseInput.trim() || !caseExpected.trim()) return;
    setLoading(true);
    try {
      await postTrainingApi.createTestCase(projectId, {
        name: caseName,
        input_text: caseInput,
        expected_output: caseExpected,
        expected_type: caseType,
        tags: caseTags || undefined,
        notes: caseNotes || undefined,
        is_golden: caseIsGolden,
      });
      setCaseName('');
      setCaseInput('');
      setCaseExpected('');
      setCaseTags('');
      setCaseNotes('');
      setCaseIsGolden(false);
      setShowCaseForm(false);
      await loadData();
    } catch {
      // silently fail
    }
    setLoading(false);
  }

  async function handleDeleteCase(id: string) {
    if (!confirm('Delete this test case? This cannot be undone.')) return;
    try {
      await postTrainingApi.deleteTestCase(projectId, id);
      setTestCases((prev) => prev.filter((t) => t.id !== id));
      setSelectedCaseIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (expandedCaseId === id) setExpandedCaseId(null);
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    }
  }

  function toggleCaseSelected(id: string) {
    setSelectedCaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllCases() {
    setSelectedCaseIds((prev) =>
      prev.size === testCases.length ? new Set() : new Set(testCases.map((t) => t.id)),
    );
  }

  async function handleBulkDeleteCases() {
    const ids = Array.from(selectedCaseIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} test case${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    try {
      await postTrainingApi.bulkDeleteTestCases(projectId, ids);
      const idSet = new Set(ids);
      setTestCases((prev) => prev.filter((t) => !idSet.has(t.id)));
      setSelectedCaseIds(new Set());
      if (expandedCaseId && idSet.has(expandedCaseId)) setExpandedCaseId(null);
    } catch (e) {
      alert(`Bulk delete failed: ${(e as Error).message}`);
    }
  }

  /**
   * Trigger PII masking on every test case with `pii_status='unchecked'`.
   * The backend kicks off a background task; we poll `loadData` a few times
   * so the user sees status badges flip from "unchecked" → "masked"/"clean"
   * without having to refresh manually.
   */
  async function handleMaskPii() {
    try {
      const r = await postTrainingApi.maskTestCasesPii(projectId);
      if (r.queued_count === 0) {
        alert('All test cases are already PII-checked.');
        return;
      }
      alert(`PII masking started for ${r.queued_count} test case(s). Status will update as items are processed.`);
      // Poll for progress every 3s for up to 60s
      let ticks = 0;
      const maxTicks = 20;
      const interval = setInterval(async () => {
        ticks += 1;
        try {
          await loadData();
        } catch {
          /* ignore — keep polling */
        }
        const stillUnchecked = (
          await postTrainingApi.listTestCases(projectId).catch(() => [])
        ).filter((t) => t.pii_status === 'unchecked').length;
        if (stillUnchecked === 0 || ticks >= maxTicks) {
          clearInterval(interval);
        }
      }, 3000);
    } catch (e) {
      alert(`Mask PII failed: ${(e as Error).message}`);
    }
  }

  async function copyInputToClipboard(tc: TestCase) {
    try {
      await navigator.clipboard.writeText(tc.input_text);
      setCopiedCaseId(tc.id);
      setTimeout(() => {
        setCopiedCaseId((prev) => (prev === tc.id ? null : prev));
      }, 1500);
    } catch (e) {
      alert(`Copy failed: ${(e as Error).message}`);
    }
  }

  /**
   * Export the current backtest run's results to an Excel (.xlsx) file.
   * Columns: Case name | PII data | Asserts | Output
   *
   * - "PII data" is the masked input text from the source dataset item
   *   (TestCaseResponse.input_text is already PII-safe at the API boundary).
   * - "Output" is the raw model output as text (no JSON pretty-printing —
   *   what the model produced, verbatim).
   */
  function handleExportBacktestXlsx() {
    if (!selectedRun) return;

    const headers = ['Case name', 'PII data', 'Asserts', 'Output'];

    const rows: (string | number | null)[][] = selectedRun.results.map((r) => {
      const tc = r.test_case;
      const assertionsStr = tc?.assertions
        ? parseAssertions(tc.assertions).map(formatAssertion).join(' ; ')
        : '';
      return [
        tc?.name ?? r.test_case_id.slice(0, 8),
        tc?.input_text ?? '',
        assertionsStr,
        r.actual_output ?? '',
      ];
    });

    const safeName = selectedRun.name.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60);
    const date = new Date().toISOString().slice(0, 10);
    downloadXlsx(
      `backtest-${safeName}-${date}.xlsx`,
      'Results',
      headers,
      rows,
    );
  }

  /**
   * Jump to a test case from the backtest results modal: close the modal,
   * expand the case, and scroll it into view.
   */
  function jumpToTestCase(testCaseId: string) {
    setSelectedRun(null);
    setExpandedCaseId(testCaseId);
    // Defer scroll so React has time to expand the card. Use block:'start' so the
    // title is visible — expanded cards can be tall enough that 'center' pushes
    // the title above the viewport.
    setTimeout(() => {
      const el = document.getElementById(`test-case-${testCaseId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  }

  /** Open the Add-to-SFT modal pre-loaded with the given test cases. */
  function openAddTestCasesToDataset(cases: TestCase[]) {
    if (cases.length === 0) return;
    const items: AddToDatasetItem[] = cases.map((tc) => ({
      input_text: tc.input_text,
      output_text: tc.expected_output,
      label: tc.name,
    }));
    setAddToDatasetItems(items);
    setAddToDatasetTitle(
      cases.length === 1
        ? `Add Test Case "${cases[0].name}" to SFT Dataset`
        : `Add ${cases.length} Test Cases to SFT Dataset`,
    );
    setAddToDatasetDefaults({});
    setShowAddToDataset(true);
  }

  /**
   * Open the Add-to-SFT modal pre-loaded with a backtest result.
   * `useExpected` chooses which output becomes the SFT target:
   *   - true  → expected_output (typical: lock in the desired answer)
   *   - false → actual_output   (distillation: capture teacher model's output)
   */
  function openAddBacktestResultToDataset(
    result: BacktestResult,
    useExpected: boolean,
  ) {
    const inputText = result.test_case?.input_text ?? '';
    const outputText = useExpected
      ? result.test_case?.expected_output ?? ''
      : result.actual_output ?? '';

    if (!outputText) {
      alert(
        useExpected
          ? 'No expected output available for this test case.'
          : 'No actual output available — the run may still be in progress.',
      );
      return;
    }

    // Pre-fill instruction/system_message from the backtest run's prompt version
    let defaultInstruction = '';
    let defaultSystemMessage = '';
    if (selectedRun) {
      for (const p of prompts) {
        const v = p.versions.find((v) => v.id === selectedRun.prompt_version_id);
        if (v) {
          defaultInstruction = v.content || '';
          defaultSystemMessage = v.system_message || '';
          break;
        }
      }
    }

    setAddToDatasetItems([
      {
        input_text: inputText,
        output_text: outputText,
        label: `${result.test_case?.name ?? result.test_case_id.slice(0, 8)} — ${
          useExpected ? 'expected' : 'actual'
        } output`,
      },
    ]);
    setAddToDatasetTitle(
      useExpected
        ? 'Add Backtest Result (Expected Output) to SFT Dataset'
        : 'Add Backtest Result (Actual Output) to SFT Dataset',
    );
    setAddToDatasetDefaults({
      instruction: defaultInstruction,
      systemMessage: defaultSystemMessage,
    });
    setShowAddToDataset(true);
  }

  async function saveAssertions(
    tcId: string,
    assertions: AssertionSpec[],
    passThreshold: number | null,
  ) {
    try {
      const updated = await postTrainingApi.updateTestCase(projectId, tcId, {
        assertions,
        pass_threshold: passThreshold,
      });
      setTestCases((prev) => prev.map((t) => (t.id === tcId ? updated : t)));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  /**
   * Click-to-toggle an assertion from the expected-output tree.
   * If the path is already asserted, remove it (and all variants at the same path).
   * Otherwise, append the auto-inferred spec.
   */
  async function toggleAssertion(tc: TestCase, incoming: AssertionSpec) {
    const current = parseAssertions(tc.assertions);
    const alreadyAsserted = current.some((a) => a.path === incoming.path);
    const next = alreadyAsserted
      ? current.filter((a) => a.path !== incoming.path)
      : [...current, incoming];
    await saveAssertions(tc.id, next, tc.pass_threshold);
  }

  async function handleDeleteRun(id: string) {
    if (!confirm('Delete this backtest run and all its results?')) return;
    try {
      await postTrainingApi.deleteBacktestRun(projectId, id);
      setBacktestRuns((prev) => prev.filter((r) => r.id !== id));
      if (selectedRun?.id === id) setSelectedRun(null);
    } catch {
      // silently fail
    }
  }

  /**
   * One-click re-run: clones the existing run's parameters (prompt + model +
   * threshold + judge) so the user doesn't have to refill the form. Auto-names
   * the new run "<original> (rerun N)" so successive clicks produce distinct
   * names instead of colliding.
   */
  async function handleRerun(run: BacktestRun) {
    setLoading(true);
    try {
      // Strip any existing "(rerun N)" suffix so we don't end up with
      // "Foo (rerun 1) (rerun 1)".
      const baseName = run.name.replace(/\s*\(rerun\s*\d*\)\s*$/, '');
      const existingRerunCount = backtestRuns.filter((r) =>
        r.name.startsWith(baseName + ' (rerun'),
      ).length;
      const newName = `${baseName} (rerun ${existingRerunCount + 1})`;

      await postTrainingApi.createBacktestRun(projectId, {
        name: newName,
        prompt_version_id: run.prompt_version_id,
        model_config_id: run.model_config_id,
        pass_threshold: run.pass_threshold,
        judge_model_config_id: run.judge_model_config_id || undefined,
      });
      await loadData();
    } catch (e) {
      alert(`Re-run failed: ${(e as Error).message}`);
    }
    setLoading(false);
  }

  async function handleCreateRun() {
    if (!runName.trim() || !runPromptVersionId || !runModelConfigId) return;
    setLoading(true);
    try {
      await postTrainingApi.createBacktestRun(projectId, {
        name: runName,
        prompt_version_id: runPromptVersionId,
        model_config_id: runModelConfigId,
        pass_threshold: runPassThreshold,
        judge_model_config_id: runJudgeModelId || undefined,
      });
      setRunName('');
      setRunPromptVersionId('');
      setRunModelConfigId('');
      setRunPassThreshold(0.5);
      setShowRunModal(false);
      await loadData();
    } catch (e) {
      alert(`Failed to create backtest: ${(e as Error).message}`);
    }
    setLoading(false);
  }

  async function handleViewRun(run: BacktestRun) {
    setLoading(true);
    try {
      const full = await postTrainingApi.getBacktestRun(projectId, run.id);
      setSelectedRun(full);
    } catch {
      // silently fail
    }
    setLoading(false);
  }

  const allPromptVersions = prompts.flatMap((p) =>
    p.versions.map((v) => ({ ...v, promptName: p.name })),
  );

  return (
    <Layout>
      {/* ── Left: Test Cases ── */}
      <Panel>
        <PanelHeader>
          <PanelTitle>Test Cases ({testCases.length})</PanelTitle>
          <Row style={{ gap: 8 }}>
            {testCases.length > 0 && (
              <CheckboxRow style={{ marginRight: 4 }}>
                <input
                  type="checkbox"
                  checked={selectedCaseIds.size > 0 && selectedCaseIds.size === testCases.length}
                  ref={(el) => {
                    if (el)
                      el.indeterminate =
                        selectedCaseIds.size > 0 && selectedCaseIds.size < testCases.length;
                  }}
                  onChange={toggleSelectAllCases}
                />
                Select all
              </CheckboxRow>
            )}
            {selectedCaseIds.size > 0 && (
              <>
                <Button
                  size="sm"
                  onClick={() =>
                    openAddTestCasesToDataset(
                      testCases.filter((t) => selectedCaseIds.has(t.id)),
                    )
                  }
                >
                  + Add to SFT ({selectedCaseIds.size})
                </Button>
                <Button size="sm" variant="danger" onClick={handleBulkDeleteCases}>
                  Delete ({selectedCaseIds.size})
                </Button>
              </>
            )}
            {testCases.length > 0 && testCases.some((t) => t.pii_status === 'unchecked') && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleMaskPii}
                title="Run PII detection on every unchecked test case"
              >
                Mask PII (
                {testCases.filter((t) => t.pii_status === 'unchecked').length}
                )
              </Button>
            )}
            <Button size="sm" onClick={() => setShowCaseForm((v) => !v)}>
              {showCaseForm ? 'Cancel' : '+ New Case'}
            </Button>
          </Row>
        </PanelHeader>
        <PanelBody>
          {showCaseForm && (
            <Card $selected>
              <FormGroup>
                <Label>Name</Label>
                <Input value={caseName} onChange={(e) => setCaseName(e.target.value)} placeholder="Test case name" />
              </FormGroup>
              <FormGroup>
                <Label>Type</Label>
                <Select value={caseType} onChange={(e) => setCaseType(e.target.value)}>
                  <option value="generative">Generative</option>
                  <option value="classification">Classification</option>
                  <option value="extraction">Extraction</option>
                  <option value="structured">Structured</option>
                </Select>
              </FormGroup>
              <FormGroup>
                <Label>Input Text</Label>
                <Textarea
                  value={caseInput}
                  onChange={(e) => setCaseInput(e.target.value)}
                  placeholder="What does this code do?"
                />
              </FormGroup>
              <FormGroup>
                <Label>Expected Output</Label>
                <Textarea
                  value={caseExpected}
                  onChange={(e) => setCaseExpected(e.target.value)}
                  placeholder="The expected response..."
                />
              </FormGroup>
              <FormGroup>
                <Label>Tags (comma-separated)</Label>
                <Input value={caseTags} onChange={(e) => setCaseTags(e.target.value)} placeholder="tag1,tag2" />
              </FormGroup>
              <FormGroup>
                <Label>Notes</Label>
                <Input value={caseNotes} onChange={(e) => setCaseNotes(e.target.value)} placeholder="Optional notes" />
              </FormGroup>
              <CheckboxRow>
                <input
                  type="checkbox"
                  checked={caseIsGolden}
                  onChange={(e) => setCaseIsGolden(e.target.checked)}
                />
                Golden test case
              </CheckboxRow>
              <Button size="sm" style={{ marginTop: 10 }} disabled={loading || !caseName.trim() || !caseInput.trim() || !caseExpected.trim()} onClick={handleCreateCase}>
                Create Test Case
              </Button>
            </Card>
          )}

          {testCases.length === 0 && !showCaseForm && (
            <EmptyState>No test cases yet. Create one to get started.</EmptyState>
          )}

          {testCases.map((tc) => {
            const isExpanded = expandedCaseId === tc.id;
            return (
              <Card
                key={tc.id}
                id={`test-case-${tc.id}`}
                $selected={isExpanded}
                onClick={() => setExpandedCaseId(isExpanded ? null : tc.id)}
              >
                <Row style={{ justifyContent: 'space-between', marginBottom: 2 }}>
                  <CardTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={selectedCaseIds.has(tc.id)}
                      onChange={() => toggleCaseSelected(tc.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span style={{ marginRight: 6, fontSize: '0.7rem', opacity: 0.5 }}>
                      {isExpanded ? '▼' : '▶'}
                    </span>
                    {tc.name}
                  </CardTitle>
                  <Row style={{ gap: 6 }}>
                    {tc.is_golden && <Badge color="warning">Golden</Badge>}
                    <Badge color="secondary">{tc.expected_type}</Badge>
                    {tc.pii_status === 'masked' && (
                      <Badge
                        color="success"
                        title="PII detected and masked"
                        style={{ padding: '1px 6px', fontSize: '0.6rem', letterSpacing: '0.3px' }}
                      >
                        PII masked
                      </Badge>
                    )}
                    {tc.pii_status === 'clean' && (
                      <Badge
                        color="success"
                        title="PII check ran, no PII detected"
                        style={{ padding: '1px 6px', fontSize: '0.6rem', letterSpacing: '0.3px' }}
                      >
                        PII clean
                      </Badge>
                    )}
                    {tc.pii_status === 'unchecked' && (
                      <Badge
                        color="warning"
                        title="PII detection has not been run on this test case"
                        style={{ padding: '1px 6px', fontSize: '0.6rem', letterSpacing: '0.3px' }}
                      >
                        PII unchecked
                      </Badge>
                    )}
                    {parseAssertions(tc.assertions).length > 0 && (
                      <Badge color="primary">{parseAssertions(tc.assertions).length} assertions</Badge>
                    )}
                  </Row>
                </Row>
                {tc.tags && (
                  <CardMeta style={{ marginBottom: 2 }}>
                    {tc.tags.split(',').map((t) => t.trim()).join(' · ')}
                  </CardMeta>
                )}
                {!isExpanded && (
                  <CardMeta style={{ color: tokens.colors.text.primary, marginTop: 2 }}>
                    {tc.input_text.slice(0, 80)}
                    {tc.input_text.length > 80 ? '...' : ''}
                  </CardMeta>
                )}

                {isExpanded && (
                  <DetailSection onClick={(e) => e.stopPropagation()}>
                    <DetailRow>
                      <DetailField>
                        <DetailFieldHeader>
                          <DetailLabel>Input Text</DetailLabel>
                          <CopyButton
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyInputToClipboard(tc);
                            }}
                            title="Copy input text to clipboard"
                          >
                            {copiedCaseId === tc.id ? '✓ Copied' : 'Copy'}
                          </CopyButton>
                        </DetailFieldHeader>
                        <DetailValue>{tc.input_text}</DetailValue>
                      </DetailField>
                      <DetailField>
                        <DetailLabel>Expected Output</DetailLabel>
                        <DetailValue>{tc.expected_output}</DetailValue>
                      </DetailField>
                    </DetailRow>
                    {tc.notes && (
                      <DetailField>
                        <DetailLabel>Notes</DetailLabel>
                        <DetailValue style={{ background: 'transparent', border: 'none', padding: '0', maxHeight: 'none', fontSize: '0.8rem' }}>
                          {tc.notes}
                        </DetailValue>
                      </DetailField>
                    )}
                    <ExpectedOutputPicker
                      expectedOutput={tc.expected_output}
                      assertions={parseAssertions(tc.assertions)}
                      onToggle={(spec) => toggleAssertion(tc, spec)}
                    />

                    <AssertionsEditor
                      assertions={parseAssertions(tc.assertions)}
                      onChange={(next) => saveAssertions(tc.id, next, tc.pass_threshold)}
                      passThreshold={tc.pass_threshold ?? null}
                      onThresholdChange={(v) => saveAssertions(tc.id, parseAssertions(tc.assertions), v)}
                    />

                    <CardMeta>
                      Created: {new Date(tc.created_at).toLocaleString()}
                      {tc.updated_at && tc.updated_at !== tc.created_at && (
                        <> · Updated: {new Date(tc.updated_at).toLocaleString()}</>
                      )}
                    </CardMeta>
                    <DetailActions>
                      <Button
                        size="sm"
                        onClick={() => openAddTestCasesToDataset([tc])}
                        style={{ fontSize: '0.75rem' }}
                      >
                        + Add to SFT Dataset
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleDeleteCase(tc.id)}
                        style={{ fontSize: '0.75rem' }}
                      >
                        Delete
                      </Button>
                    </DetailActions>
                  </DetailSection>
                )}
              </Card>
            );
          })}
        </PanelBody>
      </Panel>

      {/* ── Right: Backtest Runs ── */}
      <Panel>
        <PanelHeader>
          <PanelTitle>Backtest Runs</PanelTitle>
          <Row>
            <Button size="sm" variant="ghost" onClick={loadData}>Refresh</Button>
            <Button size="sm" onClick={() => setShowRunModal(true)} disabled={testCases.length === 0}>
              Run Backtest
            </Button>
          </Row>
        </PanelHeader>
        <PanelBody>
          {backtestRuns.length === 0 && (
            <EmptyState>No backtest runs yet. Create test cases and run a backtest.</EmptyState>
          )}
          {backtestRuns.map((run) => (
            <Card key={run.id} onClick={() => handleViewRun(run)} style={{ cursor: 'pointer' }}>
              <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <CardTitle>{run.name}</CardTitle>
                <Row style={{ gap: 6 }}>
                  <Badge color={getRunBadgeColor(run.status)}>{run.status}</Badge>
                  {run.status === 'completed' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); handleRerun(run); }}
                      disabled={loading}
                      title="Re-run with the same prompt, model, and test cases"
                      style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                    >
                      ↻ Re-run
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); handleDeleteRun(run.id); }}
                    style={{ padding: '2px 6px', color: tokens.colors.accent.error, fontSize: '0.75rem' }}
                  >
                    ✕
                  </Button>
                </Row>
              </Row>
              <Row style={{ gap: tokens.spacing.md }}>
                {run.pass_rate != null && (
                  <PassRate $rate={run.pass_rate}>
                    {(run.pass_rate * 100).toFixed(0)}% pass
                  </PassRate>
                )}
                <CardMeta>
                  {run.passed_cases} passed · {run.failed_cases} failed · {run.total_cases} total
                  {run.pass_threshold != null && ` · threshold ${(run.pass_threshold * 100).toFixed(0)}%`}
                </CardMeta>
              </Row>
            </Card>
          ))}
        </PanelBody>
      </Panel>

      {/* ── Run Backtest Modal ── */}
      {showRunModal && (
        <ModalOverlay onClick={() => setShowRunModal(false)}>
          <Modal style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>Run Backtest</ModalTitle>
              <Button size="sm" variant="ghost" onClick={() => setShowRunModal(false)}>Close</Button>
            </ModalHeader>
            <ModalBody>
              <FormGroup>
                <Label>Run Name</Label>
                <Input value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="Backtest v1" />
              </FormGroup>
              <FormGroup>
                <Label>Prompt Version</Label>
                <Select value={runPromptVersionId} onChange={(e) => setRunPromptVersionId(e.target.value)}>
                  <option value="">Select...</option>
                  {allPromptVersions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.promptName} v{v.version_number}{v.label ? ` (${v.label})` : ''}
                    </option>
                  ))}
                </Select>
              </FormGroup>
              <FormGroup>
                <Label>Model Config</Label>
                <Select value={runModelConfigId} onChange={(e) => setRunModelConfigId(e.target.value)}>
                  <option value="">Select...</option>
                  {models.filter((m) => m.is_enabled).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.provider})
                    </option>
                  ))}
                </Select>
              </FormGroup>
              <FormGroup>
                <Label>Pass Threshold: {(runPassThreshold * 100).toFixed(0)}%</Label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={runPassThreshold * 100}
                    onChange={(e) => setRunPassThreshold(Number(e.target.value) / 100)}
                    style={{ flex: 1, accentColor: tokens.colors.accent.primary }}
                  />
                  <span style={{
                    fontFamily: tokens.fonts.mono,
                    fontSize: '0.8rem',
                    color: tokens.colors.text.secondary,
                    minWidth: 40,
                    textAlign: 'right',
                  }}>
                    {(runPassThreshold * 100).toFixed(0)}%
                  </span>
                </div>
                <CardMeta style={{ marginTop: 2 }}>
                  Minimum similarity score for a test case to pass. Lower values are more lenient for generative tasks.
                </CardMeta>
              </FormGroup>
              <FormGroup>
                <Label>LLM Judge (optional)</Label>
                <Select value={runJudgeModelId} onChange={(e) => setRunJudgeModelId(e.target.value)}>
                  <option value="">— use string similarity (default) —</option>
                  {models.filter((m) => m.is_enabled).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.provider})
                    </option>
                  ))}
                </Select>
                <CardMeta style={{ marginTop: 2 }}>
                  When set, this model grades each result on a 0.0–1.0 scale by comparing
                  semantic equivalence — much more accurate than string matching for
                  generative tasks. Uses Claude/GPT-4 well.
                </CardMeta>
              </FormGroup>
              <CardMeta style={{ marginBottom: tokens.spacing.md }}>
                Will run against all {testCases.length} test cases.
              </CardMeta>
              <Button
                disabled={loading || !runName.trim() || !runPromptVersionId || !runModelConfigId}
                onClick={handleCreateRun}
              >
                Start Backtest
              </Button>
            </ModalBody>
          </Modal>
        </ModalOverlay>
      )}

      {/* ── Run Results Modal ── */}
      {selectedRun && (
        <ModalOverlay onClick={() => setSelectedRun(null)}>
          <Modal onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>{selectedRun.name}</ModalTitle>
              <Row>
                <Badge color={getRunBadgeColor(selectedRun.status)}>{selectedRun.status}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleExportBacktestXlsx}
                  disabled={selectedRun.results.length === 0}
                  title="Export results as Excel (.xlsx)"
                >
                  Export Excel
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedRun(null)}>Close</Button>
              </Row>
            </ModalHeader>
            <ModalBody>
              {/* Summary */}
              <SummaryRow>
                <SummaryCard>
                  <SummaryValue style={{ color: selectedRun.pass_rate != null ? (selectedRun.pass_rate >= 0.8 ? tokens.colors.accent.success : selectedRun.pass_rate >= 0.5 ? tokens.colors.accent.warning : tokens.colors.accent.error) : tokens.colors.text.muted }}>
                    {selectedRun.pass_rate != null ? `${(selectedRun.pass_rate * 100).toFixed(1)}%` : '—'}
                  </SummaryValue>
                  <SummaryLabel>Pass Rate</SummaryLabel>
                </SummaryCard>
                <SummaryCard>
                  <SummaryValue style={{ color: tokens.colors.accent.success }}>{selectedRun.passed_cases}</SummaryValue>
                  <SummaryLabel>Passed</SummaryLabel>
                </SummaryCard>
                <SummaryCard>
                  <SummaryValue style={{ color: tokens.colors.accent.error }}>{selectedRun.failed_cases}</SummaryValue>
                  <SummaryLabel>Failed</SummaryLabel>
                </SummaryCard>
                <SummaryCard>
                  <SummaryValue>{selectedRun.total_cases}</SummaryValue>
                  <SummaryLabel>Total Cases</SummaryLabel>
                </SummaryCard>
              </SummaryRow>

              {/* Results Table */}
              <ResultTable>
                <thead>
                  <tr>
                    <Th>Test Case</Th>
                    <Th>Status</Th>
                    <Th>Score</Th>
                    <Th>Latency</Th>
                    <Th>Details</Th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRun.results.map((r) => (
                    <React.Fragment key={r.id}>
                      <tr>
                        <Td>
                          {r.test_case ? (
                            <TestCaseLink
                              type="button"
                              onClick={() => jumpToTestCase(r.test_case!.id)}
                              title="Open this test case"
                            >
                              {r.test_case.name}
                            </TestCaseLink>
                          ) : (
                            <span style={{ color: tokens.colors.text.muted }}>
                              {r.test_case_id.slice(0, 8)} (deleted)
                            </span>
                          )}
                        </Td>
                        <Td>
                          <Badge color={getStatusColor(r.status)}>{r.status}</Badge>
                        </Td>
                        <Td>
                          {r.pass_score != null ? (
                            <span style={{ fontFamily: tokens.fonts.mono, color: r.pass_score >= 0.7 ? tokens.colors.accent.success : tokens.colors.accent.error }}>
                              {(r.pass_score * 100).toFixed(0)}%
                            </span>
                          ) : '—'}
                        </Td>
                        <Td>
                          {r.latency_ms != null ? (
                            <span style={{ fontFamily: tokens.fonts.mono, fontSize: '0.75rem' }}>
                              {r.latency_ms}ms
                            </span>
                          ) : '—'}
                        </Td>
                        <Td>
                          <Button
                            size="sm"
                            variant="ghost"
                            style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                            onClick={() => setExpandedResultId(expandedResultId === r.id ? null : r.id)}
                          >
                            {expandedResultId === r.id ? 'Hide' : 'Diff'}
                          </Button>
                        </Td>
                      </tr>
                      {expandedResultId === r.id && (
                        <tr>
                          <Td colSpan={5}>
                            {r.error_message && (
                              <div style={{ color: tokens.colors.accent.error, fontFamily: tokens.fonts.mono, fontSize: '0.75rem', marginBottom: 8 }}>
                                Error: {r.error_message}
                              </div>
                            )}
                            <DiffSection>
                              <div>
                                <DiffLabel>Expected</DiffLabel>
                                <DiffBox $type="expected">
                                  {r.test_case?.expected_output ?? '—'}
                                </DiffBox>
                                {r.test_case?.expected_output && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => openAddBacktestResultToDataset(r, true)}
                                    style={{ marginTop: 6, fontSize: '0.72rem' }}
                                  >
                                    + Add Expected to SFT
                                  </Button>
                                )}
                              </div>
                              <div>
                                <DiffLabel>Actual</DiffLabel>
                                <DiffBox $type="actual">
                                  {r.actual_output ?? '(no output)'}
                                </DiffBox>
                                {r.actual_output && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => openAddBacktestResultToDataset(r, false)}
                                    style={{ marginTop: 6, fontSize: '0.72rem' }}
                                  >
                                    + Add Actual to SFT (distill)
                                  </Button>
                                )}
                              </div>
                            </DiffSection>
                          </Td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </ResultTable>

              {selectedRun.results.length === 0 && (
                <EmptyState>No results yet. Run is still in progress.</EmptyState>
              )}
            </ModalBody>
          </Modal>
        </ModalOverlay>
      )}

      <AddToDatasetModal
        open={showAddToDataset}
        onClose={() => setShowAddToDataset(false)}
        projectId={projectId}
        items={addToDatasetItems}
        title={addToDatasetTitle}
        defaultInstruction={addToDatasetDefaults.instruction}
        defaultSystemMessage={addToDatasetDefaults.systemMessage}
      />
    </Layout>
  );
}
