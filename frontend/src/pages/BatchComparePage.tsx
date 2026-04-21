/**
 * Batch Compare: run the same prompt across N models over M test cases and
 * display the results in a matrix: rows = test cases, columns = models.
 *
 * Each cell shows the aggregate score bar; expanding a cell reveals per-assertion
 * results.  Column headers show per-model pass rate and mean score.
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
import { knowledgeBaseApi } from '../api/knowledgeBase';
import { useProjectStore } from '../stores/projectStore';
import { usePromptStore } from '../stores/promptStore';
import { useModelStore } from '../stores/modelStore';
import type {
  AssertionResult,
  BacktestResult,
  BacktestRun,
  ComparisonRun,
  ComparisonRunWithChildren,
  KnowledgeBase,
  KnowledgeBaseItem,
  TestCase,
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

const Td = styled.td<{ $pass?: boolean; $fail?: boolean }>`
  padding: 10px 12px;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  vertical-align: top;
  background: ${({ $pass, $fail }) =>
    $pass ? 'rgba(0, 230, 118, 0.04)'
    : $fail ? 'rgba(255, 82, 82, 0.04)'
    : 'transparent'};
`;

const ScoreBar = styled.div<{ $score: number }>`
  height: 6px;
  border-radius: 100px;
  background: linear-gradient(
    to right,
    ${({ $score }) =>
      $score >= 0.8 ? tokens.colors.accent.success
      : $score >= 0.5 ? tokens.colors.accent.warning
      : tokens.colors.accent.error
    } ${({ $score }) => `${Math.round($score * 100)}%`},
    ${tokens.colors.bg.tertiary} ${({ $score }) => `${Math.round($score * 100)}%`}
  );
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

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function scoreColorVariant(score: number | null): 'success' | 'warning' | 'error' | 'secondary' {
  if (score === null) return 'secondary';
  if (score >= 0.8) return 'success';
  if (score >= 0.5) return 'warning';
  return 'error';
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
  const [showOnlyDisagree, setShowOnlyDisagree] = useState(false);
  const [showOnlyFailures, setShowOnlyFailures] = useState(false);
  const [activeAssertion, setActiveAssertion] = useState<string>('');

  // New-comparison form
  const [name, setName] = useState('');
  const [promptVersionId, setPromptVersionId] = useState('');
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [judgeModelId, setJudgeModelId] = useState('');

  // Knowledge Base picker state
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string>('');
  const [kbItems, setKbItems] = useState<KnowledgeBaseItem[]>([]);
  const [selectedKbItemIds, setSelectedKbItemIds] = useState<Set<string>>(new Set());
  const [loadingKbItems, setLoadingKbItems] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    fetchProject(projectId);
    fetchPrompts(projectId);
    fetchModels();
    knowledgeBaseApi.list().then(setKbs).catch(() => setKbs([]));
    void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Fetch items when the selected KB changes
  useEffect(() => {
    if (!selectedKbId) {
      setKbItems([]);
      setSelectedKbItemIds(new Set());
      return;
    }
    setLoadingKbItems(true);
    knowledgeBaseApi.listItems(selectedKbId)
      .then(setKbItems)
      .catch(() => setKbItems([]))
      .finally(() => setLoadingKbItems(false));
    setSelectedKbItemIds(new Set());
  }, [selectedKbId]);

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
        if (d.status === 'running' || d.status === 'pending') {
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
    if (!projectId || !name.trim() || !promptVersionId || selectedModelIds.size < 2) return;
    if (selectedKbItemIds.size === 0) {
      alert('Pick at least one KB item to use as input for the comparison.');
      return;
    }
    try {
      const created = await postTrainingApi.createComparisonRun(projectId, {
        name: name.trim(),
        prompt_version_id: promptVersionId,
        model_config_ids: Array.from(selectedModelIds),
        knowledge_base_item_ids: Array.from(selectedKbItemIds),
        judge_model_config_id: judgeModelId || undefined,
      });
      setRuns((prev) => [created, ...prev]);
      setSelectedId(created.id);
      setShowModal(false);
      setName('');
      setSelectedModelIds(new Set());
      setSelectedKbId('');
      setSelectedKbItemIds(new Set());
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

  // Build the matrix data from detail
  const matrix = useMemo(() => buildMatrix(detail, models), [detail, models]);

  // Discover distinct assertion names (for the filter)
  const assertionNames = useMemo(() => {
    const names = new Set<string>();
    matrix.rows.forEach((row) => {
      row.cells.forEach((cell) => {
        if (!cell) return;
        const parsed = parseJson<AssertionResult[]>(cell.result.assertion_results || null, []);
        parsed.forEach((ar) => names.add(ar.name));
      });
    });
    return Array.from(names).sort();
  }, [matrix]);

  // Apply filters to rows
  const filteredRows = useMemo(() => {
    return matrix.rows.filter((row) => {
      const validCells = row.cells.filter(Boolean);
      if (validCells.length === 0) return false;

      if (showOnlyFailures) {
        // no_judgment doesn't count as a failure — only real failed/error
        if (!validCells.some((c) => c && (c.result.status === 'failed' || c.result.status === 'error'))) return false;
      }
      if (showOnlyDisagree) {
        // Only meaningful over judged cells. If all cells are no_judgment, skip.
        const judged = validCells.filter((c) => c && (c.result.status === 'passed' || c.result.status === 'failed'));
        if (judged.length < 2) return false;
        const outcomes = new Set(judged.map((c) => c!.result.status));
        if (outcomes.size < 2) return false;
      }
      return true;
    });
  }, [matrix, showOnlyFailures, showOnlyDisagree]);

  // Column-level aggregates
  const modelAggregates = useMemo(() => {
    return matrix.modelIds.map((mid, colIdx) => {
      const cells = matrix.rows.map((r) => r.cells[colIdx]).filter(Boolean) as CellData[];
      // Only cells with a real judgment count toward pass rate
      const judged = cells.filter((c) => c.result.status === 'passed' || c.result.status === 'failed');
      const passed = judged.filter((c) => c.result.status === 'passed').length;
      const scored = cells.filter((c) => c.result.pass_score !== null);
      const meanScore = scored.length === 0 ? null : scored.reduce((a, c) => a + (c.result.pass_score ?? 0), 0) / scored.length;
      const latencies = cells.filter((c) => c.result.latency_ms != null).map((c) => c.result.latency_ms!);
      const meanLatency = latencies.length === 0 ? null : latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const noJudgment = cells.length - judged.length;
      return {
        modelId: mid,
        passed,
        total: cells.length,
        judged: judged.length,
        noJudgment,
        passRate: judged.length === 0 ? null : passed / judged.length,
        meanScore,
        meanLatency,
      };
    });
  }, [matrix]);

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
              const modelIds = parseJson<string[]>(r.model_config_ids, []);
              return (
                <Card
                  key={r.id}
                  $active={selectedId === r.id}
                  onClick={() => setSelectedId(r.id)}
                >
                  <Row>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 500 }}>{r.name}</div>
                      <Muted>
                        {modelIds.length} models · <Badge color={
                          r.status === 'completed' ? 'success'
                          : r.status === 'failed' ? 'error'
                          : r.status === 'running' ? 'primary'
                          : 'secondary'
                        }>{r.status}</Badge>
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
          {selectedId && detail && matrix.rows.length === 0 && <Empty>No test cases or no results yet.</Empty>}
          {selectedId && detail && matrix.rows.length > 0 && (
            <>
              <FilterBar>
                <label>
                  <input
                    type="checkbox"
                    checked={showOnlyDisagree}
                    onChange={(e) => setShowOnlyDisagree(e.target.checked)}
                  /> Only rows where models disagree
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={showOnlyFailures}
                    onChange={(e) => setShowOnlyFailures(e.target.checked)}
                  /> Only rows with failures
                </label>
                {assertionNames.length > 0 && (
                  <label>
                    Focus assertion:{' '}
                    <select
                      value={activeAssertion}
                      onChange={(e) => setActiveAssertion(e.target.value)}
                      style={{
                        background: tokens.colors.bg.tertiary,
                        border: `1px solid ${tokens.colors.border.subtle}`,
                        color: tokens.colors.text.primary,
                        padding: '4px 8px',
                        borderRadius: 4,
                      }}
                    >
                      <option value="">— overall —</option>
                      {assertionNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}
                <div style={{ marginLeft: 'auto', color: tokens.colors.text.muted }}>
                  {filteredRows.length} / {matrix.rows.length} rows
                </div>
              </FilterBar>

              <Matrix>
                <thead>
                  <tr>
                    <Th style={{ minWidth: 200 }}>Test Case</Th>
                    {matrix.modelIds.map((mid, colIdx) => {
                      const m = models.find((x) => x.id === mid);
                      const agg = modelAggregates[colIdx];
                      return (
                        <Th key={mid} style={{ minWidth: 220 }}>
                          <div>{m?.name ?? mid.slice(0, 8)}</div>
                          <Muted>{m?.provider}</Muted>
                          {agg && agg.total > 0 && (
                            <div style={{ marginTop: 6 }}>
                              {agg.judged > 0 ? (
                                <Badge color={scoreColorVariant(agg.passRate ?? 0)}>
                                  {agg.passed}/{agg.judged} pass ({Math.round((agg.passRate ?? 0) * 100)}%)
                                </Badge>
                              ) : (
                                <Badge color="secondary">{agg.total} outputs · no scoring</Badge>
                              )}
                              {agg.noJudgment > 0 && agg.judged > 0 && (
                                <Muted>+{agg.noJudgment} unscored</Muted>
                              )}
                              {agg.meanScore !== null && (
                                <Muted>mean score: {agg.meanScore.toFixed(2)}</Muted>
                              )}
                              {agg.meanLatency !== null && (
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
                  {filteredRows.map((row) => (
                    <tr key={row.testCase.id}>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{row.testCase.name}</div>
                        {row.testCase.is_golden && <Badge color="warning">golden</Badge>}{' '}
                        <Badge color="secondary">{row.testCase.expected_type}</Badge>
                      </Td>
                      {row.cells.map((cell, colIdx) => {
                        const cellKey = `${row.testCase.id}:${matrix.modelIds[colIdx]}`;
                        const isExpanded = expandedCellKey === cellKey;
                        if (!cell) {
                          return <Td key={colIdx}><Muted>—</Muted></Td>;
                        }

                        const assertions = parseJson<AssertionResult[]>(cell.result.assertion_results || null, []);
                        const noJudgment = cell.result.status === 'no_judgment';
                        let displayScore = cell.result.pass_score ?? 0;
                        let displayPass = cell.result.status === 'passed';
                        if (activeAssertion) {
                          const ar = assertions.find((a) => a.name === activeAssertion);
                          displayScore = ar?.score ?? 0;
                          displayPass = ar?.passed ?? false;
                        }

                        return (
                          <Td
                            key={colIdx}
                            $pass={!noJudgment && displayPass && !activeAssertion}
                            $fail={!noJudgment && !displayPass && cell.result.status !== 'pending'}
                            onClick={() => setExpandedCellKey(isExpanded ? null : cellKey)}
                            style={{ cursor: 'pointer' }}
                          >
                            <Row>
                              {noJudgment ? (
                                <Badge color="secondary" title="No assertions and no expected_output — showing raw output only. Add assertions on the test case to get per-field scoring.">
                                  raw output
                                </Badge>
                              ) : (
                                <Badge color={displayPass ? 'success' : 'error'}>
                                  {Math.round(displayScore * 100)}%
                                </Badge>
                              )}
                              <div style={{ display: 'flex', gap: 4, fontSize: '0.7rem', color: tokens.colors.text.muted }}>
                                {cell.result.cache_hit && <span title="From cache">⚡</span>}
                                {cell.result.latency_ms != null && <span>{cell.result.latency_ms}ms</span>}
                              </div>
                            </Row>
                            {!noJudgment && <ScoreBar $score={displayScore} style={{ marginTop: 4 }} />}
                            {noJudgment && cell.result.actual_output && (
                              <Muted style={{
                                marginTop: 4,
                                fontFamily: tokens.fonts.mono,
                                color: tokens.colors.text.primary,
                                maxHeight: 60,
                                overflow: 'hidden',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}>
                                {cell.result.actual_output.slice(0, 180)}
                                {cell.result.actual_output.length > 180 && '…'}
                              </Muted>
                            )}

                            {isExpanded && (
                              <div style={{ marginTop: 8 }}>
                                {assertions.length > 0 ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {assertions.map((ar, i) => (
                                      <div key={i} style={{
                                        padding: '6px 8px',
                                        background: tokens.colors.bg.primary,
                                        borderRadius: 4,
                                        border: `1px solid ${tokens.colors.border.subtle}`,
                                        fontSize: '0.72rem',
                                      }}>
                                        <Row>
                                          <span>
                                            <Badge color={ar.passed ? 'success' : 'error'}>
                                              {Math.round(ar.score * 100)}%
                                            </Badge>
                                            {' '}<strong>{ar.name}</strong>
                                          </span>
                                          {ar.weight !== 1 && <Muted>w={ar.weight}</Muted>}
                                        </Row>
                                        {ar.path && <Muted>{ar.path}</Muted>}
                                        {ar.reasoning && (
                                          <div style={{ color: tokens.colors.text.secondary, marginTop: 2 }}>
                                            {ar.reasoning}
                                          </div>
                                        )}
                                        {(ar.actual_value !== null || ar.expected_value !== null) && (
                                          <div style={{ fontFamily: tokens.fonts.mono, fontSize: '0.68rem', color: tokens.colors.text.muted, marginTop: 2 }}>
                                            expected: {JSON.stringify(ar.expected_value)}<br />
                                            actual: {JSON.stringify(ar.actual_value)}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <pre style={{
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    background: tokens.colors.bg.primary,
                                    padding: 8,
                                    borderRadius: 4,
                                    maxHeight: 200,
                                    overflow: 'auto',
                                    fontSize: '0.7rem',
                                    margin: 0,
                                  }}>
                                    {cell.result.actual_output || '(no output)'}
                                  </pre>
                                )}
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
                <Label>Prompt Version</Label>
                <Select value={promptVersionId} onChange={(e) => setPromptVersionId(e.target.value)}>
                  <option value="">Select...</option>
                  {promptVersions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.promptName} v{v.version_number}{v.label ? ` (${v.label})` : ''}
                    </option>
                  ))}
                </Select>
              </FormGroup>

              <FormGroup>
                <Label>Models to compare (select 2 or more)</Label>
                <CheckList>
                  {enabledModels.map((m) => (
                    <CheckRow key={m.id}>
                      <input
                        type="checkbox"
                        checked={selectedModelIds.has(m.id)}
                        onChange={(e) => {
                          setSelectedModelIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(m.id); else next.delete(m.id);
                            return next;
                          });
                        }}
                      />
                      {m.name} <Muted>{m.provider}</Muted>
                    </CheckRow>
                  ))}
                </CheckList>
              </FormGroup>

              <FormGroup>
                <Label>Knowledge Base</Label>
                <Select value={selectedKbId} onChange={(e) => setSelectedKbId(e.target.value)}>
                  <option value="">— pick a knowledge base —</option>
                  {kbs.map((kb) => (
                    <option key={kb.id} value={kb.id}>
                      {kb.name} ({kb.item_count} items)
                    </option>
                  ))}
                </Select>
                <Muted style={{ marginTop: 4 }}>
                  Selected items become inputs for every model. First use auto-creates a test case
                  per item (found next time via source_kb_item_id — expected_output and assertions
                  stay empty until you add them in Post-Training → Backtesting).
                </Muted>
              </FormGroup>

              {selectedKbId && (
                <FormGroup>
                  <Label>KB items to include ({selectedKbItemIds.size})</Label>
                  {loadingKbItems ? (
                    <Muted>Loading items…</Muted>
                  ) : kbItems.length === 0 ? (
                    <Muted>This KB has no items yet.</Muted>
                  ) : (
                    <>
                      <Row style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedKbItemIds(new Set(kbItems.map((it) => it.id)))}
                        >
                          Select all
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedKbItemIds(new Set())}
                        >
                          Clear
                        </Button>
                      </Row>
                      <CheckList>
                        {kbItems.map((it) => (
                          <CheckRow key={it.id}>
                            <input
                              type="checkbox"
                              checked={selectedKbItemIds.has(it.id)}
                              onChange={(e) => {
                                setSelectedKbItemIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(it.id); else next.delete(it.id);
                                  return next;
                                });
                              }}
                            />
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {it.name}
                            </span>
                            <Badge color={
                              it.source_type === 'pdf' ? 'primary'
                              : it.source_type === 'csv_row' ? 'warning'
                              : 'secondary'
                            }>
                              {it.source_type}
                            </Badge>
                            <Muted>{it.content.length.toLocaleString()} ch</Muted>
                          </CheckRow>
                        ))}
                      </CheckList>
                    </>
                  )}
                </FormGroup>
              )}

              <FormGroup>
                <Label>LLM Judge Model (optional — used for llm_judge assertions)</Label>
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
                  || !promptVersionId
                  || selectedModelIds.size < 2
                  || selectedKbItemIds.size === 0
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

interface CellData {
  run: BacktestRun;
  result: BacktestResult;
}

interface MatrixRow {
  testCase: TestCase;
  cells: (CellData | null)[];
}

interface MatrixData {
  modelIds: string[];
  rows: MatrixRow[];
}

function buildMatrix(
  detail: ComparisonRunWithChildren | null,
  _models: unknown,
): MatrixData {
  if (!detail) return { modelIds: [], rows: [] };

  // Columns follow the order of the comparison run's declared model list
  let modelIds: string[] = [];
  try {
    modelIds = JSON.parse(detail.model_config_ids) as string[];
  } catch {
    modelIds = detail.children.map((c) => c.model_config_id);
  }

  // Gather a unified set of test-case ids across all children (preserve order of first child)
  const tcMap = new Map<string, TestCase>();
  for (const child of detail.children) {
    for (const res of child.results) {
      if (res.test_case && !tcMap.has(res.test_case.id)) {
        tcMap.set(res.test_case.id, res.test_case);
      }
    }
  }

  const rows: MatrixRow[] = Array.from(tcMap.values()).map((tc) => {
    const cells = modelIds.map((mid) => {
      const child = detail.children.find((c) => c.model_config_id === mid);
      if (!child) return null;
      const res = child.results.find((r) => r.test_case_id === tc.id);
      if (!res) return null;
      return { run: child, result: res };
    });
    return { testCase: tc, cells };
  });

  return { modelIds, rows };
}
