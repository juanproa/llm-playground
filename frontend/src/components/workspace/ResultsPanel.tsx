import { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Card, CardTitle, CardHeader } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { useInferenceStore } from '../../stores/inferenceStore';
import { parseThinking, stripThinkingFromStream } from '../../utils/thinkingFilter';
import { postTrainingApi } from '../../api/postTraining';
import { documentsApi } from '../../api/documents';
import type { InferenceRun, ModelConfig, Prompt } from '../../types';

const OutputArea = styled.div`
  background: ${tokens.colors.bg.tertiary};
  border-radius: ${tokens.radii.md};
  padding: ${tokens.spacing.lg};
  min-height: 200px;
  max-height: 500px;
  overflow-y: auto;
  font-family: ${tokens.fonts.mono};
  font-size: 0.85rem;
  line-height: 1.7;
  color: ${tokens.colors.text.primary};
  white-space: pre-wrap;
  word-break: break-word;
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const StreamCursor = styled.span`
  display: inline-block;
  width: 8px;
  height: 16px;
  background: ${tokens.colors.accent.primary};
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: ${pulse} 1s ease-in-out infinite;
`;

const Placeholder = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: ${tokens.colors.text.muted};
  font-size: 0.9rem;
`;

const HistoryItem = styled.div<{ $active?: boolean }>`
  padding: 10px ${tokens.spacing.md};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  cursor: pointer;
  font-size: 0.8rem;
  transition: all 0.15s;
  background: ${({ $active }) => $active ? tokens.colors.bg.tertiary : 'transparent'};
  border-left: 3px solid ${({ $active }) => $active ? tokens.colors.accent.primary : 'transparent'};

  &:hover {
    background: ${tokens.colors.bg.tertiary};
  }

  &:last-child {
    border-bottom: none;
  }
`;

const HistoryRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const HistoryMeta = styled.div`
  display: flex;
  gap: 10px;
  font-size: 0.7rem;
  color: ${tokens.colors.text.muted};
  align-items: center;
`;

const HistoryPreview = styled.div`
  margin-top: 4px;
  color: ${tokens.colors.text.muted};
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

/* ── Detail View ── */

const DetailOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
`;

const DetailDrawer = styled.div`
  width: min(680px, 90vw);
  height: 100%;
  background: ${tokens.colors.bg.secondary};
  border-left: 1px solid ${tokens.colors.border.subtle};
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

const DrawerHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${tokens.spacing.lg} ${tokens.spacing.xl};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  position: sticky;
  top: 0;
  background: ${tokens.colors.bg.secondary};
  z-index: 1;
`;

const DrawerTitle = styled.h2`
  font-family: ${tokens.fonts.display};
  font-size: 1.1rem;
  font-weight: 600;
`;

const DrawerBody = styled.div`
  padding: ${tokens.spacing.lg} ${tokens.spacing.xl};
  display: flex;
  flex-direction: column;
  gap: ${tokens.spacing.lg};
`;

const Section = styled.div``;

const SectionLabel = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: ${tokens.colors.text.muted};
  margin-bottom: 8px;
`;

const MetaGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
`;

const MetaCard = styled.div`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: 10px 14px;
`;

const MetaLabel = styled.div`
  font-size: 0.65rem;
  font-family: ${tokens.fonts.accent};
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: ${tokens.colors.text.muted};
  margin-bottom: 4px;
`;

const MetaValue = styled.div`
  font-size: 0.9rem;
  font-weight: 600;
  color: ${tokens.colors.text.primary};
`;

const MetaValueMono = styled(MetaValue)`
  font-family: ${tokens.fonts.mono};
  font-size: 0.8rem;
`;

const ContentBlock = styled.div`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: ${tokens.spacing.md};
  font-family: ${tokens.fonts.mono};
  font-size: 0.8rem;
  line-height: 1.6;
  color: ${tokens.colors.text.primary};
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
`;

const ErrorBlock = styled(ContentBlock)`
  border-color: rgba(255, 82, 82, 0.3);
  color: ${tokens.colors.accent.error};
  background: rgba(255, 82, 82, 0.06);
`;

const Divider = styled.hr`
  border: none;
  border-top: 1px solid ${tokens.colors.border.subtle};
  margin: 0;
`;

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

/* ── Thinking Block ── */

const ThinkingContainer = styled.details`
  margin-bottom: 12px;
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  overflow: hidden;
`;

const ThinkingSummary = styled.summary`
  padding: 8px 12px;
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  font-weight: 500;
  color: ${tokens.colors.text.muted};
  background: rgba(108, 92, 231, 0.06);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  user-select: none;

  &:hover {
    color: ${tokens.colors.text.secondary};
    background: rgba(108, 92, 231, 0.1);
  }

  &::marker {
    content: '';
  }

  &::-webkit-details-marker {
    display: none;
  }
`;

const ThinkingArrow = styled.span<{ $open?: boolean }>`
  display: inline-block;
  transition: transform 0.2s;
  transform: rotate(${({ $open }) => $open ? '90deg' : '0deg'});
  font-size: 0.65rem;
`;

const ThinkingContent = styled.div`
  padding: 10px 12px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.75rem;
  line-height: 1.6;
  color: ${tokens.colors.text.muted};
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  border-top: 1px solid ${tokens.colors.border.subtle};
  background: ${tokens.colors.bg.primary};
`;

const ThinkingIndicator = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  color: ${tokens.colors.accent.primary};
  opacity: 0.8;
  margin-bottom: 8px;
`;

function ThinkingBlock({ blocks }: { blocks: string[] }) {
  const [open, setOpen] = useState(false);
  if (blocks.length === 0) return null;
  return (
    <ThinkingContainer open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <ThinkingSummary>
        <ThinkingArrow $open={open}>&#9654;</ThinkingArrow>
        Model reasoning ({blocks.length} block{blocks.length > 1 ? 's' : ''})
      </ThinkingSummary>
      <ThinkingContent>
        {blocks.join('\n\n---\n\n')}
      </ThinkingContent>
    </ThinkingContainer>
  );
}

/* ── Helpers ── */

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/* ── Detail Component ── */

function RunDetail({
  run,
  models,
  prompts,
  projectId,
  onClose,
  onDelete,
}: {
  run: InferenceRun;
  models: ModelConfig[];
  prompts: Prompt[];
  projectId: string;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const model = models.find((m) => m.id === run.model_config_id);
  const prompt = prompts.find((p) => p.versions.some((v) => v.id === run.prompt_version_id));
  const version = prompt?.versions.find((v) => v.id === run.prompt_version_id);
  const [showSaveModal, setShowSaveModal] = useState(false);

  const canSave = run.status === 'completed' && !!run.output_text;

  return (
    <DetailOverlay onClick={onClose}>
      <DetailDrawer onClick={(e) => e.stopPropagation()}>
        <DrawerHeader>
          <DrawerTitle>Run Details</DrawerTitle>
          <div style={{ display: 'flex', gap: 8 }}>
            {canSave && (
              <Button size="sm" variant="ghost" onClick={() => setShowSaveModal(true)}>
                💾 Save as Test Case
              </Button>
            )}
            <Button size="sm" variant="danger" onClick={() => { onDelete(run.id); onClose(); }}>Delete Run</Button>
            <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </DrawerHeader>

        {showSaveModal && (
          <SaveTestCaseModal
            run={run}
            projectId={projectId}
            onClose={() => setShowSaveModal(false)}
          />
        )}

        <DrawerBody>
          {/* Status + Timing */}
          <Section>
            <SectionLabel>Status</SectionLabel>
            <StatusRow>
              <Badge
                color={
                  run.status === 'completed' ? 'success'
                  : run.status === 'failed' ? 'error'
                  : 'warning'
                }
              >
                {run.status}
              </Badge>
              <span style={{ fontSize: '0.8rem', color: tokens.colors.text.muted }}>
                {formatDate(run.created_at)}
              </span>
            </StatusRow>
          </Section>

          {/* Metrics */}
          <Section>
            <SectionLabel>Metrics</SectionLabel>
            <MetaGrid>
              <MetaCard>
                <MetaLabel>Latency</MetaLabel>
                <MetaValue>{run.latency_ms ? formatDuration(run.latency_ms) : '—'}</MetaValue>
              </MetaCard>
              <MetaCard>
                <MetaLabel>Cost</MetaLabel>
                <MetaValue>
                  {run.cost_estimate_usd != null ? `$${run.cost_estimate_usd.toFixed(4)}` : '—'}
                </MetaValue>
              </MetaCard>
              <MetaCard>
                <MetaLabel>Input Tokens</MetaLabel>
                <MetaValue>{run.token_usage_input != null ? formatTokens(run.token_usage_input) : '—'}</MetaValue>
              </MetaCard>
              <MetaCard>
                <MetaLabel>Output Tokens</MetaLabel>
                <MetaValue>{run.token_usage_output != null ? formatTokens(run.token_usage_output) : '—'}</MetaValue>
              </MetaCard>
            </MetaGrid>
          </Section>

          <Divider />

          {/* Model */}
          <Section>
            <SectionLabel>Model</SectionLabel>
            {model ? (
              <MetaGrid>
                <MetaCard>
                  <MetaLabel>Name</MetaLabel>
                  <MetaValue>{model.name}</MetaValue>
                </MetaCard>
                <MetaCard>
                  <MetaLabel>Provider</MetaLabel>
                  <MetaValueMono>{model.provider}</MetaValueMono>
                </MetaCard>
                <MetaCard>
                  <MetaLabel>Model ID</MetaLabel>
                  <MetaValueMono>{model.model_id}</MetaValueMono>
                </MetaCard>
                <MetaCard>
                  <MetaLabel>Temperature</MetaLabel>
                  <MetaValue>{model.temperature}</MetaValue>
                </MetaCard>
              </MetaGrid>
            ) : (
              <ContentBlock style={{ color: tokens.colors.text.muted }}>
                Model config not found (ID: {run.model_config_id})
              </ContentBlock>
            )}
          </Section>

          <Divider />

          {/* Prompt */}
          <Section>
            <SectionLabel>Prompt</SectionLabel>
            {prompt && version ? (
              <>
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{prompt.name}</span>
                  <Badge color="primary">v{version.version_number}</Badge>
                  {version.label && (
                    <span style={{ fontSize: '0.75rem', color: tokens.colors.text.muted }}>{version.label}</span>
                  )}
                </div>
                {version.system_message && (
                  <div style={{ marginBottom: 8 }}>
                    <MetaLabel>System Message</MetaLabel>
                    <ContentBlock>{version.system_message}</ContentBlock>
                  </div>
                )}
                <MetaLabel>Prompt Content</MetaLabel>
                <ContentBlock>{version.content}</ContentBlock>
              </>
            ) : (
              <ContentBlock style={{ color: tokens.colors.text.muted }}>
                Prompt version not found (ID: {run.prompt_version_id})
              </ContentBlock>
            )}
          </Section>

          <Divider />

          {/* Input */}
          <Section>
            <SectionLabel>Input Text</SectionLabel>
            {run.input_text ? (
              <ContentBlock>{run.input_text}</ContentBlock>
            ) : (
              <ContentBlock style={{ color: tokens.colors.text.muted, fontStyle: 'italic' }}>
                No input text provided
              </ContentBlock>
            )}
          </Section>

          {run.document_id && (
            <Section>
              <SectionLabel>Document</SectionLabel>
              <MetaCard>
                <MetaLabel>Document ID</MetaLabel>
                <MetaValueMono>{run.document_id}</MetaValueMono>
              </MetaCard>
            </Section>
          )}

          <Divider />

          {/* Output */}
          <Section>
            <SectionLabel>Output</SectionLabel>
            {run.error_message ? (
              <ErrorBlock>{run.error_message}</ErrorBlock>
            ) : run.output_text ? (
              (() => {
                const { answer, thinkingBlocks } = parseThinking(run.output_text);
                return (
                  <>
                    <ThinkingBlock blocks={thinkingBlocks} />
                    <ContentBlock style={{ maxHeight: 400 }}>{answer || run.output_text}</ContentBlock>
                  </>
                );
              })()
            ) : (
              <ContentBlock style={{ color: tokens.colors.text.muted, fontStyle: 'italic' }}>
                No output
              </ContentBlock>
            )}
          </Section>

          {/* Timestamps */}
          <Section>
            <SectionLabel>Timeline</SectionLabel>
            <MetaGrid>
              <MetaCard>
                <MetaLabel>Created</MetaLabel>
                <MetaValueMono>{formatDate(run.created_at)}</MetaValueMono>
              </MetaCard>
              {run.started_at && (
                <MetaCard>
                  <MetaLabel>Started</MetaLabel>
                  <MetaValueMono>{formatDate(run.started_at)}</MetaValueMono>
                </MetaCard>
              )}
              {run.completed_at && (
                <MetaCard>
                  <MetaLabel>Completed</MetaLabel>
                  <MetaValueMono>{formatDate(run.completed_at)}</MetaValueMono>
                </MetaCard>
              )}
              <MetaCard>
                <MetaLabel>Run ID</MetaLabel>
                <MetaValueMono style={{ fontSize: '0.7rem' }}>{run.id}</MetaValueMono>
              </MetaCard>
            </MetaGrid>
          </Section>
        </DrawerBody>
      </DetailDrawer>
    </DetailOverlay>
  );
}

/* ── Save as Test Case Modal ── */

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const ModalBox = styled.div`
  background: ${tokens.colors.bg.secondary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.lg};
  width: 100%;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
`;

const ModalTitle = styled.h3`
  font-family: ${tokens.fonts.display};
  font-size: 1rem;
  font-weight: 600;
  color: ${tokens.colors.text.primary};
`;

const ModalBody = styled.div`
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const ModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid ${tokens.colors.border.subtle};
  background: ${tokens.colors.bg.primary};
`;

const FieldLabel = styled.label`
  display: block;
  font-family: ${tokens.fonts.accent};
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: ${tokens.colors.text.muted};
  margin-bottom: 6px;
`;

const FieldInput = styled.input`
  width: 100%;
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: 8px 12px;
  font-family: ${tokens.fonts.body};
  font-size: 0.85rem;
  color: ${tokens.colors.text.primary};
  outline: none;
  box-sizing: border-box;

  &:focus {
    border-color: ${tokens.colors.accent.primary};
  }
`;

const FieldSelect = styled.select`
  width: 100%;
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: 8px 12px;
  font-family: ${tokens.fonts.body};
  font-size: 0.85rem;
  color: ${tokens.colors.text.primary};
  outline: none;
  cursor: pointer;

  &:focus {
    border-color: ${tokens.colors.accent.primary};
  }
`;

const FieldTextarea = styled.textarea`
  width: 100%;
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: 8px 12px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.78rem;
  line-height: 1.5;
  color: ${tokens.colors.text.primary};
  outline: none;
  resize: vertical;
  min-height: 80px;
  box-sizing: border-box;

  &:focus {
    border-color: ${tokens.colors.accent.primary};
  }
`;

const GoldenToggle = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.82rem;
  color: ${tokens.colors.text.secondary};
  user-select: none;
`;

const SuccessBanner = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(0, 200, 120, 0.1);
  border: 1px solid rgba(0, 200, 120, 0.25);
  border-radius: ${tokens.radii.md};
  font-size: 0.82rem;
  color: #00c878;
`;

interface SaveTestCaseModalProps {
  run: InferenceRun;
  projectId: string;
  onClose: () => void;
}

function SaveTestCaseModal({ run, projectId, onClose }: SaveTestCaseModalProps) {
  const { answer } = parseThinking(run.output_text || '');

  const [name, setName] = useState(
    `Test case – ${new Date(run.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  );
  const [expectedType, setExpectedType] = useState('generative');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [isGolden, setIsGolden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [documentContent, setDocumentContent] = useState<string | null>(null);
  const [docLoaded, setDocLoaded] = useState(!run.document_id); // true if no doc to load

  // Fetch document content if the run had a document attached
  useEffect(() => {
    if (!run.document_id) return;
    let cancelled = false;
    documentsApi.get(run.document_id)
      .then((doc) => { if (!cancelled) setDocumentContent(doc.raw_text || null); })
      .catch(() => { /* doc fetch failed — save will still work with input_text only */ })
      .finally(() => { if (!cancelled) setDocLoaded(true); });
    return () => { cancelled = true; };
  }, [run.document_id]);

  // Compose the full input text (document content + user input)
  const fullInputText = (() => {
    const parts: string[] = [];
    if (documentContent) {
      parts.push(`--- Document Content ---\n${documentContent}`);
    }
    if (run.input_text) {
      parts.push(run.input_text);
    }
    return parts.join('\n\n') || run.input_text || '';
  })();

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await postTrainingApi.createTestCase(projectId, {
        name: name.trim(),
        input_text: fullInputText,
        expected_output: answer || run.output_text || '',
        expected_type: expectedType,
        tags: tags.trim() || undefined,
        notes: notes.trim() || undefined,
        is_golden: isGolden,
        document_id: run.document_id || undefined,
      });
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay onClick={onClose}>
      <ModalBox onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>💾 Save as Backtest Case</ModalTitle>
          <Button size="sm" variant="ghost" onClick={onClose}>✕</Button>
        </ModalHeader>

        <ModalBody>
          {saved ? (
            <SuccessBanner>
              ✓ Test case saved to Post-Training → Backtesting
            </SuccessBanner>
          ) : (
            <>
              <div>
                <FieldLabel>Name</FieldLabel>
                <FieldInput
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Describe what this test case validates"
                  autoFocus
                />
              </div>

              <div>
                <FieldLabel>Expected Output Type</FieldLabel>
                <FieldSelect value={expectedType} onChange={(e) => setExpectedType(e.target.value)}>
                  <option value="generative">Generative</option>
                  <option value="classification">Classification</option>
                  <option value="extraction">Extraction</option>
                  <option value="structured">Structured</option>
                </FieldSelect>
              </div>

              <div>
                <FieldLabel>Tags (comma-separated)</FieldLabel>
                <FieldInput
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. ocr, medical, v2-prompt"
                />
              </div>

              <div>
                <FieldLabel>Notes</FieldLabel>
                <FieldTextarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Why is this output good? What should the model preserve?"
                />
              </div>

              <GoldenToggle>
                <input
                  type="checkbox"
                  checked={isGolden}
                  onChange={(e) => setIsGolden(e.target.checked)}
                  style={{ accentColor: tokens.colors.accent.primary }}
                />
                Mark as golden dataset entry (high-confidence ground truth)
              </GoldenToggle>

              {saveError && (
                <div style={{ fontSize: '0.8rem', color: tokens.colors.accent.error }}>
                  Error: {saveError}
                </div>
              )}
            </>
          )}
        </ModalBody>

        <ModalFooter>
          {saved ? (
            <Button size="sm" onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={saving || !docLoaded || !name.trim()}>
                {!docLoaded ? 'Loading document...' : saving ? 'Saving...' : 'Save Test Case'}
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalBox>
    </ModalOverlay>
  );
}

/* ── Main Panel ── */

const CheckboxWrapper = styled.div<{ $checked?: boolean }>`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid ${({ $checked }) => $checked ? tokens.colors.accent.primary : tokens.colors.border.strong};
  background: ${({ $checked }) => $checked ? tokens.colors.accent.primary : 'transparent'};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;

  &:hover {
    border-color: ${tokens.colors.accent.primary};
  }

  &::after {
    content: '';
    display: ${({ $checked }) => $checked ? 'block' : 'none'};
    width: 6px;
    height: 3px;
    border-left: 2px solid white;
    border-bottom: 2px solid white;
    transform: rotate(-45deg) translateY(-1px);
  }
`;

const HistoryToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${tokens.spacing.md} ${tokens.spacing.lg};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
`;

const ToolbarLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const ToolbarActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SelectCount = styled.span`
  font-size: 0.75rem;
  color: ${tokens.colors.text.secondary};
  font-family: ${tokens.fonts.accent};
`;

interface Props {
  projectId: string;
  models: ModelConfig[];
  prompts: Prompt[];
}

export function ResultsPanel({ projectId, models, prompts }: Props) {
  const { currentOutput, isStreaming, error, history, deleteRun, deleteBulk, clearHistory } = useInferenceStore();
  const [selectedRun, setSelectedRun] = useState<InferenceRun | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  const resolveModelName = (id: string) => {
    const m = models.find((m) => m.id === id);
    return m ? m.name : '';
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === history.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(history.map((r) => r.id)));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} run${selectedIds.size > 1 ? 's' : ''}?`)) return;
    await deleteBulk(projectId, Array.from(selectedIds));
    setSelectedIds(new Set());
    if (selectedRun && selectedIds.has(selectedRun.id)) setSelectedRun(null);
  };

  const handleClearAll = async () => {
    if (!confirm(`Delete all ${history.length} runs in this project? This cannot be undone.`)) return;
    await clearHistory(projectId);
    setSelectedIds(new Set());
    setSelectedRun(null);
    setSelectMode(false);
  };

  const handleDeleteSingle = async (id: string) => {
    await deleteRun(id);
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.md }}>
      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
          {isStreaming && <Badge color="primary">Streaming</Badge>}
        </CardHeader>

        {error && (
          <div style={{ color: tokens.colors.accent.error, marginBottom: tokens.spacing.md, fontSize: '0.85rem' }}>
            Error: {error}
          </div>
        )}

        {currentOutput ? (
          (() => {
            if (isStreaming) {
              const { visible, isThinking } = stripThinkingFromStream(currentOutput);
              return (
                <>
                  {isThinking && (
                    <ThinkingIndicator>
                      <StreamCursor style={{ width: 6, height: 12 }} /> Model is thinking...
                    </ThinkingIndicator>
                  )}
                  {visible ? (
                    <OutputArea>
                      {visible}
                      {!isThinking && <StreamCursor />}
                    </OutputArea>
                  ) : !isThinking ? (
                    <OutputArea><StreamCursor /></OutputArea>
                  ) : null}
                </>
              );
            }
            const { answer, thinkingBlocks } = parseThinking(currentOutput);
            return (
              <>
                <ThinkingBlock blocks={thinkingBlocks} />
                <OutputArea>{answer || currentOutput}</OutputArea>
              </>
            );
          })()
        ) : (
          <Placeholder>
            {isStreaming ? 'Waiting for response...' : 'Run an inference to see results here'}
          </Placeholder>
        )}
      </Card>

      {history.length > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <HistoryToolbar>
            <ToolbarLeft>
              <CardTitle style={{ margin: 0 }}>Run History</CardTitle>
              <Badge color="secondary">{history.length}</Badge>
            </ToolbarLeft>
            <ToolbarActions>
              {selectMode ? (
                <>
                  {selectedIds.size > 0 && (
                    <SelectCount>{selectedIds.size} selected</SelectCount>
                  )}
                  <Button size="sm" variant="ghost" onClick={toggleAll}>
                    {selectedIds.size === history.length ? 'Deselect All' : 'Select All'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={handleDeleteSelected} disabled={selectedIds.size === 0}>
                    Delete Selected
                  </Button>
                  <Button size="sm" variant="ghost" onClick={exitSelectMode}>Cancel</Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setSelectMode(true)}>Select</Button>
                  <Button size="sm" variant="danger" onClick={handleClearAll}>Clear All</Button>
                </>
              )}
            </ToolbarActions>
          </HistoryToolbar>
          {history.slice(0, 50).map((run) => (
            <HistoryItem
              key={run.id}
              $active={selectedRun?.id === run.id}
              onClick={() => selectMode ? undefined : setSelectedRun(run)}
            >
              <HistoryRow>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {selectMode && (
                    <CheckboxWrapper
                      $checked={selectedIds.has(run.id)}
                      onClick={(e) => toggleSelect(run.id, e)}
                    />
                  )}
                  <Badge
                    color={
                      run.status === 'completed' ? 'success'
                      : run.status === 'failed' ? 'error'
                      : 'warning'
                    }
                  >
                    {run.status}
                  </Badge>
                  <span style={{ color: tokens.colors.text.secondary, fontSize: '0.8rem', fontWeight: 500 }}>
                    {resolveModelName(run.model_config_id)}
                  </span>
                </div>
                <HistoryMeta>
                  {run.latency_ms != null && <span>{formatDuration(run.latency_ms)}</span>}
                  {run.token_usage_input != null && <span>{formatTokens(run.token_usage_input)} in</span>}
                  {run.token_usage_output != null && <span>{formatTokens(run.token_usage_output)} out</span>}
                  <span>{formatDate(run.created_at)}</span>
                </HistoryMeta>
              </HistoryRow>
              {run.output_text && (
                <HistoryPreview>
                  {parseThinking(run.output_text).answer.substring(0, 120)}
                </HistoryPreview>
              )}
            </HistoryItem>
          ))}
        </Card>
      )}

      {selectedRun && (
        <RunDetail
          run={selectedRun}
          models={models}
          prompts={prompts}
          projectId={projectId}
          onClose={() => setSelectedRun(null)}
          onDelete={handleDeleteSingle}
        />
      )}
    </div>
  );
}
