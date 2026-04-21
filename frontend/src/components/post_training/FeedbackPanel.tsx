import { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { postTrainingApi } from '../../api/postTraining';
import { knowledgeBaseApi } from '../../api/knowledgeBase';
import { usePromptStore } from '../../stores/promptStore';
import { useModelStore } from '../../stores/modelStore';
import type { FeedbackItem, FeedbackRun, KnowledgeBase, KnowledgeBaseItem } from '../../types';

interface Props {
  projectId: string;
}

// ─── Styled Components ────────────────────────────────────────────────────────

const Layout = styled.div`
  display: grid;
  grid-template-columns: 300px 1fr;
  height: 100%;
  overflow: hidden;
`;

const LeftPanel = styled.div`
  border-right: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const RightPanel = styled.div`
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const PanelHeader = styled.div`
  padding: ${tokens.spacing.md} ${tokens.spacing.md} ${tokens.spacing.sm};
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
  min-height: 80px;

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

const ProgressBar = styled.div<{ $percent: number }>`
  height: 4px;
  background: ${tokens.colors.bg.hover};
  border-radius: 2px;
  overflow: hidden;
  margin-top: 6px;

  &::after {
    content: '';
    display: block;
    height: 100%;
    width: ${({ $percent }) => $percent}%;
    background: ${tokens.colors.accent.primary};
    border-radius: 2px;
    transition: width 0.3s;
  }
`;

const ReviewArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${tokens.spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${tokens.spacing.md};
`;

const OutputBox = styled.div`
  background: ${tokens.colors.bg.primary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: ${tokens.spacing.md};
  font-family: ${tokens.fonts.body};
  font-size: 0.875rem;
  color: ${tokens.colors.text.primary};
  white-space: pre-wrap;
  line-height: 1.6;
  min-height: 80px;
`;

const StarRow = styled.div`
  display: flex;
  gap: 4px;
`;

const StarButton = styled.button<{ $filled: boolean }>`
  font-size: 1.2rem;
  background: none;
  border: none;
  cursor: pointer;
  color: ${({ $filled }) => ($filled ? tokens.colors.accent.warning : tokens.colors.text.muted)};
  transition: color 0.1s;

  &:hover { color: ${tokens.colors.accent.warning}; }
`;

const ThumbRow = styled.div`
  display: flex;
  gap: ${tokens.spacing.sm};
`;

const ThumbButton = styled.button<{ $active?: boolean; $variant: 'up' | 'down' }>`
  font-size: 1.1rem;
  padding: 6px 14px;
  border-radius: ${tokens.radii.sm};
  border: 1px solid ${({ $active, $variant }) =>
    $active
      ? $variant === 'up'
        ? tokens.colors.accent.success
        : tokens.colors.accent.error
      : tokens.colors.border.subtle};
  background: ${({ $active, $variant }) =>
    $active
      ? $variant === 'up'
        ? 'rgba(0, 230, 118, 0.1)'
        : 'rgba(255, 82, 82, 0.1)'
      : tokens.colors.bg.tertiary};
  color: ${tokens.colors.text.primary};
  cursor: pointer;
  transition: all 0.15s;
`;

const TagPill = styled.button<{ $active?: boolean }>`
  font-family: ${tokens.fonts.accent};
  font-size: 0.7rem;
  padding: 3px 10px;
  border-radius: 100px;
  border: 1px solid ${({ $active }) => ($active ? tokens.colors.accent.primary : tokens.colors.border.subtle)};
  background: ${({ $active }) => ($active ? 'rgba(108, 92, 231, 0.15)' : tokens.colors.bg.tertiary)};
  color: ${({ $active }) => ($active ? tokens.colors.accent.primary : tokens.colors.text.muted)};
  cursor: pointer;
  transition: all 0.15s;
`;

const TagRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const ProgressInfo = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 0.75rem;
  color: ${tokens.colors.text.muted};
  margin-top: 4px;
`;

const EmptyState = styled.div`
  color: ${tokens.colors.text.muted};
  font-family: ${tokens.fonts.body};
  font-size: 0.8rem;
  text-align: center;
  padding: ${tokens.spacing.lg};
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Row = styled.div`
  display: flex;
  gap: ${tokens.spacing.sm};
  align-items: center;
`;

const SectionLabel = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: ${tokens.colors.text.secondary};
  margin-bottom: 6px;
`;

const ReviewHeader = styled.div`
  padding: ${tokens.spacing.md} ${tokens.spacing.lg};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const ERROR_TAGS = [
  'hallucination',
  'formatting',
  'missing info',
  'wrong classification',
  'policy violation',
  'weak reasoning',
  'poor extraction',
];

function getFeedbackRunBadgeColor(status: string): 'primary' | 'success' | 'secondary' {
  if (status === 'completed') return 'success';
  if (status === 'collecting') return 'primary';
  return 'secondary';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FeedbackPanel({ projectId }: Props) {
  const { prompts, fetchPrompts } = usePromptStore();
  const { models, fetchModels } = useModelStore();

  const [runs, setRuns] = useState<FeedbackRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<(FeedbackRun & { items: FeedbackItem[] }) | null>(null);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Create form state
  const [runName, setRunName] = useState('');
  const [runDesc, setRunDesc] = useState('');
  const [promptVersionId, setPromptVersionId] = useState('');
  const [modelConfigId, setModelConfigId] = useState('');
  const [inputTexts, setInputTexts] = useState('');
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Knowledge-base import
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string>('');
  const [kbItems, setKbItems] = useState<KnowledgeBaseItem[]>([]);
  const [selectedKbItemIds, setSelectedKbItemIds] = useState<Set<string>>(new Set());
  const [loadingKbItems, setLoadingKbItems] = useState(false);

  // Review state
  const [rating, setRating] = useState<number | null>(null);
  const [thumbs, setThumbs] = useState<'up' | 'down' | null>(null);
  const [correctedOutput, setCorrectedOutput] = useState('');
  const [reviewerComment, setReviewerComment] = useState('');
  const [selectedErrorTags, setSelectedErrorTags] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchPrompts(projectId);
    fetchModels();
    loadRuns();
    knowledgeBaseApi.list().then(setKbs).catch(() => setKbs([]));
  }, [projectId]);

  useEffect(() => {
    if (!selectedKbId) { setKbItems([]); setSelectedKbItemIds(new Set()); return; }
    setLoadingKbItems(true);
    knowledgeBaseApi.listItems(selectedKbId)
      .then((items) => {
        setKbItems(items);
        setSelectedKbItemIds(new Set());
      })
      .catch(() => setKbItems([]))
      .finally(() => setLoadingKbItems(false));
  }, [selectedKbId]);

  const toggleKbItem = (id: string) => {
    setSelectedKbItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  async function loadRuns() {
    try {
      const data = await postTrainingApi.listFeedbackRuns(projectId);
      setRuns(data);
    } catch {
      // silently fail
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileStatus(`Parsing ${file.name}…`);
    try {
      const { inputs } = await postTrainingApi.parseFeedbackInputFile(projectId, file);
      if (!inputs || inputs.length === 0) {
        setFileStatus(`No inputs found in ${file.name}`);
      } else {
        setInputTexts((prev) => {
          const existing = prev.trim();
          const joined = inputs.join('\n');
          return existing ? `${existing}\n${joined}` : joined;
        });
        setFileStatus(`Loaded ${inputs.length} input${inputs.length !== 1 ? 's' : ''} from ${file.name}`);
      }
    } catch {
      setFileStatus(`Failed to parse ${file.name}`);
    }
    e.target.value = '';
  }

  async function handleCreateRun() {
    if (!runName.trim()) return;
    setLoading(true);
    try {
      const lines = inputTexts
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      // Include selected KB items as additional inputs (one per item)
      const kbInputs = kbItems
        .filter((it) => selectedKbItemIds.has(it.id))
        .map((it) => it.content);

      const allInputs = [...lines, ...kbInputs];

      const run = await postTrainingApi.createFeedbackRun(projectId, {
        name: runName,
        description: runDesc || undefined,
        prompt_version_id: promptVersionId || undefined,
        model_config_id: modelConfigId || undefined,
      });

      if (allInputs.length > 0) {
        await postTrainingApi.addFeedbackItems(
          projectId,
          run.id,
          allInputs.map((l) => ({ input_text: l })),
        );
      }

      setRunName('');
      setRunDesc('');
      setInputTexts('');
      setFileStatus(null);
      setSelectedKbId('');
      setSelectedKbItemIds(new Set());
      setShowCreateForm(false);
      await loadRuns();
    } catch {
      // silently fail
    }
    setLoading(false);
  }

  async function handleDeleteRun(run: FeedbackRun, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete feedback run "${run.name}" and all its items? This cannot be undone.`)) return;
    try {
      await postTrainingApi.deleteFeedbackRun(projectId, run.id);
      if (selectedRun?.id === run.id) setSelectedRun(null);
      await loadRuns();
    } catch {
      // silently fail
    }
  }

  async function handleSelectRun(run: FeedbackRun) {
    setLoading(true);
    try {
      const full = await postTrainingApi.getFeedbackRun(projectId, run.id);
      setSelectedRun(full);
      setCurrentItemIndex(0);
      resetReviewState();
      const stillPending = full.items.some((it) => it.generation_status === 'pending');
      if (stillPending && full.prompt_version_id && full.model_config_id) {
        setGenerating(true);
        postTrainingApi
          .generateFeedbackOutputs(projectId, run.id)
          .catch(() => {})
          .then(() => pollUntilGenerated(run.id))
          .finally(() => setGenerating(false));
      }
    } catch {
      // silently fail
    }
    setLoading(false);
  }

  async function pollUntilGenerated(runId: string, maxAttempts = 60) {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const fresh = await postTrainingApi.getFeedbackRun(projectId, runId);
        setSelectedRun(fresh);
        await loadRuns();
        const stillPending = fresh.items.some((it) => it.generation_status === 'pending');
        if (!stillPending) return;
      } catch {
        return;
      }
    }
  }

  async function handleGenerate() {
    if (!selectedRun) return;
    setGenerating(true);
    try {
      await postTrainingApi.generateFeedbackOutputs(projectId, selectedRun.id);
      await pollUntilGenerated(selectedRun.id);
    } catch {
      // silently fail
    }
    setGenerating(false);
  }

  function resetReviewState() {
    setRating(null);
    setThumbs(null);
    setCorrectedOutput('');
    setReviewerComment('');
    setSelectedErrorTags(new Set());
  }

  async function handleSubmitReview(reviewStatus: 'reviewed' | 'skipped') {
    if (!selectedRun) return;
    const item = selectedRun.items[currentItemIndex];
    if (!item) return;

    try {
      await postTrainingApi.submitFeedback(projectId, selectedRun.id, item.id, {
        rating: rating ?? undefined,
        thumbs: thumbs ?? undefined,
        corrected_output: correctedOutput || undefined,
        reviewer_comment: reviewerComment || undefined,
        error_tags: selectedErrorTags.size > 0 ? Array.from(selectedErrorTags).join(',') : undefined,
        review_status: reviewStatus,
      });

      const fresh = await postTrainingApi.getFeedbackRun(projectId, selectedRun.id);
      setSelectedRun(fresh);

      // Move to next unreviewed item
      const nextIdx = fresh.items.findIndex(
        (it, i) => i > currentItemIndex && it.review_status === 'pending',
      );
      if (nextIdx >= 0) {
        setCurrentItemIndex(nextIdx);
      } else {
        setCurrentItemIndex(Math.min(currentItemIndex + 1, fresh.items.length - 1));
      }
      resetReviewState();
      await loadRuns();
    } catch {
      // silently fail
    }
  }

  function toggleErrorTag(tag: string) {
    setSelectedErrorTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  const allPromptVersions = prompts.flatMap((p) =>
    p.versions.map((v) => ({ ...v, promptName: p.name })),
  );

  const currentItem = selectedRun?.items[currentItemIndex] ?? null;
  const reviewedCount = selectedRun?.items.filter((i) => i.review_status !== 'pending').length ?? 0;
  const totalCount = selectedRun?.items.length ?? 0;

  return (
    <Layout>
      {/* ── Left: Feedback Runs ── */}
      <LeftPanel>
        <PanelHeader>
          <PanelTitle>Feedback Runs</PanelTitle>
          <Button size="sm" onClick={() => setShowCreateForm((v) => !v)}>
            {showCreateForm ? 'Cancel' : '+ New'}
          </Button>
        </PanelHeader>
        <PanelBody>
          {showCreateForm && (
            <Card $selected>
              <FormGroup>
                <Label>Run Name</Label>
                <Input value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="Feedback Batch 1" />
              </FormGroup>
              <FormGroup>
                <Label>Description</Label>
                <Input value={runDesc} onChange={(e) => setRunDesc(e.target.value)} placeholder="Optional" />
              </FormGroup>
              <FormGroup>
                <Label>Prompt Version</Label>
                <Select value={promptVersionId} onChange={(e) => setPromptVersionId(e.target.value)}>
                  <option value="">None</option>
                  {allPromptVersions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.promptName} v{v.version_number}
                      {v.label ? ` (${v.label})` : ''}
                    </option>
                  ))}
                </Select>
              </FormGroup>
              <FormGroup>
                <Label>Model Config</Label>
                <Select value={modelConfigId} onChange={(e) => setModelConfigId(e.target.value)}>
                  <option value="">None</option>
                  {models.filter((m) => m.is_enabled).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.provider})
                    </option>
                  ))}
                </Select>
              </FormGroup>
              <FormGroup>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Label>Input Texts (one per line)</Label>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload File
                  </Button>
                </Row>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv,.jsonl,.json,.pdf"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
                <Textarea
                  value={inputTexts}
                  onChange={(e) => setInputTexts(e.target.value)}
                  placeholder={"What is the capital of France?\nExplain quantum computing."}
                  style={{ minHeight: 100 }}
                />
                {fileStatus && (
                  <CardMeta style={{ marginTop: 4, color: tokens.colors.accent.success }}>
                    {fileStatus}
                  </CardMeta>
                )}
              </FormGroup>

              {/* ── Knowledge Base import ── */}
              {kbs.length > 0 && (
                <FormGroup>
                  <Label>Import from Knowledge Base (optional)</Label>
                  <select
                    value={selectedKbId}
                    onChange={(e) => setSelectedKbId(e.target.value)}
                    style={{
                      background: tokens.colors.bg.tertiary,
                      border: `1px solid ${tokens.colors.border.subtle}`,
                      borderRadius: tokens.radii.sm,
                      color: tokens.colors.text.primary,
                      fontFamily: tokens.fonts.body,
                      fontSize: '0.875rem',
                      padding: '8px 12px',
                      outline: 'none',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="">— none —</option>
                    {kbs.map((kb) => (
                      <option key={kb.id} value={kb.id}>
                        {kb.name} ({kb.item_count} items)
                      </option>
                    ))}
                  </select>

                  {selectedKbId && (
                    <div style={{
                      marginTop: 6,
                      background: tokens.colors.bg.primary,
                      border: `1px solid ${tokens.colors.border.subtle}`,
                      borderRadius: tokens.radii.md,
                      maxHeight: 180,
                      overflowY: 'auto',
                    }}>
                      {loadingKbItems ? (
                        <div style={{ padding: 10, fontSize: '0.78rem', color: tokens.colors.text.muted }}>
                          Loading items...
                        </div>
                      ) : kbItems.length === 0 ? (
                        <div style={{ padding: 10, fontSize: '0.78rem', color: tokens.colors.text.muted }}>
                          No items in this KB.
                        </div>
                      ) : (
                        kbItems.map((item) => {
                          const isSelected = selectedKbItemIds.has(item.id);
                          return (
                            <label
                              key={item.id}
                              style={{
                                padding: '6px 10px',
                                display: 'flex',
                                gap: 8,
                                alignItems: 'center',
                                cursor: 'pointer',
                                background: isSelected ? 'rgba(108, 92, 231, 0.08)' : 'transparent',
                                borderBottom: `1px solid ${tokens.colors.border.subtle}`,
                                fontFamily: tokens.fonts.body,
                                fontSize: '0.8rem',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleKbItem(item.id)}
                              />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  color: tokens.colors.text.primary,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}>
                                  {item.name}
                                </div>
                                <div style={{ fontSize: '0.68rem', color: tokens.colors.text.muted }}>
                                  <Badge
                                    color={
                                      item.source_type === 'pdf' ? 'primary'
                                      : item.source_type === 'csv_row' ? 'warning'
                                      : 'secondary'
                                    }
                                  >
                                    {item.source_type}
                                  </Badge>
                                  {' '}{item.content.length.toLocaleString()} chars
                                </div>
                              </div>
                            </label>
                          );
                        })
                      )}
                    </div>
                  )}
                  {selectedKbItemIds.size > 0 && (
                    <CardMeta style={{ marginTop: 4, color: tokens.colors.accent.primary }}>
                      {selectedKbItemIds.size} item(s) selected · will be added as feedback inputs
                    </CardMeta>
                  )}
                </FormGroup>
              )}

              <Button size="sm" disabled={loading || !runName.trim()} onClick={handleCreateRun}>
                Create Run
              </Button>
            </Card>
          )}

          {runs.length === 0 && !showCreateForm && (
            <EmptyState>No feedback runs yet.</EmptyState>
          )}

          {runs.map((run) => (
            <Card
              key={run.id}
              $selected={selectedRun?.id === run.id}
              onClick={() => handleSelectRun(run)}
            >
              <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <CardTitle>{run.name}</CardTitle>
                <Badge color={getFeedbackRunBadgeColor(run.status)}>{run.status}</Badge>
              </Row>
              <CardMeta>
                {run.reviewed_count}/{run.item_count} reviewed
              </CardMeta>
              <ProgressBar $percent={run.item_count > 0 ? (run.reviewed_count / run.item_count) * 100 : 0} />
              <Row style={{ marginTop: 8 }}>
                <Button size="sm" variant="danger" onClick={(e) => handleDeleteRun(run, e)}>
                  Delete
                </Button>
              </Row>
            </Card>
          ))}
        </PanelBody>
      </LeftPanel>

      {/* ── Right: Review Interface ── */}
      <RightPanel>
        {!selectedRun ? (
          <EmptyState>Select a feedback run to review items.</EmptyState>
        ) : (
          <>
            <ReviewHeader>
              <div>
                <PanelTitle style={{ display: 'inline' }}>{selectedRun.name}</PanelTitle>
                <ProgressInfo style={{ marginTop: 2 }}>
                  {reviewedCount} / {totalCount} reviewed
                </ProgressInfo>
              </div>
              <Row>
                {currentItemIndex > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => { setCurrentItemIndex(i => i - 1); resetReviewState(); }}>
                    ← Prev
                  </Button>
                )}
                {currentItemIndex < (selectedRun.items.length - 1) && (
                  <Button size="sm" variant="ghost" onClick={() => { setCurrentItemIndex(i => i + 1); resetReviewState(); }}>
                    Next →
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={handleGenerate} disabled={generating}>
                  {generating ? 'Generating...' : 'Generate Outputs'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => {
                  postTrainingApi.exportFeedbackRun(projectId, selectedRun.id).then((data) => {
                    const blob = new Blob([String(data)], { type: 'application/x-ndjson' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${selectedRun.name}-dpo.jsonl`;
                    a.click();
                  });
                }}>
                  Export JSONL
                </Button>
                <Button size="sm" onClick={async () => {
                  const name = prompt('Dataset name:', `DPO from ${selectedRun.name}`);
                  if (!name) return;
                  try {
                    const ds = await postTrainingApi.feedbackRunToDpoDataset(projectId, selectedRun.id, name);
                    alert(`Created DPO dataset "${ds.name}" with ${ds.item_count} preference pairs. Use it in Fine Tuning with the DPO backend.`);
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}>
                  Build DPO Dataset
                </Button>
              </Row>
            </ReviewHeader>

            {currentItem ? (
              <ReviewArea>
                {/* Progress */}
                <div>
                  <SectionLabel>
                    Item {currentItemIndex + 1} of {selectedRun.items.length}
                    {currentItem.review_status !== 'pending' && (
                      <Badge color={currentItem.review_status === 'reviewed' ? 'success' : 'secondary'} style={{ marginLeft: 8 }}>
                        {currentItem.review_status}
                      </Badge>
                    )}
                  </SectionLabel>
                  <ProgressBar $percent={(reviewedCount / totalCount) * 100} />
                </div>

                {/* Input */}
                <div>
                  <SectionLabel>Input</SectionLabel>
                  <OutputBox style={{ color: tokens.colors.text.secondary }}>
                    {currentItem.input_text}
                  </OutputBox>
                </div>

                {/* Model Output */}
                <div>
                  <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <SectionLabel>Model Output</SectionLabel>
                    <Badge color={
                      currentItem.generation_status === 'generated' ? 'success' :
                      currentItem.generation_status === 'failed' ? 'error' : 'secondary'
                    }>
                      {currentItem.generation_status}
                    </Badge>
                  </Row>
                  <OutputBox>
                    {currentItem.model_output || <span style={{ color: tokens.colors.text.muted }}>Not yet generated. Click "Generate Outputs" above.</span>}
                  </OutputBox>
                </div>

                {/* Thumbs */}
                <div>
                  <SectionLabel>Quick Rating</SectionLabel>
                  <ThumbRow>
                    <ThumbButton $variant="up" $active={thumbs === 'up'} onClick={() => setThumbs(thumbs === 'up' ? null : 'up')}>
                      👍
                    </ThumbButton>
                    <ThumbButton $variant="down" $active={thumbs === 'down'} onClick={() => setThumbs(thumbs === 'down' ? null : 'down')}>
                      👎
                    </ThumbButton>
                  </ThumbRow>
                </div>

                {/* Star Rating */}
                <div>
                  <SectionLabel>Star Rating (1–5)</SectionLabel>
                  <StarRow>
                    {[1, 2, 3, 4, 5].map((s) => (
                      <StarButton key={s} $filled={(rating ?? 0) >= s} onClick={() => setRating(rating === s ? null : s)}>
                        ★
                      </StarButton>
                    ))}
                  </StarRow>
                </div>

                {/* Error Tags */}
                <div>
                  <SectionLabel>Error Tags</SectionLabel>
                  <TagRow>
                    {ERROR_TAGS.map((tag) => (
                      <TagPill
                        key={tag}
                        $active={selectedErrorTags.has(tag)}
                        onClick={() => toggleErrorTag(tag)}
                      >
                        {tag}
                      </TagPill>
                    ))}
                  </TagRow>
                </div>

                {/* Corrected Output */}
                <div>
                  <SectionLabel>Corrected Output (optional)</SectionLabel>
                  <Textarea
                    value={correctedOutput}
                    onChange={(e) => setCorrectedOutput(e.target.value)}
                    placeholder="Provide a better answer if needed..."
                    style={{ minHeight: 100 }}
                  />
                </div>

                {/* Comment */}
                <div>
                  <SectionLabel>Reviewer Comment</SectionLabel>
                  <Textarea
                    value={reviewerComment}
                    onChange={(e) => setReviewerComment(e.target.value)}
                    placeholder="Notes for the team..."
                    style={{ minHeight: 60 }}
                  />
                </div>

                {/* Action Buttons */}
                <Row>
                  <Button onClick={() => handleSubmitReview('reviewed')}>
                    Submit Review
                  </Button>
                  <Button variant="ghost" onClick={() => handleSubmitReview('skipped')}>
                    Skip
                  </Button>
                </Row>
              </ReviewArea>
            ) : (
              <EmptyState>No items in this run.</EmptyState>
            )}
          </>
        )}
      </RightPanel>
    </Layout>
  );
}
