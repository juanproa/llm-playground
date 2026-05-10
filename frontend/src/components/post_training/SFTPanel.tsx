import { useState, useEffect, useRef } from 'react';
import styled, { keyframes } from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { postTrainingApi } from '../../api/postTraining';
import { inferenceApi } from '../../api/inference';
import { modelsApi } from '../../api/models';
import { promptsApi } from '../../api/prompts';
import type { ArtifactInfo, Dataset, HfModelInfo, InferenceRun, MlxModelInfo, ModelConfig, Prompt, TrainingBackendInfo, TrainingJob } from '../../types';
import type { DatasetWithItems } from '../../api/postTraining';
import { LossChart } from './LossChart';

interface Props {
  projectId: string;
}

// ─── Styled Components ────────────────────────────────────────────────────────

const Layout = styled.div`
  display: grid;
  grid-template-columns: 340px 1fr 340px;
  height: 100%;
  overflow: hidden;
`;

const Panel = styled.div`
  border-right: 1px solid ${tokens.colors.border.subtle};
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
    background: rgba(108, 92, 231, 0.08);
  }
`;

const CardTitle = styled.div`
  font-family: ${tokens.fonts.body};
  font-size: 0.875rem;
  font-weight: 500;
  color: ${tokens.colors.text.primary};
  margin-bottom: 2px;
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

  &:focus {
    border-color: ${tokens.colors.accent.primary};
  }
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

  &:focus {
    border-color: ${tokens.colors.accent.primary};
  }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const RunningDot = styled.span`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${tokens.colors.accent.secondary};
  animation: ${pulse} 1.5s infinite;
  margin-right: 6px;
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
  width: 720px;
  max-width: 95vw;
  max-height: 85vh;
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

const LogOutput = styled.pre`
  font-family: ${tokens.fonts.mono};
  font-size: 0.75rem;
  color: ${tokens.colors.accent.success};
  background: #060606;
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: ${tokens.spacing.md};
  min-height: 200px;
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
`;

const HyperparamGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${tokens.spacing.sm};
`;

const Row = styled.div`
  display: flex;
  gap: ${tokens.spacing.sm};
  align-items: center;
`;

const UploadInput = styled.input`
  display: none;
`;

const ErrorBox = styled.div`
  background: rgba(255, 82, 82, 0.1);
  border: 1px solid ${tokens.colors.accent.error};
  border-radius: ${tokens.radii.sm};
  padding: ${tokens.spacing.sm};
  font-family: ${tokens.fonts.mono};
  font-size: 0.75rem;
  color: ${tokens.colors.accent.error};
`;

const EmptyState = styled.div`
  color: ${tokens.colors.text.muted};
  font-family: ${tokens.fonts.body};
  font-size: 0.8rem;
  text-align: center;
  padding: ${tokens.spacing.lg};
`;

const RunRow = styled.div<{ $checked?: boolean }>`
  display: flex;
  gap: ${tokens.spacing.sm};
  align-items: flex-start;
  padding: ${tokens.spacing.sm};
  border-radius: ${tokens.radii.sm};
  border: 1px solid ${({ $checked }) => ($checked ? tokens.colors.accent.primary : tokens.colors.border.subtle)};
  background: ${({ $checked }) => ($checked ? 'rgba(108, 92, 231, 0.08)' : tokens.colors.bg.tertiary)};
  cursor: pointer;
  transition: all 0.12s;

  &:hover {
    border-color: ${tokens.colors.accent.primary};
  }
`;

const RunPreview = styled.div`
  flex: 1;
  min-width: 0;
`;

const RunPreviewText = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 0.72rem;
  color: ${tokens.colors.text.secondary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RunPreviewLabel = styled.span`
  font-family: ${tokens.fonts.accent};
  font-size: 0.68rem;
  color: ${tokens.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-right: 4px;
`;

const Checkbox = styled.input`
  margin-top: 2px;
  accent-color: ${tokens.colors.accent.primary};
  flex-shrink: 0;
`;

function getJobBadgeColor(status: string): 'primary' | 'success' | 'error' | 'secondary' | 'warning' {
  switch (status) {
    case 'running': return 'primary';
    case 'completed': return 'success';
    case 'failed': return 'error';
    default: return 'secondary';
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SFTPanel({ projectId }: Props) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [trainingJobs, setTrainingJobs] = useState<TrainingJob[]>([]);
  const [, setOllamaModels] = useState<ModelConfig[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [selectedJob, setSelectedJob] = useState<TrainingJob | null>(null);
  const [showJobModal, setShowJobModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add-from-runs modal
  const [showRunsModal, setShowRunsModal] = useState(false);
  const [runsModalDataset, setRunsModalDataset] = useState<Dataset | null>(null);
  const [inferenceRuns, setInferenceRuns] = useState<InferenceRun[]>([]);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [addingRuns, setAddingRuns] = useState(false);

  // View-dataset modal
  const [viewDataset, setViewDataset] = useState<DatasetWithItems | null>(null);
  const [loadingView, setLoadingView] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Bulk "set system message" modal
  const [bulkSystemDataset, setBulkSystemDataset] = useState<Dataset | null>(null);
  const [bulkSystemMessage, setBulkSystemMessage] = useState('');
  const [bulkSystemOverwrite, setBulkSystemOverwrite] = useState(false);
  const [bulkSystemBusy, setBulkSystemBusy] = useState(false);
  // Project prompts available as starting templates in the bulk modal.
  const [projectPrompts, setProjectPrompts] = useState<Prompt[]>([]);
  const [pickedPromptKey, setPickedPromptKey] = useState('');
  const [pickedPromptSource, setPickedPromptSource] = useState<'system' | 'content' | null>(null);

  // Backend/catalog/artifacts state
  const [sftBackends, setSftBackends] = useState<TrainingBackendInfo[]>([]);
  const [mlxModels, setMlxModels] = useState<MlxModelInfo[]>([]);
  const [hfModels, setHfModels] = useState<HfModelInfo[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);

  // Create dataset form
  const [showDatasetForm, setShowDatasetForm] = useState(false);
  const [dsName, setDsName] = useState('');
  const [dsDesc, setDsDesc] = useState('');
  const [dsFormat, setDsFormat] = useState('jsonl');

  // Create job form
  const [jobName, setJobName] = useState('');
  const [jobModel, setJobModel] = useState('');
  const [jobBackend, setJobBackend] = useState('mlx_lm');
  const [jobEpochs, setJobEpochs] = useState('3');
  const [jobLr, setJobLr] = useState('0.0001');
  const [jobBatchSize, setJobBatchSize] = useState('4');
  const [jobMaxSeqLen, setJobMaxSeqLen] = useState('2048');
  const [jobValSplit, setJobValSplit] = useState('0.1');
  const [jobDatasetId, setJobDatasetId] = useState('');

  useEffect(() => {
    loadData();
    loadCatalogs();
    loadArtifacts();
  }, [projectId]);

  async function loadCatalogs() {
    try {
      const [backends, mlx, hf] = await Promise.all([
        postTrainingApi.listSftBackends(),
        postTrainingApi.listMlxModels(),
        postTrainingApi.listHfModels(),
      ]);
      setSftBackends(backends);
      setMlxModels(mlx);
      setHfModels(hf);
    } catch {}
  }

  async function loadArtifacts() {
    try {
      const arts = await postTrainingApi.listSftArtifacts();
      setArtifacts(arts);
    } catch {}
  }

  async function handleDeleteArtifact(jobId: string) {
    if (!confirm('Delete this artifact folder and all its contents?')) return;
    try {
      await postTrainingApi.deleteSftArtifact(jobId);
      await loadArtifacts();
    } catch {}
  }

  async function loadData() {
    try {
      const [ds, jobs, models] = await Promise.all([
        postTrainingApi.listDatasets(projectId),
        postTrainingApi.listTrainingJobs(projectId),
        modelsApi.list(),
      ]);
      setDatasets(ds);
      setTrainingJobs(jobs);
      setOllamaModels(models.filter((m) => m.provider === 'ollama' && m.is_enabled));
    } catch {
      // silently fail
    }
  }

  async function handleCreateDataset() {
    if (!dsName.trim()) return;
    setLoading(true);
    try {
      await postTrainingApi.createDataset(projectId, {
        name: dsName,
        description: dsDesc || undefined,
        format: dsFormat,
      });
      setDsName('');
      setDsDesc('');
      setShowDatasetForm(false);
      await loadData();
    } catch {
      // handled silently
    }
    setLoading(false);
  }

  async function openViewDataset(dataset: Dataset) {
    setLoadingView(true);
    setExpandedItemId(null);
    try {
      const full = await postTrainingApi.getDataset(projectId, dataset.id);
      setViewDataset(full);
    } catch {
      // ignore
    }
    setLoadingView(false);
  }

  async function handleDeleteItem(itemId: string) {
    if (!viewDataset) return;
    if (!confirm('Delete this item? This cannot be undone.')) return;
    try {
      await postTrainingApi.deleteDatasetItem(projectId, viewDataset.id, itemId);
      setViewDataset({
        ...viewDataset,
        items: viewDataset.items.filter((i) => i.id !== itemId),
        item_count: Math.max(0, viewDataset.item_count - 1),
      });
      await loadData();
    } catch {
      // ignore
    }
  }

  async function handleSaveItemSystem(itemId: string, value: string) {
    if (!viewDataset) return;
    try {
      const updated = await postTrainingApi.updateDatasetItem(
        projectId,
        viewDataset.id,
        itemId,
        // Empty string clears the column, matching the bulk operation's
        // "no system message" semantics.
        { system_message: value.trim() ? value : null },
      );
      setViewDataset({
        ...viewDataset,
        items: viewDataset.items.map((i) => (i.id === itemId ? updated : i)),
      });
    } catch (e) {
      alert((e as Error).message);
    }
  }

  function openBulkSystemModal(dataset: Dataset) {
    setBulkSystemDataset(dataset);
    setBulkSystemMessage('');
    setBulkSystemOverwrite(false);
    setPickedPromptKey('');
    setPickedPromptSource(null);
    // Lazy-load the project's prompts the first time the modal opens. They're
    // small (just a list of versions w/ content + system_message) so a single
    // fetch per panel mount is fine.
    if (projectPrompts.length === 0) {
      promptsApi
        .list(projectId)
        .then(setProjectPrompts)
        .catch(() => {
          // Non-fatal — the user can still type a system message manually.
        });
    }
  }

  function handlePromptPicked(key: string) {
    setPickedPromptKey(key);
    if (!key) {
      setPickedPromptSource(null);
      return;
    }
    const [promptId, versionId] = key.split('::');
    const prompt = projectPrompts.find((p) => p.id === promptId);
    const version = prompt?.versions.find((v) => v.id === versionId);
    if (!version) return;
    const sys = (version.system_message || '').trim();
    if (sys) {
      setBulkSystemMessage(version.system_message || '');
      setPickedPromptSource('system');
    } else {
      setBulkSystemMessage(version.content || '');
      setPickedPromptSource('content');
    }
  }

  async function handleApplyBulkSystem() {
    if (!bulkSystemDataset) return;
    setBulkSystemBusy(true);
    try {
      const result = await postTrainingApi.bulkSetSystemMessage(
        projectId,
        bulkSystemDataset.id,
        bulkSystemMessage.trim() ? bulkSystemMessage : null,
        bulkSystemOverwrite,
      );
      alert(
        `Updated ${result.updated_count} item(s), skipped ${result.skipped_count}` +
        (result.skipped_count > 0 && !bulkSystemOverwrite
          ? '\n\nSkipped items already had a system message. Re-run with "Overwrite existing" to change them.'
          : ''),
      );
      const dsId = bulkSystemDataset.id;
      setBulkSystemDataset(null);
      // Refresh the items modal if it's showing this dataset.
      if (viewDataset?.id === dsId) {
        const refreshed = await postTrainingApi.getDataset(projectId, dsId);
        setViewDataset(refreshed);
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBulkSystemBusy(false);
    }
  }

  async function handleDeleteDataset(dataset: Dataset) {
    if (!confirm(`Delete dataset "${dataset.name}" and all its items? This cannot be undone.`)) return;
    try {
      await postTrainingApi.deleteDataset(projectId, dataset.id);
      if (selectedDataset?.id === dataset.id) setSelectedDataset(null);
      await loadData();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleUploadFile(dataset: Dataset) {
    setSelectedDataset(dataset);
    fileInputRef.current?.click();
  }

  async function handleExportDataset(dataset: Dataset) {
    const choice = prompt(
      `Export "${dataset.name}" as which format?\n\n` +
      `  alpaca   — JSONL { instruction, input, output, system } (default)\n` +
      `  messages — JSONL { messages: [...] } (OpenAI chat / SFTTrainer)\n` +
      `  csv      — CSV with the same columns\n\n` +
      `Type one of: alpaca, messages, csv`,
      'alpaca',
    );
    if (!choice) return;
    const format = choice.trim().toLowerCase() as 'alpaca' | 'messages' | 'csv';
    if (!['alpaca', 'messages', 'csv'].includes(format)) {
      alert(`Unknown format: ${choice}. Use alpaca, messages, or csv.`);
      return;
    }
    try {
      const data = await postTrainingApi.exportDataset(projectId, dataset.id, format);
      const ext = format === 'csv' ? 'csv' : 'jsonl';
      const mime = format === 'csv' ? 'text/csv' : 'application/x-ndjson';
      const safeName = dataset.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const blob = new Blob([String(data)], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}-${format}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleCleanDataset(dataset: Dataset) {
    const stripHtml = confirm(
      `Clean "${dataset.name}"?\n\n` +
      `This will:\n` +
      `• Remove duplicate items (identical instruction+input+output)\n` +
      `• Normalize whitespace (collapse runs, trim lines)\n\n` +
      `OK also strips HTML tags (use for web-scraped KB content).\n` +
      `Cancel leaves HTML alone (default for clean text sources).`
    );
    // Use confirm() result to toggle strip_html; a second confirm starts the clean
    if (!confirm(`Proceed with cleanup${stripHtml ? ' + HTML stripping' : ''}?`)) return;
    try {
      const report = await postTrainingApi.cleanDataset(projectId, dataset.id, {
        dedup: true,
        normalize: true,
        strip_html: stripHtml,
      });
      alert(
        `Cleanup complete for "${dataset.name}":\n` +
        `• Initial: ${report.initial_count} items\n` +
        `• Duplicates removed: ${report.duplicates_removed}\n` +
        `• Items normalized: ${report.normalized_count}\n` +
        `• Final: ${report.final_count} items`
      );
      await loadData();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedDataset) return;
    setLoading(true);
    try {
      await postTrainingApi.uploadDatasetFile(projectId, selectedDataset.id, file);
      await loadData();
    } catch {
      // silently fail
    }
    setLoading(false);
    e.target.value = '';
  }

  async function handleCreateJob() {
    if (!jobName.trim() || !jobModel.trim() || !jobDatasetId) return;
    setLoading(true);
    try {
      await postTrainingApi.createTrainingJob(projectId, {
        project_id: projectId,
        dataset_id: jobDatasetId,
        name: jobName,
        base_model: jobModel,
        backend: jobBackend,
        hyperparams: {
          epochs: Number(jobEpochs),
          lr: Number(jobLr),
          batch_size: Number(jobBatchSize),
          max_seq_length: Number(jobMaxSeqLen),
          val_split: Number(jobValSplit),
        },
      });
      setJobName('');
      setJobModel('');
      await loadData();
    } catch {
      // silently fail
    }
    setLoading(false);
  }

  async function handleStartJob(jobId: string) {
    try {
      const updated = await postTrainingApi.startTrainingJob(projectId, jobId);
      setTrainingJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      if (selectedJob?.id === jobId) setSelectedJob(updated);
    } catch {
      // silently fail
    }
  }

  async function handleStopJob(jobId: string) {
    try {
      const updated = await postTrainingApi.stopTrainingJob(projectId, jobId);
      setTrainingJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      if (selectedJob?.id === jobId) setSelectedJob(updated);
    } catch {
      // silently fail
    }
  }

  async function handleDeleteJob(job: TrainingJob) {
    if (!confirm(`Delete training job "${job.name}"? This cannot be undone.`)) return;
    try {
      await postTrainingApi.deleteTrainingJob(projectId, job.id);
      setTrainingJobs((prev) => prev.filter((j) => j.id !== job.id));
      if (selectedJob?.id === job.id) setSelectedJob(null);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function openRunsModal(dataset: Dataset) {
    setRunsModalDataset(dataset);
    setSelectedRunIds(new Set());
    try {
      const runs = await inferenceApi.history(projectId);
      setInferenceRuns(runs.filter((r) => r.output_text && r.status === 'completed'));
    } catch {
      setInferenceRuns([]);
    }
    setShowRunsModal(true);
  }

  function toggleRunSelection(runId: string) {
    setSelectedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  async function handleAddRunsToDataset() {
    if (!runsModalDataset || selectedRunIds.size === 0) return;
    setAddingRuns(true);
    try {
      const items = inferenceRuns
        .filter((r) => selectedRunIds.has(r.id))
        .map((r) => ({
          input_text: r.input_text,
          output_text: r.output_text!,
        }));
      await postTrainingApi.addDatasetItems(projectId, runsModalDataset.id, items);
      setShowRunsModal(false);
      setSelectedRunIds(new Set());
      await loadData();
    } catch {
      // silently fail
    }
    setAddingRuns(false);
  }

  async function openJobModal(job: TrainingJob) {
    // Refresh the job to get latest logs
    try {
      const fresh = await postTrainingApi.getTrainingJob(projectId, job.id);
      setSelectedJob(fresh);
    } catch {
      setSelectedJob(job);
    }
    setShowJobModal(true);
  }

  return (
    <Layout>
      {/* ── Left: Datasets ── */}
      <Panel>
        <PanelHeader>
          <PanelTitle>Datasets</PanelTitle>
          <Button size="sm" onClick={() => setShowDatasetForm((v) => !v)}>
            {showDatasetForm ? 'Cancel' : '+ New'}
          </Button>
        </PanelHeader>
        <PanelBody>
          {showDatasetForm && (
            <Card $selected>
              <FormGroup>
                <Label>Name</Label>
                <Input
                  value={dsName}
                  onChange={(e) => setDsName(e.target.value)}
                  placeholder="My Dataset"
                />
              </FormGroup>
              <FormGroup style={{ marginTop: 6 }}>
                <Label>Description</Label>
                <Input
                  value={dsDesc}
                  onChange={(e) => setDsDesc(e.target.value)}
                  placeholder="Optional"
                />
              </FormGroup>
              <FormGroup style={{ marginTop: 6 }}>
                <Label>Format</Label>
                <Select value={dsFormat} onChange={(e) => setDsFormat(e.target.value)}>
                  <option value="jsonl">JSONL</option>
                  <option value="csv">CSV</option>
                  <option value="alpaca">Alpaca</option>
                  <option value="chatml">ChatML</option>
                </Select>
              </FormGroup>
              <Button size="sm" style={{ marginTop: 8 }} disabled={loading} onClick={handleCreateDataset}>
                Create
              </Button>
            </Card>
          )}
          {datasets.length === 0 && !showDatasetForm && (
            <EmptyState>No datasets yet. Create one to get started.</EmptyState>
          )}
          {datasets.map((ds) => (
            <Card
              key={ds.id}
              $selected={selectedDataset?.id === ds.id}
              onClick={() => setSelectedDataset(ds)}
            >
              <CardTitle>{ds.name}</CardTitle>
              <CardMeta>
                {ds.item_count} items · {ds.format}
              </CardMeta>
              <Row style={{ marginTop: 6, flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); openViewDataset(ds); }}
                >
                  View Items
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => { e.stopPropagation(); handleUploadFile(ds); }}
                >
                  Upload File
                </Button>
              </Row>
              <Row style={{ marginTop: 6, flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => { e.stopPropagation(); openRunsModal(ds); }}
                >
                  + From Runs
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => { e.stopPropagation(); handleCleanDataset(ds); }}
                  title="Deduplicate + normalize whitespace"
                >
                  Clean
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => { e.stopPropagation(); handleExportDataset(ds); }}
                  title="Download as JSONL or CSV (alpaca / messages / csv)"
                >
                  Export
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => { e.stopPropagation(); openBulkSystemModal(ds); }}
                  title="Set the system message on every item in this dataset"
                >
                  Set System
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={(e) => { e.stopPropagation(); handleDeleteDataset(ds); }}
                >
                  Delete
                </Button>
              </Row>
            </Card>
          ))}
        </PanelBody>
        <UploadInput type="file" ref={fileInputRef} accept=".jsonl,.csv,.json" onChange={handleFileSelected} />
      </Panel>

      {/* ── Center: Create Training Job Form ── */}
      <Panel>
        <PanelHeader>
          <PanelTitle>Create Training Job</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <FormGroup>
            <Label>Job Name</Label>
            <Input
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              placeholder="My fine-tuning run"
            />
          </FormGroup>

          <FormGroup>
            <Label>Dataset</Label>
            <Select value={jobDatasetId} onChange={(e) => setJobDatasetId(e.target.value)}>
              <option value="">Select a dataset...</option>
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name} ({ds.item_count} items)
                </option>
              ))}
            </Select>
          </FormGroup>

          <FormGroup>
            <Label>Backend</Label>
            <Select value={jobBackend} onChange={(e) => { setJobBackend(e.target.value); setJobModel(''); }}>
              {sftBackends.length === 0 && <option value="mlx_lm">mlx_lm (loading...)</option>}
              {sftBackends.map((b) => (
                <option key={b.name} value={b.name} disabled={!b.available}>
                  {b.label} {b.available ? '' : '(not installed)'}
                </option>
              ))}
            </Select>
            {sftBackends.find((b) => b.name === jobBackend) && (
              <CardMeta style={{ marginTop: 4 }}>
                {sftBackends.find((b) => b.name === jobBackend)?.description}
              </CardMeta>
            )}
          </FormGroup>

          <FormGroup>
            <Label>Base Model {jobBackend === 'mlx_lm' ? '(MLX-community HF repos)' : '(HuggingFace)'}</Label>
            <Select value={jobModel} onChange={(e) => setJobModel(e.target.value)}>
              <option value="">Select a base model...</option>
              {(jobBackend === 'mlx_lm' ? mlxModels : hfModels).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
            <CardMeta style={{ marginTop: 4 }}>
              {jobBackend === 'mlx_lm'
                ? 'Curated MLX-community models known to work with mlx_lm.lora. Requires fusion + GGUF conversion for Ollama.'
                : 'Standard HuggingFace models. PEFT produces adapters that fuse + convert cleanly to GGUF for Ollama.'}
            </CardMeta>
          </FormGroup>

          <div style={{ marginTop: 8 }}>
            <Label>Hyperparameters</Label>
            <HyperparamGrid style={{ marginTop: 6 }}>
              <FormGroup>
                <Label>Epochs (1–50)</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={jobEpochs}
                  onChange={(e) => setJobEpochs(e.target.value)}
                />
              </FormGroup>
              <FormGroup>
                <Label>Learning Rate</Label>
                <Input
                  value={jobLr}
                  onChange={(e) => setJobLr(e.target.value)}
                  placeholder="1e-4"
                />
              </FormGroup>
              <FormGroup>
                <Label>Batch Size (1–32)</Label>
                <Input
                  type="number"
                  min={1}
                  max={32}
                  value={jobBatchSize}
                  onChange={(e) => setJobBatchSize(e.target.value)}
                />
              </FormGroup>
              <FormGroup>
                <Label>Max Seq Length</Label>
                <Input
                  type="number"
                  min={128}
                  max={32768}
                  value={jobMaxSeqLen}
                  onChange={(e) => setJobMaxSeqLen(e.target.value)}
                />
              </FormGroup>
              <FormGroup>
                <Label>Val Split (0–0.5)</Label>
                <Input
                  type="number"
                  min={0}
                  max={0.5}
                  step={0.05}
                  value={jobValSplit}
                  onChange={(e) => setJobValSplit(e.target.value)}
                />
              </FormGroup>
            </HyperparamGrid>
          </div>

          <Button
            style={{ marginTop: 12 }}
            disabled={loading || !jobName.trim() || !jobModel.trim() || !jobDatasetId}
            onClick={handleCreateJob}
          >
            Create Job
          </Button>
        </PanelBody>
      </Panel>

      {/* ── Right: Training Jobs ── */}
      <Panel style={{ borderRight: 'none' }}>
        <PanelHeader>
          <PanelTitle>Training Jobs</PanelTitle>
          <Button size="sm" variant="ghost" onClick={loadData}>Refresh</Button>
        </PanelHeader>
        <PanelBody>
          {trainingJobs.length === 0 && (
            <EmptyState>No training jobs yet. Create a job to get started.</EmptyState>
          )}
          {trainingJobs.map((job) => (
            <Card key={job.id} onClick={() => openJobModal(job)}>
              <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <CardTitle>{job.name}</CardTitle>
                <Row style={{ gap: 6 }}>
                  <Badge color={getJobBadgeColor(job.status)}>
                    {job.status === 'running' && <RunningDot />}
                    {job.status}
                  </Badge>
                  <Button
                    size="sm"
                    variant="danger"
                    title={job.status === 'running' ? 'Stop the job before deleting' : 'Delete this training job'}
                    disabled={job.status === 'running'}
                    onClick={(e) => { e.stopPropagation(); handleDeleteJob(job); }}
                    style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                  >
                    Delete
                  </Button>
                </Row>
              </Row>
              <CardMeta>{job.base_model} · {job.backend}</CardMeta>
              {job.error_message && (
                <CardMeta style={{ color: tokens.colors.accent.error, marginTop: 4 }}>
                  {job.error_message.slice(0, 80)}
                </CardMeta>
              )}
            </Card>
          ))}

          {/* ── Artifacts sub-section ── */}
          <div style={{ marginTop: tokens.spacing.lg }}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <PanelTitle style={{ fontSize: '0.72rem' }}>
                Artifacts on disk ({artifacts.length})
              </PanelTitle>
              <Button size="sm" variant="ghost" onClick={loadArtifacts}>Refresh</Button>
            </Row>
            {artifacts.length === 0 && (
              <EmptyState>
                No persisted artifacts. Completed training jobs write adapters to disk here.
              </EmptyState>
            )}
            {artifacts.map((art) => (
              <Card key={art.job_id} style={{ padding: '8px 10px' }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CardMeta style={{
                      fontFamily: tokens.fonts.mono,
                      color: tokens.colors.text.primary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {art.job_id}
                    </CardMeta>
                    <CardMeta>
                      {(art.size_bytes / 1024 / 1024).toFixed(1)} MB
                      {art.adapter_path && ' · adapter ready'}
                    </CardMeta>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleDeleteArtifact(art.job_id)}
                    style={{ fontSize: '0.7rem' }}
                  >
                    Delete
                  </Button>
                </Row>
              </Card>
            ))}
          </div>
        </PanelBody>
      </Panel>

      {/* ── Add from Runs Modal ── */}
      {showRunsModal && runsModalDataset && (
        <ModalOverlay onClick={() => setShowRunsModal(false)}>
          <Modal onClick={(e) => e.stopPropagation()} style={{ width: 640 }}>
            <ModalHeader>
              <ModalTitle>Add Runs to "{runsModalDataset.name}"</ModalTitle>
              <Button size="sm" variant="ghost" onClick={() => setShowRunsModal(false)}>
                Close
              </Button>
            </ModalHeader>
            <ModalBody>
              {inferenceRuns.length === 0 ? (
                <EmptyState>No completed inference runs found in this project.</EmptyState>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.xs ?? '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <CardMeta>{inferenceRuns.length} completed run{inferenceRuns.length !== 1 ? 's' : ''} · {selectedRunIds.size} selected</CardMeta>
                    <Row style={{ gap: 6 }}>
                      <Button size="sm" variant="ghost" onClick={() => setSelectedRunIds(new Set(inferenceRuns.map((r) => r.id)))}>
                        Select All
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSelectedRunIds(new Set())}>
                        Clear
                      </Button>
                    </Row>
                  </div>
                  {inferenceRuns.map((run) => {
                    const checked = selectedRunIds.has(run.id);
                    return (
                      <RunRow key={run.id} $checked={checked} onClick={() => toggleRunSelection(run.id)}>
                        <Checkbox
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRunSelection(run.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <RunPreview>
                          <RunPreviewText>
                            <RunPreviewLabel>In:</RunPreviewLabel>
                            {run.input_text?.slice(0, 120) || '—'}
                          </RunPreviewText>
                          <RunPreviewText style={{ marginTop: 3, color: tokens.colors.accent.success }}>
                            <RunPreviewLabel>Out:</RunPreviewLabel>
                            {run.output_text?.slice(0, 120) || '—'}
                          </RunPreviewText>
                          <RunPreviewText style={{ marginTop: 2 }}>
                            {new Date(run.created_at).toLocaleString()}
                          </RunPreviewText>
                        </RunPreview>
                      </RunRow>
                    );
                  })}
                </div>
              )}
            </ModalBody>
            <div style={{ padding: `${tokens.spacing.sm} ${tokens.spacing.lg}`, borderTop: `1px solid ${tokens.colors.border.subtle}`, display: 'flex', justifyContent: 'flex-end', gap: tokens.spacing.sm }}>
              <Button variant="secondary" onClick={() => setShowRunsModal(false)}>Cancel</Button>
              <Button
                disabled={selectedRunIds.size === 0 || addingRuns}
                onClick={handleAddRunsToDataset}
              >
                {addingRuns ? 'Adding…' : `Add ${selectedRunIds.size} Run${selectedRunIds.size !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </Modal>
        </ModalOverlay>
      )}

      {/* ── Job Detail Modal ── */}
      {showJobModal && selectedJob && (
        <ModalOverlay onClick={() => setShowJobModal(false)}>
          <Modal onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>{selectedJob.name}</ModalTitle>
              <Row style={{ gap: 8 }}>
                <Badge color={getJobBadgeColor(selectedJob.status)}>{selectedJob.status}</Badge>
                {selectedJob.status === 'running' && (
                  <Button size="sm" variant="danger" onClick={() => handleStopJob(selectedJob.id)}>
                    Stop
                  </Button>
                )}
                {(selectedJob.status === 'pending' || selectedJob.status === 'stopped' || selectedJob.status === 'failed') && (
                  <Button size="sm" onClick={() => handleStartJob(selectedJob.id)}>
                    Start
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setShowJobModal(false)}>
                  Close
                </Button>
              </Row>
            </ModalHeader>
            <ModalBody>
              <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacing.md }}>
                <div>
                  <Label>Base Model</Label>
                  <div style={{ color: tokens.colors.text.primary, fontFamily: tokens.fonts.mono, fontSize: '0.85rem', marginTop: 2 }}>
                    {selectedJob.base_model}
                  </div>
                </div>

                {selectedJob.adapter_path && (
                  <div>
                    <Label>Adapter Path</Label>
                    <div style={{ color: tokens.colors.accent.success, fontFamily: tokens.fonts.mono, fontSize: '0.75rem', marginTop: 2 }}>
                      {selectedJob.adapter_path}
                    </div>
                  </div>
                )}

                {selectedJob.error_message && (
                  <ErrorBox>{selectedJob.error_message}</ErrorBox>
                )}

                <LossChart metricsJson={(selectedJob.metrics_json as unknown as string) || null} />

                <div>
                  <Label>Training Log</Label>
                  <LogOutput>
                    {selectedJob.log_text || 'No log output yet...'}
                  </LogOutput>
                </div>
              </div>
            </ModalBody>
          </Modal>
        </ModalOverlay>
      )}

      {/* ── View Dataset Items Modal ── */}
      {viewDataset && (
        <ModalOverlay onClick={() => setViewDataset(null)}>
          <Modal onClick={(e) => e.stopPropagation()} style={{ width: 920, maxWidth: '95vw' }}>
            <ModalHeader>
              <div>
                <ModalTitle>{viewDataset.name}</ModalTitle>
                <CardMeta style={{ marginTop: 4 }}>
                  {viewDataset.items.length} items · {viewDataset.format}
                  {viewDataset.description && ` · ${viewDataset.description}`}
                </CardMeta>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setViewDataset(null)}>
                Close
              </Button>
            </ModalHeader>
            <ModalBody>
              {loadingView ? (
                <EmptyState>Loading items...</EmptyState>
              ) : viewDataset.items.length === 0 ? (
                <EmptyState>
                  This dataset has no items yet. Upload a JSONL/CSV file or add runs to it.
                </EmptyState>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {viewDataset.items.map((item, idx) => {
                    const isExpanded = expandedItemId === item.id;
                    const preview = (item.output_text || item.input_text || item.instruction || '')
                      .slice(0, 120);
                    return (
                      <div
                        key={item.id}
                        style={{
                          border: `1px solid ${tokens.colors.border.subtle}`,
                          borderRadius: tokens.radii.md,
                          background: isExpanded ? 'rgba(108, 92, 231, 0.08)' : tokens.colors.bg.tertiary,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                          style={{
                            padding: '10px 14px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontFamily: tokens.fonts.mono,
                              fontSize: '0.75rem',
                              color: tokens.colors.text.muted,
                              marginBottom: 2,
                            }}>
                              #{idx + 1}
                              {item.tags && <> · tags: {item.tags}</>}
                            </div>
                            <div style={{
                              fontFamily: tokens.fonts.mono,
                              fontSize: '0.78rem',
                              color: tokens.colors.text.primary,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {preview || '(empty)'}
                            </div>
                          </div>
                          <span style={{
                            fontSize: '0.7rem',
                            color: tokens.colors.text.muted,
                          }}>
                            {isExpanded ? '▼' : '▶'}
                          </span>
                        </div>
                        {isExpanded && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              padding: '10px 14px',
                              borderTop: `1px solid ${tokens.colors.border.subtle}`,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 10,
                            }}
                          >
                            <EditableSystemField
                              key={`sysmsg-${item.id}`}
                              value={item.system_message ?? ''}
                              onSave={(value) => handleSaveItemSystem(item.id, value)}
                            />
                            {item.instruction && (
                              <ItemField label="Instruction" value={item.instruction} />
                            )}
                            {item.input_text && (
                              <ItemField label="Input" value={item.input_text} />
                            )}
                            <ItemField label="Output" value={item.output_text} />
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => handleDeleteItem(item.id)}
                                style={{ fontSize: '0.72rem' }}
                              >
                                Delete Item
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ModalBody>
          </Modal>
        </ModalOverlay>
      )}

      {bulkSystemDataset && (
        <ModalOverlay onClick={() => !bulkSystemBusy && setBulkSystemDataset(null)}>
          <Modal onClick={(e) => e.stopPropagation()} style={{ width: 720 }}>
            <ModalHeader>
              <div>
                <ModalTitle>Set system message — {bulkSystemDataset.name}</ModalTitle>
                <CardMeta style={{ marginTop: 4 }}>
                  Applies to {bulkSystemDataset.item_count} item(s) in this dataset.
                </CardMeta>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBulkSystemDataset(null)}
                disabled={bulkSystemBusy}
              >
                Close
              </Button>
            </ModalHeader>
            <ModalBody>
              <FormGroup>
                <Label>Start from a project prompt (optional)</Label>
                <Select
                  value={pickedPromptKey}
                  onChange={(e) => handlePromptPicked(e.target.value)}
                >
                  <option value="">— pick a prompt to prefill the textarea —</option>
                  {projectPrompts.map((p) => {
                    // Sort versions: active first, then highest version_number.
                    const versions = [...p.versions].sort((a, b) => {
                      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
                      return b.version_number - a.version_number;
                    });
                    return (
                      <optgroup key={p.id} label={p.name}>
                        {versions.map((v) => {
                          const hasSys = !!(v.system_message || '').trim();
                          const labelBits = [
                            `v${v.version_number}`,
                            v.label && `"${v.label}"`,
                            v.is_active && 'active',
                            hasSys ? 'has system_message' : 'no system_message → uses content',
                          ].filter(Boolean);
                          return (
                            <option key={v.id} value={`${p.id}::${v.id}`}>
                              {labelBits.join(' · ')}
                            </option>
                          );
                        })}
                      </optgroup>
                    );
                  })}
                </Select>
                {pickedPromptSource && (
                  <CardMeta style={{ marginTop: 4 }}>
                    {pickedPromptSource === 'system'
                      ? 'Filled from the version\'s system_message. Edit below if needed.'
                      : 'No system_message on this version — filled from content instead. Edit below if needed.'}
                  </CardMeta>
                )}
                {projectPrompts.length === 0 && (
                  <CardMeta style={{ marginTop: 4 }}>
                    No prompts found in this project (or still loading). You can still type a system message below.
                  </CardMeta>
                )}
              </FormGroup>
              <FormGroup style={{ marginTop: 12 }}>
                <Label>System message</Label>
                <textarea
                  value={bulkSystemMessage}
                  onChange={(e) => {
                    setBulkSystemMessage(e.target.value);
                    // Manual edit invalidates the "this came from prompt X" hint.
                    if (pickedPromptSource) {
                      setPickedPromptSource(null);
                      setPickedPromptKey('');
                    }
                  }}
                  placeholder="Paste the system prompt all items should use…"
                  rows={14}
                  style={{
                    width: '100%',
                    fontFamily: tokens.fonts.mono,
                    fontSize: '0.78rem',
                    lineHeight: 1.55,
                    color: tokens.colors.text.primary,
                    background: tokens.colors.bg.primary,
                    border: `1px solid ${tokens.colors.border.subtle}`,
                    borderRadius: tokens.radii.sm,
                    padding: '8px 10px',
                    resize: 'vertical',
                    minHeight: 200,
                    maxHeight: 480,
                    boxSizing: 'border-box',
                  }}
                />
                <CardMeta style={{ marginTop: 4 }}>
                  Leave the field empty to clear the system message on all items.
                </CardMeta>
              </FormGroup>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 12,
                  fontSize: '0.85rem',
                  color: tokens.colors.text.primary,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={bulkSystemOverwrite}
                  onChange={(e) => setBulkSystemOverwrite(e.target.checked)}
                />
                Overwrite items that already have a system message
              </label>
              <Row style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setBulkSystemDataset(null)}
                  disabled={bulkSystemBusy}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={handleApplyBulkSystem} disabled={bulkSystemBusy}>
                  {bulkSystemBusy ? 'Applying…' : 'Apply to All Items'}
                </Button>
              </Row>
            </ModalBody>
          </Modal>
        </ModalOverlay>
      )}
    </Layout>
  );
}

// ─── Helper: labeled field for dataset item display ─────────────────────────

function ItemField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{
        fontFamily: tokens.fonts.accent,
        fontSize: '0.65rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        color: tokens.colors.text.muted,
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: tokens.fonts.mono,
        fontSize: '0.78rem',
        lineHeight: 1.55,
        color: tokens.colors.text.primary,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        background: tokens.colors.bg.primary,
        border: `1px solid ${tokens.colors.border.subtle}`,
        borderRadius: tokens.radii.sm,
        padding: '8px 10px',
        maxHeight: 240,
        overflowY: 'auto',
      }}>
        {value}
      </div>
    </div>
  );
}

/**
 * Editable system-message field for a single dataset item.
 *
 * Always rendered (even when the item has no system message yet) so users can
 * add one. Tracks a local draft and only enables Save when the draft differs
 * from the saved value. After saving, the parent re-renders with the new
 * value as `value`, which resets `draft` via the keyed mount.
 */
function EditableSystemField({
  value,
  onSave,
}: {
  value: string;
  onSave: (value: string) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const dirty = draft !== value;

  return (
    <div>
      <div
        style={{
          fontFamily: tokens.fonts.accent,
          fontSize: '0.65rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: tokens.colors.text.muted,
          marginBottom: 4,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>System Message</span>
        {dirty && (
          <span style={{ color: tokens.colors.accent.primary, textTransform: 'none' }}>
            (unsaved)
          </span>
        )}
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="(no system message — type to add one)"
        rows={4}
        style={{
          width: '100%',
          fontFamily: tokens.fonts.mono,
          fontSize: '0.78rem',
          lineHeight: 1.55,
          color: tokens.colors.text.primary,
          background: tokens.colors.bg.primary,
          border: `1px solid ${dirty ? tokens.colors.accent.primary : tokens.colors.border.subtle}`,
          borderRadius: tokens.radii.sm,
          padding: '8px 10px',
          resize: 'vertical',
          minHeight: 60,
          maxHeight: 320,
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDraft(value)}
            disabled={busy}
            style={{ fontSize: '0.72rem' }}
          >
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(draft);
            } finally {
              setBusy(false);
            }
          }}
          disabled={!dirty || busy}
          style={{ fontSize: '0.72rem' }}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
