import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { postTrainingApi } from '../api/postTraining';
import type {
  ArtifactInfo,
  FusionArtifactInfo,
  FusionJob,
  HfModelInfo,
  MlxModelInfo,
  TrainingBackendInfo,
} from '../types';

const Page = styled.div`
  display: grid;
  grid-template-columns: 420px 1fr;
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

const CheckRow = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: ${tokens.fonts.body};
  font-size: 0.85rem;
  color: ${tokens.colors.text.secondary};
  cursor: pointer;
  margin-bottom: 8px;
`;

const Card = styled.div`
  padding: 10px 12px;
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  margin-bottom: 8px;
`;

const CardTitle = styled.div`
  font-family: ${tokens.fonts.body};
  font-size: 0.88rem;
  font-weight: 500;
  color: ${tokens.colors.text.primary};
`;

const CardMeta = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 0.72rem;
  color: ${tokens.colors.text.muted};
  margin-top: 3px;
`;

const EmptyState = styled.div`
  color: ${tokens.colors.text.muted};
  font-family: ${tokens.fonts.body};
  font-size: 0.82rem;
  text-align: center;
  padding: ${tokens.spacing.lg};
`;

const LogBox = styled.pre`
  background: ${tokens.colors.bg.primary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  padding: 10px 12px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.72rem;
  color: ${tokens.colors.text.primary};
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
  margin-top: 8px;
`;

const Section = styled.div`
  margin-top: ${tokens.spacing.lg};
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
`;

function badgeColorForStatus(status: string): 'primary' | 'success' | 'error' | 'secondary' {
  switch (status) {
    case 'running': return 'primary';
    case 'completed': return 'success';
    case 'failed': return 'error';
    default: return 'secondary';
  }
}

export function ModelFusionPage() {
  // Catalog
  const [fusionBackends, setFusionBackends] = useState<TrainingBackendInfo[]>([]);
  const [tools, setTools] = useState<{ ollama: boolean; mlx_fuse: boolean; peft_fuse: boolean } | null>(null);
  const [mlxModels, setMlxModels] = useState<MlxModelInfo[]>([]);
  const [hfModels, setHfModels] = useState<HfModelInfo[]>([]);
  const [sftArtifacts, setSftArtifacts] = useState<ArtifactInfo[]>([]);

  // Jobs & outputs
  const [fusionJobs, setFusionJobs] = useState<FusionJob[]>([]);
  const [fusionArtifacts, setFusionArtifacts] = useState<FusionArtifactInfo[]>([]);
  const [selectedJob, setSelectedJob] = useState<FusionJob | null>(null);

  // Form
  const [name, setName] = useState('');
  const [backend, setBackend] = useState<'mlx_lm' | 'peft'>('mlx_lm');
  const [baseModel, setBaseModel] = useState('');
  const [adapterPath, setAdapterPath] = useState('');
  const [sourceJobId, setSourceJobId] = useState('');
  const [convertGguf, setConvertGguf] = useState(false);
  const [registerOllama, setRegisterOllama] = useState(false);
  const [ollamaName, setOllamaName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [b, t, m, h, s, j, a] = await Promise.all([
        postTrainingApi.listFusionBackends(),
        postTrainingApi.listFusionTools(),
        postTrainingApi.listMlxModels(),
        postTrainingApi.listHfModels(),
        postTrainingApi.listSftArtifacts(),
        postTrainingApi.listFusionJobs(),
        postTrainingApi.listFusionArtifacts(),
      ]);
      setFusionBackends(b);
      setTools(t);
      setMlxModels(m);
      setHfModels(h);
      setSftArtifacts(s);
      setFusionJobs(j);
      setFusionArtifacts(a);
    } catch {}
  }, []);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 5000);
    return () => clearInterval(interval);
  }, [loadAll]);

  // When the user picks a source job, auto-fill adapter_path
  useEffect(() => {
    if (!sourceJobId) return;
    const art = sftArtifacts.find((a) => a.job_id === sourceJobId);
    if (art && art.adapter_path) setAdapterPath(art.adapter_path);
  }, [sourceJobId, sftArtifacts]);

  const baseModelOptions = backend === 'mlx_lm' ? mlxModels : hfModels;

  const canSubmit = name.trim() && baseModel && adapterPath && !submitting &&
    (!registerOllama || (convertGguf && ollamaName.trim()));

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await postTrainingApi.createFusionJob({
        name: name.trim(),
        backend,
        base_model: baseModel,
        adapter_path: adapterPath,
        source_job_id: sourceJobId || undefined,
        convert_to_gguf: convertGguf,
        register_with_ollama: registerOllama,
        ollama_name: ollamaName.trim() || undefined,
      });
      setName('');
      setAdapterPath('');
      setSourceJobId('');
      setConvertGguf(false);
      setRegisterOllama(false);
      setOllamaName('');
      await loadAll();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteJob(id: string) {
    if (!confirm('Delete this fusion job record? Artifact files are kept.')) return;
    try {
      await postTrainingApi.deleteFusionJob(id);
      if (selectedJob?.id === id) setSelectedJob(null);
      await loadAll();
    } catch {}
  }

  async function handleDeleteArtifact(id: string) {
    if (!confirm('Delete all files for this fusion artifact?')) return;
    try {
      await postTrainingApi.deleteFusionArtifact(id);
      await loadAll();
    } catch {}
  }

  return (
    <Page>
      {/* ── Left: form ── */}
      <Panel>
        <PanelHeader>
          <PanelTitle>New Fusion Job</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <FormGroup>
            <Label>Job Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-model-fusion-v1"
            />
          </FormGroup>

          <FormGroup>
            <Label>Backend</Label>
            <Select
              value={backend}
              onChange={(e) => { setBackend(e.target.value as 'mlx_lm' | 'peft'); setBaseModel(''); }}
            >
              {fusionBackends.map((b) => (
                <option key={b.name} value={b.name} disabled={!b.available}>
                  {b.label} {b.available ? '' : '(not installed)'}
                </option>
              ))}
            </Select>
            {fusionBackends.find((b) => b.name === backend) && (
              <CardMeta>{fusionBackends.find((b) => b.name === backend)?.description}</CardMeta>
            )}
          </FormGroup>

          <FormGroup>
            <Label>Base Model</Label>
            <Select value={baseModel} onChange={(e) => setBaseModel(e.target.value)}>
              <option value="">Select a base model...</option>
              {baseModelOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </FormGroup>

          <FormGroup>
            <Label>Adapter from training job (auto-fills path)</Label>
            <Select value={sourceJobId} onChange={(e) => setSourceJobId(e.target.value)}>
              <option value="">— or enter path manually —</option>
              {sftArtifacts.filter(a => a.adapter_path).map((a) => (
                <option key={a.job_id} value={a.job_id}>
                  {a.job_id.slice(0, 8)} · {(a.size_bytes / 1024 / 1024).toFixed(1)} MB
                </option>
              ))}
            </Select>
          </FormGroup>

          <FormGroup>
            <Label>Adapter Path</Label>
            <Input
              value={adapterPath}
              onChange={(e) => setAdapterPath(e.target.value)}
              placeholder="/path/to/adapter"
            />
          </FormGroup>

          <CheckRow>
            <input
              type="checkbox"
              checked={convertGguf}
              onChange={(e) => { setConvertGguf(e.target.checked); if (!e.target.checked) setRegisterOllama(false); }}
            />
            Convert fused model to GGUF
            {!tools?.mlx_fuse && !tools?.peft_fuse && (
              <span style={{ fontSize: '0.7rem', color: tokens.colors.accent.warning }}>
                — fuse tooling missing
              </span>
            )}
          </CheckRow>

          <CheckRow>
            <input
              type="checkbox"
              checked={registerOllama}
              disabled={!convertGguf}
              onChange={(e) => setRegisterOllama(e.target.checked)}
            />
            Register with Ollama (ollama create)
            {!tools?.ollama && (
              <span style={{ fontSize: '0.7rem', color: tokens.colors.accent.warning }}>
                — ollama CLI missing
              </span>
            )}
          </CheckRow>

          {registerOllama && (
            <FormGroup>
              <Label>Ollama Model Name</Label>
              <Input
                value={ollamaName}
                onChange={(e) => setOllamaName(e.target.value)}
                placeholder="my-finetuned-model"
              />
            </FormGroup>
          )}

          {submitError && (
            <div style={{ color: tokens.colors.accent.error, fontSize: '0.8rem', marginBottom: 8 }}>
              {submitError}
            </div>
          )}

          <Button disabled={!canSubmit} onClick={handleSubmit}>
            {submitting ? 'Starting...' : 'Start Fusion'}
          </Button>

          <Section>
            <PanelTitle style={{ fontSize: '0.7rem', marginBottom: 8 }}>
              Fusion Artifacts on Disk ({fusionArtifacts.length})
            </PanelTitle>
            {fusionArtifacts.length === 0 && (
              <EmptyState>No fusion artifacts yet.</EmptyState>
            )}
            {fusionArtifacts.map((a) => (
              <Card key={a.fusion_id}>
                <Row>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CardMeta style={{ color: tokens.colors.text.primary }}>
                      {a.fusion_id}
                    </CardMeta>
                    <CardMeta>{(a.size_bytes / 1024 / 1024).toFixed(1)} MB</CardMeta>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleDeleteArtifact(a.fusion_id)}
                    style={{ fontSize: '0.7rem' }}
                  >
                    Delete
                  </Button>
                </Row>
              </Card>
            ))}
          </Section>
        </PanelBody>
      </Panel>

      {/* ── Right: jobs + detail ── */}
      <Panel>
        <PanelHeader>
          <PanelTitle>Fusion Jobs ({fusionJobs.length})</PanelTitle>
          <Button size="sm" variant="ghost" onClick={loadAll}>Refresh</Button>
        </PanelHeader>
        <PanelBody>
          {fusionJobs.length === 0 && (
            <EmptyState>No fusion jobs yet. Start one on the left.</EmptyState>
          )}
          {fusionJobs.map((job) => (
            <Card
              key={job.id}
              style={{
                cursor: 'pointer',
                borderColor: selectedJob?.id === job.id
                  ? tokens.colors.accent.primary
                  : tokens.colors.border.subtle,
              }}
              onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}
            >
              <Row style={{ marginBottom: 4 }}>
                <CardTitle>{job.name}</CardTitle>
                <Row style={{ gap: 6, flex: 'none' }}>
                  <Badge color={badgeColorForStatus(job.status)}>{job.status}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); handleDeleteJob(job.id); }}
                    style={{ padding: '2px 6px', color: tokens.colors.accent.error, fontSize: '0.72rem' }}
                  >
                    ✕
                  </Button>
                </Row>
              </Row>
              <CardMeta>
                {job.backend} · base: {job.base_model}
                {job.convert_to_gguf && ' · GGUF'}
                {job.register_with_ollama && ` · ollama:${job.ollama_name}`}
              </CardMeta>
              {selectedJob?.id === job.id && (
                <>
                  <Section>
                    {job.merged_path && (
                      <CardMeta>merged: <code>{job.merged_path}</code></CardMeta>
                    )}
                    {job.gguf_path && (
                      <CardMeta>gguf: <code>{job.gguf_path}</code></CardMeta>
                    )}
                    {job.error_message && (
                      <CardMeta style={{ color: tokens.colors.accent.error }}>
                        {job.error_message}
                      </CardMeta>
                    )}
                    <LogBox>{job.log_text || '(no log output yet)'}</LogBox>
                  </Section>
                </>
              )}
            </Card>
          ))}
        </PanelBody>
      </Panel>
    </Page>
  );
}
