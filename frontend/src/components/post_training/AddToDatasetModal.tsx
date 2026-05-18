import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { postTrainingApi } from '../../api/postTraining';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import type { BacktestResult, BacktestRun, Dataset } from '../../types';

// Pass/fail determination from a BacktestResult.
//
// The backend writes result.status = 'passed' | 'failed' directly (it doesn't
// use 'completed' — that's only on parent BacktestRun). We trust that string
// when present; if it's anything else (pending/error/cancelled), we fall back
// to a threshold check on pass_score, and only return 'not_evaluated' when
// there's nothing usable to score at all.
//
// Returning 'not_evaluated' rather than guessing keeps surprise tags off the
// training data — better to leave a case untagged than silently stamp it
// `bt:failed` because the backtest never actually scored it.
function deriveOutcome(
  result: BacktestResult | undefined,
  threshold: number,
): 'passed' | 'failed' | 'not_evaluated' {
  if (!result) return 'not_evaluated';
  if (result.status === 'passed') return 'passed';
  if (result.status === 'failed') return 'failed';
  // Status is something else (pending/error/cancelled) — threshold-compare
  // if we have a score, otherwise treat as not evaluated.
  if (typeof result.pass_score === 'number') {
    return result.pass_score >= threshold ? 'passed' : 'failed';
  }
  return 'not_evaluated';
}

const Overlay = styled.div`
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
  width: 720px;
  max-width: 95vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: ${tokens.shadows.elevated};
`;

const Header = styled.div`
  padding: ${tokens.spacing.md} ${tokens.spacing.lg};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const Title = styled.h2`
  font-family: ${tokens.fonts.display};
  font-size: 1rem;
  font-weight: 700;
  color: ${tokens.colors.text.primary};
  margin: 0;
`;

const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${tokens.spacing.lg};
`;

const Footer = styled.div`
  padding: ${tokens.spacing.md} ${tokens.spacing.lg};
  border-top: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  justify-content: flex-end;
  gap: ${tokens.spacing.sm};
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
`;

const Label = styled.label`
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  font-weight: 500;
  color: ${tokens.colors.text.secondary};
`;

const HelpText = styled.div`
  font-size: 0.7rem;
  color: ${tokens.colors.text.muted};
  margin-top: 2px;
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
  min-height: 60px;

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

const PreviewBox = styled.div`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  padding: 8px 12px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.75rem;
  color: ${tokens.colors.text.primary};
  max-height: 100px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
`;

const PreviewItem = styled.div`
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: ${tokens.spacing.sm};
  margin-bottom: ${tokens.spacing.sm};
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ErrorMessage = styled.div`
  color: ${tokens.colors.accent.error};
  font-size: 0.8rem;
  padding: 8px;
  background: ${tokens.colors.accent.error}15;
  border-radius: ${tokens.radii.sm};
  margin-top: 8px;
`;

export interface AddToDatasetItem {
  input_text: string;
  output_text: string;
  /** Optional label shown in preview (e.g., test case name or "Backtest result for X") */
  label?: string;
  /** Persisted as DatasetItem.name — curation label, not training-visible. */
  name?: string;
  /** Provenance back-link to the source TestCase, persisted on DatasetItem. */
  source_test_case_id?: string;
  /** Per-item tags that survive into DatasetItem.tags. The modal-level shared
   * tags input is concatenated AFTER these (so caller-set provenance tags
   * like `bt:failed,bt_run:abc` won't be silently overwritten). */
  tags?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  items: AddToDatasetItem[];
  /** Optional pre-fill for the instruction field (e.g., from a prompt version's content) */
  defaultInstruction?: string;
  /** Optional pre-fill for the system_message field */
  defaultSystemMessage?: string;
  /** Title shown in the modal header — context-specific (e.g., "Add Test Case to SFT Dataset") */
  title?: string;
  /** Optional callback after items are added */
  onAdded?: () => void;
  /** Pre-select a reference BacktestRun in the outcome-tag dropdown.
   *  Passed by BacktestPanel when the user opens the modal from inside a
   *  specific run's context — the dropdown then defaults to that run so
   *  `bt:passed`/`bt:failed` tags get applied automatically. */
  defaultBacktestRunId?: string;
}

export function AddToDatasetModal({
  open,
  onClose,
  projectId,
  items,
  defaultInstruction = '',
  defaultSystemMessage = '',
  title = 'Add to SFT Dataset',
  onAdded,
  defaultBacktestRunId,
}: Props) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [createNewMode, setCreateNewMode] = useState(false);
  const [newDatasetName, setNewDatasetName] = useState('');
  const [instruction, setInstruction] = useState(defaultInstruction);
  const [systemMessage, setSystemMessage] = useState(defaultSystemMessage);
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Phase 2: reference-backtest-run picker. When set, each item whose
  // source_test_case_id appears in the run's results gets tagged
  // `bt:passed`/`bt:failed` + `bt_run:<short>`. Items without a source TC,
  // or whose TC isn't in the chosen run, get `bt:not_evaluated`.
  const [backtestRuns, setBacktestRuns] = useState<BacktestRun[]>([]);
  const [selectedBacktestRunId, setSelectedBacktestRunId] = useState<string>(
    defaultBacktestRunId ?? '',
  );
  // pass_threshold for the currently selected run (needed to derive pass/fail
  // from a result's pass_score).
  const [selectedRunThreshold, setSelectedRunThreshold] = useState<number>(0.5);
  const [resultByTcId, setResultByTcId] = useState<Map<string, BacktestResult>>(new Map());
  const [loadingResults, setLoadingResults] = useState(false);

  // Close on Escape unless we're mid-submit (mirrors the Cancel button's disabled state).
  useEscapeKey(onClose, open && !submitting);
  const [error, setError] = useState<string | null>(null);

  // Re-sync defaults whenever the modal is reopened
  useEffect(() => {
    if (open) {
      setInstruction(defaultInstruction);
      setSystemMessage(defaultSystemMessage);
      setTags('');
      setError(null);
      setSelectedBacktestRunId(defaultBacktestRunId ?? '');
      loadDatasets();
      // Fetch all backtest runs for the project so the dropdown has options.
      postTrainingApi.listBacktestRuns(projectId)
        .then((runs) => setBacktestRuns(runs))
        .catch(() => setBacktestRuns([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultInstruction, defaultSystemMessage, defaultBacktestRunId, projectId]);

  // Load results when the user (or the prop default) selects a run.
  useEffect(() => {
    if (!open) return;
    if (!selectedBacktestRunId) {
      setResultByTcId(new Map());
      setSelectedRunThreshold(0.5);
      return;
    }
    setLoadingResults(true);
    postTrainingApi.getBacktestRun(projectId, selectedBacktestRunId)
      .then((run) => {
        const m = new Map<string, BacktestResult>();
        for (const r of run.results) m.set(r.test_case_id, r);
        setResultByTcId(m);
        setSelectedRunThreshold(run.pass_threshold ?? 0.5);
      })
      .catch(() => {
        setResultByTcId(new Map());
      })
      .finally(() => setLoadingResults(false));
  }, [open, projectId, selectedBacktestRunId]);

  // Outcome counts shown next to the dropdown so the user knows what's going
  // to be tagged before they hit Save. Counts only consider items that have
  // a `source_test_case_id` — items without one can't be tagged at all.
  // We split "not_evaluated" into two finer buckets so the user can tell
  // "wrong run picked" (notInRun) apart from "run had this TC but result
  // was errored/skipped" (unscored) — they're both `bt:not_evaluated` on
  // the persisted tag but cause different follow-up actions.
  const outcomeCounts = (() => {
    if (!selectedBacktestRunId) return null;
    let passed = 0, failed = 0, notInRun = 0, unscored = 0, untaggable = 0;
    for (const item of items) {
      if (!item.source_test_case_id) { untaggable++; continue; }
      const result = resultByTcId.get(item.source_test_case_id);
      if (!result) { notInRun++; continue; }
      const outcome = deriveOutcome(result, selectedRunThreshold);
      if (outcome === 'passed') passed++;
      else if (outcome === 'failed') failed++;
      else unscored++;
    }
    return { passed, failed, notInRun, unscored, untaggable };
  })();

  async function loadDatasets() {
    try {
      const list = await postTrainingApi.listDatasets(projectId);
      setDatasets(list);
      if (list.length > 0 && !selectedDatasetId) {
        setSelectedDatasetId(list[0].id);
      } else if (list.length === 0) {
        setCreateNewMode(true);
      }
    } catch (e) {
      setError(`Failed to load datasets: ${(e as Error).message}`);
    }
  }

  async function handleSubmit() {
    if (items.length === 0) {
      setError('No items to add.');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      let datasetId = selectedDatasetId;

      // Create new dataset first if requested
      if (createNewMode) {
        if (!newDatasetName.trim()) {
          setError('Please enter a name for the new dataset.');
          setSubmitting(false);
          return;
        }
        const created = await postTrainingApi.createDataset(projectId, {
          name: newDatasetName.trim(),
        });
        datasetId = created.id;
      }

      if (!datasetId) {
        setError('Please select a target dataset.');
        setSubmitting(false);
        return;
      }

      // Build payload — apply instruction/system_message to all items. Tag
      // composition (most-specific first → most-generic last):
      //   1. per-item tags (already carry e.g. test-case provenance)
      //   2. bt:passed / bt:failed / bt:not_evaluated + bt_run:<short>
      //      (only when a reference backtest run was picked)
      //   3. modal-level shared tags input
      //
      // Items without `source_test_case_id` skip step 2 entirely — there's
      // nothing meaningful to look up.
      const sharedTags = tags.trim();
      const runShortId = selectedBacktestRunId
        ? selectedBacktestRunId.slice(0, 8)
        : null;

      const payload = items.map((item) => {
        const parts: string[] = [];
        const perItemTags = (item.tags || '').trim();
        if (perItemTags) parts.push(perItemTags);

        if (selectedBacktestRunId && item.source_test_case_id) {
          const outcome = deriveOutcome(
            resultByTcId.get(item.source_test_case_id),
            selectedRunThreshold,
          );
          parts.push(`bt:${outcome}`);
          if (runShortId) parts.push(`bt_run:${runShortId}`);
        }

        if (sharedTags) parts.push(sharedTags);
        const mergedTags = parts.length ? parts.join(',') : undefined;

        return {
          name: item.name || undefined,
          input_text: item.input_text,
          output_text: item.output_text,
          instruction: instruction.trim() || undefined,
          system_message: systemMessage.trim() || undefined,
          tags: mergedTags,
          source_test_case_id: item.source_test_case_id || undefined,
        };
      });

      await postTrainingApi.addDatasetItems(projectId, datasetId, payload);

      onAdded?.();
      onClose();
    } catch (e) {
      setError(`Failed to add items: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <Overlay onClick={onClose}>
      <Modal onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>{title}</Title>
          <Badge color="secondary">{items.length} item{items.length === 1 ? '' : 's'}</Badge>
        </Header>
        <Body>
          {/* Dataset selection */}
          <FormGroup>
            <Label>Target Dataset</Label>
            {!createNewMode ? (
              <>
                <Select
                  value={selectedDatasetId}
                  onChange={(e) => setSelectedDatasetId(e.target.value)}
                >
                  {datasets.length === 0 ? (
                    <option value="">No datasets — create a new one</option>
                  ) : (
                    <>
                      <option value="">Select a dataset...</option>
                      {datasets.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.item_count} items)
                        </option>
                      ))}
                    </>
                  )}
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setCreateNewMode(true)}
                  style={{ alignSelf: 'flex-start', marginTop: 4 }}
                >
                  + Create new dataset
                </Button>
              </>
            ) : (
              <>
                <Input
                  value={newDatasetName}
                  onChange={(e) => setNewDatasetName(e.target.value)}
                  placeholder="New dataset name"
                />
                {datasets.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCreateNewMode(false)}
                    style={{ alignSelf: 'flex-start', marginTop: 4 }}
                  >
                    ← Use existing dataset
                  </Button>
                )}
              </>
            )}
          </FormGroup>

          {/* Instruction (optional) */}
          <FormGroup>
            <Label>Instruction (optional)</Label>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. 'Classify the following case' (leave blank for raw input→output)"
            />
            <HelpText>
              Applied to all items. Leave blank to train on raw input→output mapping.
            </HelpText>
          </FormGroup>

          {/* System Message (optional) */}
          <FormGroup>
            <Label>System Message (optional)</Label>
            <Textarea
              value={systemMessage}
              onChange={(e) => setSystemMessage(e.target.value)}
              placeholder="System-level context (role, tone, constraints)"
            />
            <HelpText>
              Applied to all items. Loses persona/role context when blank.
            </HelpText>
          </FormGroup>

          {/* Tags (optional) */}
          <FormGroup>
            <Label>Tags (optional)</Label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="comma,separated,tags"
            />
          </FormGroup>

          {/* Reference Backtest Run — adds bt:passed/bt:failed tags per item.
              Only meaningful for items that carry source_test_case_id (i.e.,
              were exported from TestCases). Hidden entirely when zero items
              have provenance — no point offering the picker. */}
          {items.some((it) => !!it.source_test_case_id) && (
            <FormGroup>
              <Label>Reference Backtest Run (optional)</Label>
              <Select
                value={selectedBacktestRunId}
                onChange={(e) => setSelectedBacktestRunId(e.target.value)}
              >
                <option value="">— none (no outcome tags) —</option>
                {backtestRuns.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.pass_rate != null ? `· ${(r.pass_rate * 100).toFixed(0)}% pass` : ''} · {r.status}
                  </option>
                ))}
              </Select>
              <HelpText>
                Tags each item with <code>bt:passed</code> / <code>bt:failed</code> /
                <code> bt:not_evaluated</code> + <code>bt_run:&lt;id&gt;</code> based on the chosen
                run's results. Cases not in the chosen run get <code>bt:not_evaluated</code>.
              </HelpText>
              {selectedBacktestRunId && (
                loadingResults ? (
                  <HelpText>Loading run results…</HelpText>
                ) : outcomeCounts && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                      marginTop: 4,
                      fontSize: '0.78rem',
                    }}
                  >
                    {outcomeCounts.passed > 0 && (
                      <Badge color="success">{outcomeCounts.passed} passed</Badge>
                    )}
                    {outcomeCounts.failed > 0 && (
                      <Badge color="error">{outcomeCounts.failed} failed</Badge>
                    )}
                    {outcomeCounts.notInRun > 0 && (
                      <Badge color="secondary">
                        {outcomeCounts.notInRun} not in run
                      </Badge>
                    )}
                    {outcomeCounts.unscored > 0 && (
                      <Badge color="secondary">
                        {outcomeCounts.unscored} unscored
                      </Badge>
                    )}
                    {outcomeCounts.untaggable > 0 && (
                      <Badge color="secondary">
                        {outcomeCounts.untaggable} no source TC
                      </Badge>
                    )}
                  </div>
                )
              )}
            </FormGroup>
          )}

          {/* Preview of items */}
          <FormGroup>
            <Label>Items to add ({items.length})</Label>
            {items.slice(0, 3).map((item, i) => (
              <PreviewItem key={i}>
                {item.label && (
                  <Badge color="secondary" style={{ alignSelf: 'flex-start' }}>
                    {item.label}
                  </Badge>
                )}
                <div>
                  <Label>Input</Label>
                  <PreviewBox>{item.input_text || '(empty)'}</PreviewBox>
                </div>
                <div>
                  <Label>Output</Label>
                  <PreviewBox>{item.output_text || '(empty)'}</PreviewBox>
                </div>
              </PreviewItem>
            ))}
            {items.length > 3 && (
              <HelpText>...and {items.length - 3} more</HelpText>
            )}
          </FormGroup>

          {error && <ErrorMessage>{error}</ErrorMessage>}
        </Body>
        <Footer>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || items.length === 0}>
            {submitting ? 'Adding...' : `Add ${items.length} item${items.length === 1 ? '' : 's'}`}
          </Button>
        </Footer>
      </Modal>
    </Overlay>
  );
}
