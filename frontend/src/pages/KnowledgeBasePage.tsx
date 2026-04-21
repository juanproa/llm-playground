import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { TopBar } from '../components/layout/TopBar';
import { knowledgeBaseApi } from '../api/knowledgeBase';
import type {
  KnowledgeBase,
  KnowledgeBaseItem,
  KnowledgeBaseWithItems,
} from '../types';

/* ── Layout ── */

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

/* ── Cards ── */

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

/* ── Forms ── */

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

/* ── Component ── */

type AddTab = 'text' | 'pdf' | 'batch' | 'csv';

export function KnowledgeBasePage() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [selected, setSelected] = useState<KnowledgeBaseWithItems | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create/Edit KB form
  const [showKbForm, setShowKbForm] = useState(false);
  const [editingKb, setEditingKb] = useState<KnowledgeBase | null>(null);
  const [kbName, setKbName] = useState('');
  const [kbDesc, setKbDesc] = useState('');

  // Add-item tabs
  const [addTab, setAddTab] = useState<AddTab>('text');

  // Text item form
  const [itemName, setItemName] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemContent, setItemContent] = useState('');

  // PDF uploads
  const [pdfDesc, setPdfDesc] = useState('');
  const [uploading, setUploading] = useState(false);
  const singleFileRef = useRef<HTMLInputElement>(null);
  const batchFileRef = useRef<HTMLInputElement>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);

  const loadKbs = useCallback(async () => {
    try {
      const list = await knowledgeBaseApi.list();
      setKbs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  const loadSelected = useCallback(async (id: string) => {
    try {
      const full = await knowledgeBaseApi.get(id);
      setSelected(full);
      setSelectedId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load KB');
    }
  }, []);

  useEffect(() => {
    loadKbs();
  }, [loadKbs]);

  useEffect(() => {
    if (selectedId) loadSelected(selectedId);
  }, [selectedId, loadSelected]);

  /* ── KB CRUD ── */

  async function handleSubmitKb() {
    if (!kbName.trim()) return;
    try {
      if (editingKb) {
        await knowledgeBaseApi.update(editingKb.id, { name: kbName, description: kbDesc || undefined });
      } else {
        const created = await knowledgeBaseApi.create({ name: kbName, description: kbDesc || undefined });
        setSelectedId(created.id);
      }
      setShowKbForm(false);
      setEditingKb(null);
      setKbName('');
      setKbDesc('');
      await loadKbs();
      if (selectedId) await loadSelected(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function handleDeleteKb(kb: KnowledgeBase) {
    if (!confirm(`Delete "${kb.name}" and all its items? This cannot be undone.`)) return;
    try {
      await knowledgeBaseApi.delete(kb.id);
      if (selectedId === kb.id) {
        setSelected(null);
        setSelectedId(null);
      }
      await loadKbs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  function openEditKb(kb: KnowledgeBase) {
    setEditingKb(kb);
    setKbName(kb.name);
    setKbDesc(kb.description || '');
    setShowKbForm(true);
  }

  function openCreateKb() {
    setEditingKb(null);
    setKbName('');
    setKbDesc('');
    setShowKbForm(true);
  }

  /* ── Item operations ── */

  async function handleAddText() {
    if (!selected || !itemName.trim() || !itemContent.trim()) return;
    try {
      await knowledgeBaseApi.createItem(selected.id, {
        name: itemName,
        description: itemDesc || undefined,
        content: itemContent,
        source_type: 'text',
      });
      setItemName('');
      setItemDesc('');
      setItemContent('');
      await loadSelected(selected.id);
      await loadKbs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function handleUploadPdf(file: File) {
    if (!selected) return;
    setUploading(true);
    setError(null);
    try {
      await knowledgeBaseApi.uploadPdf(selected.id, file, pdfDesc || undefined);
      setPdfDesc('');
      await loadSelected(selected.id);
      await loadKbs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleUploadBatch(files: FileList | null) {
    if (!selected || !files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      await knowledgeBaseApi.uploadBatchPdf(selected.id, Array.from(files));
      await loadSelected(selected.id);
      await loadKbs();
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
      await knowledgeBaseApi.uploadCsv(selected.id, file);
      await loadSelected(selected.id);
      await loadKbs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteItem(item: KnowledgeBaseItem) {
    if (!selected) return;
    if (!confirm(`Delete item "${item.name}"? This cannot be undone.`)) return;
    try {
      await knowledgeBaseApi.deleteItem(selected.id, item.id);
      await loadSelected(selected.id);
      await loadKbs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  /* ── Render ── */

  return (
    <>
      <TopBar title="Knowledge Base" />
      <Page>
        {/* Left: KB list */}
        <Panel>
          <PanelHeader>
            <PanelTitle>Knowledge Bases ({kbs.length})</PanelTitle>
            <Button size="sm" onClick={openCreateKb}>+ New</Button>
          </PanelHeader>
          <PanelBody>
            {error && <ErrorText>{error}</ErrorText>}

            {showKbForm && (
              <Card $selected>
                <CardTitle style={{ marginBottom: 8 }}>
                  {editingKb ? 'Edit Knowledge Base' : 'New Knowledge Base'}
                </CardTitle>
                <FormGroup>
                  <Label>Name</Label>
                  <Input
                    value={kbName}
                    onChange={(e) => setKbName(e.target.value)}
                    placeholder="e.g. Medical Policies"
                    autoFocus
                  />
                </FormGroup>
                <FormGroup>
                  <Label>Description</Label>
                  <Textarea
                    value={kbDesc}
                    onChange={(e) => setKbDesc(e.target.value)}
                    placeholder="What's in this KB?"
                  />
                </FormGroup>
                <Row>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setShowKbForm(false); setEditingKb(null); }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSubmitKb} disabled={!kbName.trim()}>
                    {editingKb ? 'Save' : 'Create'}
                  </Button>
                </Row>
              </Card>
            )}

            {kbs.length === 0 && !showKbForm && (
              <EmptyState>No knowledge bases yet.<br />Create one to get started.</EmptyState>
            )}

            {kbs.map((kb) => (
              <Card
                key={kb.id}
                $selected={selectedId === kb.id}
                onClick={() => setSelectedId(kb.id)}
              >
                <Row>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CardTitle>{kb.name}</CardTitle>
                    <CardMeta>{kb.item_count} items</CardMeta>
                    {kb.description && (
                      <CardMeta style={{ color: tokens.colors.text.secondary, marginTop: 2 }}>
                        {kb.description.slice(0, 60)}
                        {kb.description.length > 60 ? '...' : ''}
                      </CardMeta>
                    )}
                  </div>
                </Row>
                <Row style={{ marginTop: 6 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); openEditKb(kb); }}
                    style={{ fontSize: '0.7rem' }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={(e) => { e.stopPropagation(); handleDeleteKb(kb); }}
                    style={{ fontSize: '0.7rem' }}
                  >
                    Delete
                  </Button>
                </Row>
              </Card>
            ))}
          </PanelBody>
        </Panel>

        {/* Right: selected KB detail + add items */}
        <Panel>
          {!selected ? (
            <PanelBody>
              <EmptyState>Select a knowledge base on the left, or create a new one.</EmptyState>
            </PanelBody>
          ) : (
            <>
              <PanelHeader>
                <div>
                  <PanelTitle>{selected.name}</PanelTitle>
                  <CardMeta style={{ marginTop: 2 }}>
                    {selected.items.length} items
                    {selected.description && ` · ${selected.description}`}
                  </CardMeta>
                </div>
                <Button size="sm" variant="ghost" onClick={() => loadSelected(selected.id)}>
                  Refresh
                </Button>
              </PanelHeader>

              <TabBar>
                <Tab $active={addTab === 'text'} onClick={() => setAddTab('text')}>+ Text</Tab>
                <Tab $active={addTab === 'pdf'} onClick={() => setAddTab('pdf')}>+ PDF</Tab>
                <Tab $active={addTab === 'batch'} onClick={() => setAddTab('batch')}>+ Batch PDF</Tab>
                <Tab $active={addTab === 'csv'} onClick={() => setAddTab('csv')}>+ CSV</Tab>
              </TabBar>

              <PanelBody>
                {/* ── Add Item Tabs ── */}
                {addTab === 'text' && (
                  <Card style={{ cursor: 'default' }}>
                    <FormGroup>
                      <Label>Name</Label>
                      <Input
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                        placeholder="Short identifier"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>Description (optional)</Label>
                      <Input
                        value={itemDesc}
                        onChange={(e) => setItemDesc(e.target.value)}
                        placeholder="What is this?"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>Content</Label>
                      <Textarea
                        value={itemContent}
                        onChange={(e) => setItemContent(e.target.value)}
                        placeholder="Paste or type the item content..."
                        style={{ minHeight: 120 }}
                      />
                    </FormGroup>
                    <Row>
                      <div />
                      <Button
                        size="sm"
                        onClick={handleAddText}
                        disabled={!itemName.trim() || !itemContent.trim()}
                      >
                        Add Item
                      </Button>
                    </Row>
                  </Card>
                )}

                {addTab === 'pdf' && (
                  <Card style={{ cursor: 'default' }}>
                    <FormGroup>
                      <Label>Description (optional)</Label>
                      <Input
                        value={pdfDesc}
                        onChange={(e) => setPdfDesc(e.target.value)}
                        placeholder="Applied to the uploaded PDF"
                      />
                    </FormGroup>
                    <FileInput
                      ref={singleFileRef}
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
                      onClick={() => singleFileRef.current?.click()}
                    >
                      {uploading ? 'Uploading...' : 'Choose PDF...'}
                    </Button>
                    <CardMeta style={{ marginTop: 6 }}>
                      The file will be parsed and its text stored as a single item.
                    </CardMeta>
                  </Card>
                )}

                {addTab === 'batch' && (
                  <Card style={{ cursor: 'default' }}>
                    <FileInput
                      ref={batchFileRef}
                      type="file"
                      accept=".pdf"
                      multiple
                      onChange={(e) => {
                        handleUploadBatch(e.target.files);
                        e.target.value = '';
                      }}
                    />
                    <Button
                      disabled={uploading}
                      onClick={() => batchFileRef.current?.click()}
                    >
                      {uploading ? 'Uploading...' : 'Choose Multiple PDFs...'}
                    </Button>
                    <CardMeta style={{ marginTop: 6 }}>
                      One item per PDF (filename becomes the name).
                    </CardMeta>
                  </Card>
                )}

                {addTab === 'csv' && (
                  <Card style={{ cursor: 'default' }}>
                    <FileInput
                      ref={csvFileRef}
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
                      onClick={() => csvFileRef.current?.click()}
                    >
                      {uploading ? 'Uploading...' : 'Choose CSV...'}
                    </Button>
                    <CardMeta style={{ marginTop: 6 }}>
                      Each non-empty line becomes one item.
                      Recognized columns: <code>content</code>/<code>text</code>, <code>name</code>, <code>description</code>.
                      If no header, first column is used as content.
                    </CardMeta>
                  </Card>
                )}

                {/* ── Item list ── */}
                <div style={{ marginTop: tokens.spacing.lg }}>
                  <PanelTitle style={{ fontSize: '0.72rem', marginBottom: 10 }}>
                    Items
                  </PanelTitle>
                  {selected.items.length === 0 && (
                    <EmptyState>No items yet. Add one above.</EmptyState>
                  )}
                  {selected.items.map((item) => {
                    const isOpen = expandedItemId === item.id;
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
                              {item.name}
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
                              {' · '}{item.content.length.toLocaleString()} chars
                              {item.file_size_bytes && (
                                <> · {(item.file_size_bytes / 1024).toFixed(1)} KB</>
                              )}
                            </CardMeta>
                            {item.description && !isOpen && (
                              <CardMeta style={{ color: tokens.colors.text.secondary, marginTop: 2 }}>
                                {item.description.slice(0, 60)}
                                {item.description.length > 60 ? '...' : ''}
                              </CardMeta>
                            )}
                          </div>
                        </Row>

                        {isOpen && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
                          >
                            {item.description && (
                              <div>
                                <Label>Description</Label>
                                <CardMeta style={{ color: tokens.colors.text.primary, fontFamily: tokens.fonts.body, fontSize: '0.82rem' }}>
                                  {item.description}
                                </CardMeta>
                              </div>
                            )}
                            <div>
                              <Label>Content</Label>
                              <DetailBox>{item.content}</DetailBox>
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
