import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { TopBar } from '../components/layout/TopBar';
import { inputDatasetsApi } from '../api/inputDatasets';
import { modelsApi } from '../api/models';
import type {
  InputDataset,
  InputDatasetItem,
  InputDatasetWithItems,
  ModelConfig,
  PiiModelStatus,
} from '../types';

const Page = styled.div`
  display: grid;
  grid-template-columns: 320px 1fr;
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

const Card = styled.div<{ $selected?: boolean }>`
  padding: 10px 12px;
  background: ${({ $selected }) => $selected ? 'rgba(108, 92, 231, 0.12)' : tokens.colors.bg.tertiary};
  border: 1px solid ${({ $selected }) => $selected ? tokens.colors.accent.primary : tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { border-color: ${tokens.colors.accent.primary}; }
`;

const CardTitle = styled.div`
  font-family: ${tokens.fonts.body};
  font-size: 0.92rem;
  font-weight: 500;
  color: ${tokens.colors.text.primary};
`;

const CardMeta = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 0.7rem;
  color: ${tokens.colors.text.muted};
  margin-top: 3px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
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

const EmptyState = styled.div`
  color: ${tokens.colors.text.muted};
  font-family: ${tokens.fonts.body};
  font-size: 0.82rem;
  text-align: center;
  padding: ${tokens.spacing.lg};
`;

const FileInput = styled.input`
  display: none;
`;

const TabBar = styled.div`
  display: flex;
  gap: 2px;
  padding: 8px 12px;
  background: ${tokens.colors.bg.secondary};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
`;

const Tab = styled.button<{ $active: boolean }>`
  padding: 8px 12px;
  font-family: ${tokens.fonts.accent};
  font-size: 0.72rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${({ $active }) => $active ? tokens.colors.accent.primary : tokens.colors.text.muted};
  background: ${({ $active }) => $active ? 'rgba(108, 92, 231, 0.12)' : 'transparent'};
  border: 1px solid ${({ $active }) => $active ? tokens.colors.accent.primary : 'transparent'};
  border-radius: ${tokens.radii.md};
  cursor: pointer;
  &:hover { color: ${tokens.colors.accent.primary}; }
`;

const DetailBox = styled.div`
  background: ${tokens.colors.bg.primary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  padding: 8px 10px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.76rem;
  color: ${tokens.colors.text.primary};
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
`;

const ErrorText = styled.div`
  color: ${tokens.colors.accent.error};
  font-size: 0.8rem;
  padding: 8px 12px;
`;

type AddTab = 'text' | 'pdf' | 'batch' | 'csv';

export function DatasetsPage() {
  const [datasets, setDatasets] = useState<InputDataset[]>([]);
  const [selected, setSelected] = useState<InputDatasetWithItems | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<InputDataset | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

  const [addTab, setAddTab] = useState<AddTab>('text');
  const [itemName, setItemName] = useState('');
  const [itemTags, setItemTags] = useState('');
  const [itemContent, setItemContent] = useState('');

  const [csvContentColumn, setCsvContentColumn] = useState('');
  const [csvNameColumn, setCsvNameColumn] = useState('');
  const [pdfName, setPdfName] = useState('');
  const [pdfTags, setPdfTags] = useState('');
  const [uploading, setUploading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [evalModelId, setEvalModelId] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [masking, setMasking] = useState(false);
  const [piiModelStatus, setPiiModelStatus] = useState<PiiModelStatus | null>(null);
  const [preloadingPii, setPreloadingPii] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const batchPdfRef = useRef<HTMLInputElement>(null);

  const loadAll = useCallback(async () => {
    try {
      const list = await inputDatasetsApi.list();
      setDatasets(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  const loadSelected = useCallback(async (id: string) => {
    try {
      const full = await inputDatasetsApi.get(id);
      setSelected(full);
      setSelectedId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    modelsApi.list()
      .then((list) => {
        const enabled = list.filter(
          (m) => m.is_enabled && !/embed/i.test(m.model_id) && !/embed/i.test(m.name),
        );
        setModels(enabled);
        if (enabled.length > 0) setEvalModelId((curr) => curr || enabled[0].id);
      })
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    if (selectedId) loadSelected(selectedId);
  }, [selectedId, loadSelected]);

  // Poll while any PDF item is still parsing OR evaluation/masking is running
  useEffect(() => {
    if (!selected) return;
    const hasPending = selected.items.some((it) => it.parse_status === 'pending');
    const isEvaluating = selected.eval_status === 'running';
    const isMasking = selected.mask_status === 'running';
    if (!hasPending && !isEvaluating && !isMasking) return;
    const t = setInterval(() => {
      if (selectedId) loadSelected(selectedId);
    }, 2500);
    return () => clearInterval(t);
  }, [selected, selectedId, loadSelected]);

  // Load PII model status on mount, then poll while preload is running
  useEffect(() => {
    inputDatasetsApi.getPiiModelStatus().then(setPiiModelStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (piiModelStatus?.preload_state !== 'running') return;
    const t = setInterval(() => {
      inputDatasetsApi.getPiiModelStatus().then(setPiiModelStatus).catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [piiModelStatus?.preload_state]);

  async function handleSubmit() {
    if (!name.trim()) return;
    try {
      if (editing) {
        await inputDatasetsApi.update(editing.id, { name, description: desc || undefined });
      } else {
        const created = await inputDatasetsApi.create({ name, description: desc || undefined });
        setSelectedId(created.id);
      }
      setShowForm(false);
      setEditing(null);
      setName('');
      setDesc('');
      await loadAll();
      if (selectedId) await loadSelected(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function handleDelete(ds: InputDataset) {
    if (!confirm(`Delete "${ds.name}" and all its items?`)) return;
    try {
      await inputDatasetsApi.delete(ds.id);
      if (selectedId === ds.id) {
        setSelected(null);
        setSelectedId(null);
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function handleAddText() {
    if (!selected || !itemContent.trim()) return;
    try {
      await inputDatasetsApi.createItem(selected.id, {
        name: itemName.trim() || undefined,
        content: itemContent,
        tags: itemTags.trim() || undefined,
      });
      setItemName('');
      setItemTags('');
      setItemContent('');
      await loadSelected(selected.id);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function handleUploadPdf(file: File) {
    if (!selected) return;
    setUploading(true);
    setError(null);
    try {
      await inputDatasetsApi.uploadPdf(selected.id, file, {
        name: pdfName.trim() || undefined,
        tags: pdfTags.trim() || undefined,
      });
      setPdfName('');
      setPdfTags('');
      await loadSelected(selected.id);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleUploadBatchPdf(files: FileList | null) {
    if (!selected || !files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      await inputDatasetsApi.uploadBatchPdf(selected.id, Array.from(files));
      await loadSelected(selected.id);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleUploadCsv(file: File) {
    if (!selected) return;
    setUploading(true);
    setError(null);
    try {
      await inputDatasetsApi.uploadCsv(selected.id, file, {
        contentColumn: csvContentColumn.trim() || undefined,
        nameColumn: csvNameColumn.trim() || undefined,
      });
      await loadSelected(selected.id);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteItem(item: InputDatasetItem) {
    if (!selected) return;
    if (!confirm(`Delete item "${item.name || item.content.slice(0, 40)}"?`)) return;
    try {
      await inputDatasetsApi.deleteItem(selected.id, item.id);
      await loadSelected(selected.id);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function handleRetryPending() {
    setRetrying(true);
    setError(null);
    try {
      const result = await inputDatasetsApi.retryPending();
      if (result.retried_count > 0) {
        await loadAll();
        if (selectedId) await loadSelected(selectedId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }

  async function handleEvaluateQuality() {
    if (!selected || !evalModelId) return;
    setEvaluating(true);
    setError(null);
    try {
      await inputDatasetsApi.evaluateQuality(selected.id, evalModelId);
      // Refresh immediately so eval_status='running' propagates and polling kicks in
      if (selectedId) await loadSelected(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evaluation failed');
    } finally {
      setEvaluating(false);
    }
  }

  async function handlePreloadPiiModel() {
    setPreloadingPii(true);
    try {
      const status = await inputDatasetsApi.preloadPiiModel();
      setPiiModelStatus(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preload failed');
    } finally {
      setPreloadingPii(false);
    }
  }

  async function handleMaskPii() {
    if (!selected) return;
    setMasking(true);
    setError(null);
    try {
      await inputDatasetsApi.maskPii(selected.id);
      if (selectedId) await loadSelected(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PII masking failed');
    } finally {
      setMasking(false);
    }
  }

  function openEdit(ds: InputDataset) {
    setEditing(ds);
    setName(ds.name);
    setDesc(ds.description || '');
    setShowForm(true);
  }

  function openCreate() {
    setEditing(null);
    setName('');
    setDesc('');
    setShowForm(true);
  }

  return (
    <>
      <TopBar title="Datasets" />
      <Page>
        <Panel>
          <PanelHeader>
            <PanelTitle>Datasets ({datasets.length})</PanelTitle>
            <Button size="sm" onClick={openCreate}>+ New</Button>
          </PanelHeader>
          <PanelBody>
            {error && <ErrorText>{error}</ErrorText>}

            {showForm && (
              <Card $selected>
                <CardTitle style={{ marginBottom: 8 }}>
                  {editing ? 'Edit Dataset' : 'New Dataset'}
                </CardTitle>
                <FormGroup>
                  <Label>Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Evaluation cases — classification"
                    autoFocus
                  />
                </FormGroup>
                <FormGroup>
                  <Label>Description</Label>
                  <Textarea
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder="What's in this dataset?"
                  />
                </FormGroup>
                <Row>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setShowForm(false); setEditing(null); }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSubmit} disabled={!name.trim()}>
                    {editing ? 'Save' : 'Create'}
                  </Button>
                </Row>
              </Card>
            )}

            {datasets.length === 0 && !showForm && (
              <EmptyState>No datasets yet.<br />Create one to get started.</EmptyState>
            )}

            {datasets.map((ds) => (
              <Card
                key={ds.id}
                $selected={selectedId === ds.id}
                onClick={() => setSelectedId(ds.id)}
              >
                <Row>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CardTitle>{ds.name}</CardTitle>
                    <CardMeta>{ds.item_count} items</CardMeta>
                    {ds.description && (
                      <CardMeta style={{ color: tokens.colors.text.secondary, marginTop: 2 }}>
                        {ds.description.slice(0, 60)}
                        {ds.description.length > 60 ? '...' : ''}
                      </CardMeta>
                    )}
                  </div>
                </Row>
                <Row style={{ marginTop: 6 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); openEdit(ds); }}
                    style={{ fontSize: '0.7rem' }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={(e) => { e.stopPropagation(); handleDelete(ds); }}
                    style={{ fontSize: '0.7rem' }}
                  >
                    Delete
                  </Button>
                </Row>
              </Card>
            ))}
          </PanelBody>
        </Panel>

        <Panel>
          {!selected ? (
            <PanelBody>
              <EmptyState>Select a dataset on the left, or create a new one.</EmptyState>
            </PanelBody>
          ) : (
            <>
              <PanelHeader>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <PanelTitle>{selected.name}</PanelTitle>
                  <CardMeta style={{ marginTop: 2 }}>
                    {selected.items.length} items
                    {selected.description && ` · ${selected.description}`}
                  </CardMeta>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {selected.items.some((it) => it.parse_status === 'pending') && (
                    <Button size="sm" variant="primary" onClick={handleRetryPending} disabled={retrying}>
                      {retrying ? 'Resuming...' : 'Resume'}
                    </Button>
                  )}
                  {!selected.items.some((it) => it.parse_status === 'pending') && selected.items.some((it) => it.parse_status === 'ready') && (() => {
                    const isEvalRunning = selected.eval_status === 'running' || evaluating;
                    const isMaskRunning = selected.mask_status === 'running' || masking;
                    const isAnyRunning = isEvalRunning || isMaskRunning;
                    const total = selected.items.filter((it) => it.parse_status === 'ready').length;
                    const evalDone = selected.items.filter((it) => it.parse_status === 'ready' && it.quality_status !== 'unchecked').length;
                    const maskDone = selected.items.filter((it) => it.parse_status === 'ready' && it.pii_status !== 'unchecked').length;
                    const piiLoaded = piiModelStatus?.loaded ?? false;
                    const piiPreloading = piiModelStatus?.preload_state === 'running' || preloadingPii;
                    const piiError = piiModelStatus?.preload_state === 'error';
                    return (
                      <>
                        {selected.items.some((it) => it.source_type === 'pdf') && (
                          <>
                            <select
                              value={evalModelId}
                              onChange={(e) => setEvalModelId(e.target.value)}
                              disabled={isAnyRunning}
                              style={{
                                background: tokens.colors.bg.tertiary,
                                color: tokens.colors.text.primary,
                                border: `1px solid ${tokens.colors.border.subtle}`,
                                borderRadius: tokens.radii.sm,
                                padding: '6px 8px',
                                fontSize: '0.78rem',
                                fontFamily: tokens.fonts.mono,
                                maxWidth: 220,
                                opacity: isAnyRunning ? 0.5 : 1,
                              }}
                            >
                              {models.length === 0 && <option value="">No models</option>}
                              {models.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={handleEvaluateQuality}
                              disabled={isAnyRunning || !evalModelId}
                            >
                              {isEvalRunning ? `Evaluating (${evalDone}/${total})` : 'Evaluate Quality'}
                            </Button>
                          </>
                        )}
                        {/* PII masking — uses fixed local model, gated on preload */}
                        {!piiLoaded && !piiPreloading && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handlePreloadPiiModel}
                            title="Download and load the privacy-filter model (~2.8 GB)"
                          >
                            {piiError ? 'Retry PII Model' : 'Load PII Model'}
                          </Button>
                        )}
                        {piiPreloading && (
                          <span style={{ fontSize: '0.78rem', color: tokens.colors.text.muted, fontFamily: tokens.fonts.mono }}>
                            Loading PII model…
                          </span>
                        )}
                        {piiLoaded && (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={handleMaskPii}
                            disabled={isAnyRunning}
                          >
                            {isMaskRunning ? `Masking PII (${maskDone}/${total})` : 'Mask PII'}
                          </Button>
                        )}
                      </>
                    );
                  })()}
                  <Button size="sm" variant="ghost" onClick={() => loadSelected(selected.id)}>
                    Refresh
                  </Button>
                </div>
              </PanelHeader>

              <TabBar>
                <Tab $active={addTab === 'text'} onClick={() => setAddTab('text')}>+ Text Item</Tab>
                <Tab $active={addTab === 'pdf'} onClick={() => setAddTab('pdf')}>+ PDF</Tab>
                <Tab $active={addTab === 'batch'} onClick={() => setAddTab('batch')}>+ Batch PDF</Tab>
                <Tab $active={addTab === 'csv'} onClick={() => setAddTab('csv')}>+ CSV</Tab>
              </TabBar>

              <PanelBody>
                {addTab === 'text' && (
                  <Card style={{ cursor: 'default' }}>
                    <FormGroup>
                      <Label>Name (optional)</Label>
                      <Input
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                        placeholder="Short label"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>Tags (optional, comma-separated)</Label>
                      <Input
                        value={itemTags}
                        onChange={(e) => setItemTags(e.target.value)}
                        placeholder="e.g. edge-case, happy-path"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>Content</Label>
                      <Textarea
                        value={itemContent}
                        onChange={(e) => setItemContent(e.target.value)}
                        placeholder="The input text..."
                        style={{ minHeight: 120 }}
                      />
                    </FormGroup>
                    <Row>
                      <div />
                      <Button
                        size="sm"
                        onClick={handleAddText}
                        disabled={!itemContent.trim()}
                      >
                        Add Item
                      </Button>
                    </Row>
                  </Card>
                )}

                {addTab === 'pdf' && (
                  <Card style={{ cursor: 'default' }}>
                    <FormGroup>
                      <Label>Name (optional — defaults to filename)</Label>
                      <Input
                        value={pdfName}
                        onChange={(e) => setPdfName(e.target.value)}
                        placeholder="Short label"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>Tags (optional)</Label>
                      <Input
                        value={pdfTags}
                        onChange={(e) => setPdfTags(e.target.value)}
                        placeholder="e.g. medical, cms"
                      />
                    </FormGroup>
                    <FileInput
                      ref={pdfRef}
                      type="file"
                      accept=".pdf"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadPdf(f);
                        e.target.value = '';
                      }}
                    />
                    <Button
                      disabled={uploading}
                      onClick={() => pdfRef.current?.click()}
                    >
                      {uploading ? 'Uploading...' : 'Choose PDF...'}
                    </Button>
                    <CardMeta style={{ marginTop: 6 }}>
                      The file returns immediately; docling parse runs in the background.
                      Item shows <code>parse: pending</code> until ready.
                    </CardMeta>
                  </Card>
                )}

                {addTab === 'batch' && (
                  <Card style={{ cursor: 'default' }}>
                    <FileInput
                      ref={batchPdfRef}
                      type="file"
                      accept=".pdf"
                      multiple
                      onChange={(e) => {
                        handleUploadBatchPdf(e.target.files);
                        e.target.value = '';
                      }}
                    />
                    <Button
                      disabled={uploading}
                      onClick={() => batchPdfRef.current?.click()}
                    >
                      {uploading ? 'Uploading...' : 'Choose Multiple PDFs...'}
                    </Button>
                    <CardMeta style={{ marginTop: 6 }}>
                      One item per PDF (filename becomes the name). Parses run in the background sequentially.
                    </CardMeta>
                  </Card>
                )}

                {addTab === 'csv' && (
                  <Card style={{ cursor: 'default' }}>
                    <FormGroup>
                      <Label>Content column (optional)</Label>
                      <Input
                        value={csvContentColumn}
                        onChange={(e) => setCsvContentColumn(e.target.value)}
                        placeholder="Defaults to content/text/input/prompt or first column"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>Name column (optional)</Label>
                      <Input
                        value={csvNameColumn}
                        onChange={(e) => setCsvNameColumn(e.target.value)}
                        placeholder="Defaults to 'name' column"
                      />
                    </FormGroup>
                    <FileInput
                      ref={csvRef}
                      type="file"
                      accept=".csv"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadCsv(f);
                        e.target.value = '';
                      }}
                    />
                    <Button
                      disabled={uploading}
                      onClick={() => csvRef.current?.click()}
                    >
                      {uploading ? 'Uploading...' : 'Choose CSV...'}
                    </Button>
                    <CardMeta style={{ marginTop: 6 }}>
                      Non-content columns become per-row metadata.
                    </CardMeta>
                  </Card>
                )}

                <div style={{ marginTop: tokens.spacing.lg }}>
                  <PanelTitle style={{ fontSize: '0.72rem', marginBottom: 10 }}>
                    Items
                  </PanelTitle>
                  {selected.items.length === 0 && (
                    <EmptyState>No items yet.</EmptyState>
                  )}
                  {selected.items.map((item) => {
                    const isOpen = expandedItemId === item.id;
                    const label = item.name || item.content.slice(0, 60);
                    return (
                      <Card
                        key={item.id}
                        $selected={isOpen}
                        onClick={() => setExpandedItemId(isOpen ? null : item.id)}
                      >
                        <Row>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <CardTitle>
                              <span style={{ marginRight: 6, opacity: 0.5, fontSize: '0.7rem' }}>
                                {isOpen ? '▼' : '▶'}
                              </span>
                              {label}
                              {label.length >= 60 && '…'}
                            </CardTitle>
                            <CardMeta>
                              <Badge
                                color={
                                  item.source_type === 'pdf' ? 'primary'
                                  : item.source_type === 'csv_row' ? 'warning'
                                  : 'secondary'
                                }
                              >
                                {item.source_type}
                              </Badge>
                              {item.parse_status && item.parse_status !== 'ready' && (
                                <>
                                  {' '}
                                  <Badge
                                    color={
                                      item.parse_status === 'failed' ? 'error'
                                      : item.parse_status === 'pending' ? 'warning'
                                      : 'secondary'
                                    }
                                  >
                                    parse: {item.parse_status}
                                  </Badge>
                                </>
                              )}
                              {item.quality_status === 'good' && (
                                <>
                                  {' '}
                                  <Badge color="success" title={item.quality_reason || ''}>
                                    good
                                  </Badge>
                                </>
                              )}
                              {item.quality_status === 'bad' && (
                                <>
                                  {' '}
                                  <Badge color="warning" title={item.quality_reason || ''}>
                                    bad quality
                                  </Badge>
                                </>
                              )}
                              {item.quality_status === 'trash' && (
                                <>
                                  {' '}
                                  <Badge color="error" title={item.quality_reason || ''}>
                                    trash
                                  </Badge>
                                </>
                              )}
                              {(item.pii_status === 'clean' || item.pii_status === 'masked') && (
                                <> {' '}<Badge color="success" title={item.pii_status === 'masked' ? 'PII found and masked' : 'No PII detected'}>safe</Badge></>
                              )}
                              {item.pii_status === 'masked' && (
                                <> {' '}<Badge color="warning" title="Original content contains PII — view masked version below">PII masked</Badge></>
                              )}
                              {item.tags && <> {' '}<Badge color="secondary">{item.tags}</Badge></>}
                              {' · '}{item.content.length.toLocaleString()} chars
                              {item.file_size_bytes && (
                                <> · {(item.file_size_bytes / 1024).toFixed(1)} KB</>
                              )}
                              {item.source_filename && ` · ${item.source_filename}`}
                            </CardMeta>
                          </div>
                        </Row>
                        {isOpen && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
                          >
                            {item.metadata_json && (
                              <div>
                                <Label>Metadata</Label>
                                <DetailBox>{item.metadata_json}</DetailBox>
                              </div>
                            )}
                            {item.parse_error && (
                              <div>
                                <Label>Parse Error</Label>
                                <DetailBox style={{ color: tokens.colors.accent.error }}>
                                  {item.parse_error}
                                </DetailBox>
                              </div>
                            )}
                            {item.quality_reason && item.quality_status !== 'unchecked' && (
                              <div>
                                <Label>Quality Evaluation ({item.quality_status})</Label>
                                <DetailBox
                                  style={{
                                    color: item.quality_status === 'bad'
                                      ? tokens.colors.accent.error
                                      : tokens.colors.text.primary,
                                  }}
                                >
                                  {item.quality_reason}
                                </DetailBox>
                              </div>
                            )}
                            {item.pii_status === 'masked' && item.pii_masked_content && (
                              <div>
                                <Label>Masked Content (PII replaced)</Label>
                                <DetailBox style={{ borderColor: tokens.colors.accent.warning }}>
                                  {item.pii_masked_content}
                                </DetailBox>
                              </div>
                            )}
                            <div>
                              <Label>
                                {item.pii_status === 'masked' ? 'Original Content (contains PII)' : 'Content'}
                              </Label>
                              <DetailBox>
                                {item.parse_status === 'pending' && !item.content
                                  ? '(parsing…)'
                                  : item.content}
                              </DetailBox>
                            </div>
                            <Row>
                              <CardMeta>
                                Created: {new Date(item.created_at).toLocaleString()}
                              </CardMeta>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => handleDeleteItem(item)}
                                style={{ fontSize: '0.72rem' }}
                              >
                                Delete Item
                              </Button>
                            </Row>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </PanelBody>
            </>
          )}
        </Panel>
      </Page>
    </>
  );
}
