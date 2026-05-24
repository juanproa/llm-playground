import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Card, CardTitle, CardHeader } from '../common/Card';
import { Button } from '../common/Button';
import { Input, TextArea, Label, FormGroup } from '../common/Input';
import { Select } from '../common/Select';
import { Badge } from '../common/Badge';
import { Modal } from '../common/Modal';
import type { KnowledgeBase, Prompt, PromptVersion } from '../../types';
import { usePromptStore } from '../../stores/promptStore';
import { knowledgeBaseApi } from '../../api/knowledgeBase';
import { promptsApi } from '../../api/prompts';

const VersionSelector = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: ${tokens.spacing.md};
`;

interface Props {
  projectId: string;
  prompts: Prompt[];
  selectedPrompt: Prompt | null;
  selectedVersion: PromptVersion | null;
  onSelectPrompt: (prompt: Prompt | null) => void;
  onSelectVersion: (version: PromptVersion | null) => void;
}

export function PromptEditor({ projectId, prompts, selectedPrompt, selectedVersion, onSelectPrompt, onSelectVersion }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newSystem, setNewSystem] = useState('');
  const { createPrompt, createVersion, deletePrompt, deleteVersion, fetchPrompts } = usePromptStore();
  const [editedContent, setEditedContent] = useState('');
  const [editedSystem, setEditedSystem] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // RAG binding on the current prompt version
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [kbSaving, setKbSaving] = useState(false);

  useEffect(() => {
    knowledgeBaseApi.list().then(setKbs).catch(() => setKbs([]));
  }, []);

  const handleKbChange = async (kbId: string) => {
    if (!selectedVersion) return;
    setKbSaving(true);
    try {
      const updated = kbId
        ? await promptsApi.updateVersion(selectedVersion.id, { kb_id: kbId })
        : await promptsApi.updateVersion(selectedVersion.id, { clear_kb: true });
      onSelectVersion(updated);
      await fetchPrompts(projectId);
    } finally {
      setKbSaving(false);
    }
  };

  const handleTopKChange = async (topK: number) => {
    if (!selectedVersion) return;
    setKbSaving(true);
    try {
      const updated = await promptsApi.updateVersion(selectedVersion.id, { kb_top_k: topK });
      onSelectVersion(updated);
      await fetchPrompts(projectId);
    } finally {
      setKbSaving(false);
    }
  };

  const attachedKb = selectedVersion?.kb_id
    ? kbs.find((k) => k.id === selectedVersion.kb_id) || null
    : null;

  const syncEditorToVersion = (version: PromptVersion | null) => {
    setEditedContent(version?.content || '');
    setEditedSystem(version?.system_message || '');
    setDirty(false);
  };

  const handleDeleteVersion = async () => {
    if (!selectedPrompt || !selectedVersion) return;
    if (selectedPrompt.versions.length <= 1) {
      alert('Cannot delete the only version of a prompt.');
      return;
    }
    if (selectedVersion.is_active) {
      alert('Cannot delete the active version. Set another version active first.');
      return;
    }
    if (!confirm(`Delete version v${selectedVersion.version_number}?`)) return;
    try {
      const updatedPrompt = await deleteVersion(selectedPrompt.id, selectedVersion.id);
      onSelectPrompt(updatedPrompt);
      const next =
        updatedPrompt.versions.find((v) => v.is_active) || updatedPrompt.versions[0] || null;
      onSelectVersion(next);
      syncEditorToVersion(next);
      await fetchPrompts(projectId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete version';
      alert(message);
    }
  };

  const handleDeletePrompt = async () => {
    if (!selectedPrompt) return;
    if (!confirm(`Delete prompt "${selectedPrompt.name}" and all its versions?`)) return;
    try {
      await deletePrompt(selectedPrompt.id);
      onSelectPrompt(null);
      onSelectVersion(null);
      await fetchPrompts(projectId);
    } catch (err) {
      // Backend returns 400 with a friendly detail when curated artifacts
      // (backtest/comparison/feedback runs or chain nodes) still reference
      // this prompt's versions. Surface that to the user instead of leaving
      // the click looking like a no-op.
      const message = err instanceof Error ? err.message : 'Failed to delete prompt';
      alert(message);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedPrompt || !editedContent.trim()) return;
    setSaving(true);
    try {
      const { version, prompt } = await createVersion(selectedPrompt.id, {
        content: editedContent,
        system_message: editedSystem || undefined,
        label: `edited from v${selectedVersion?.version_number || 1}`,
      });
      onSelectPrompt(prompt);
      onSelectVersion(version);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePrompt = async () => {
    if (!newName.trim() || !newContent.trim()) return;
    const prompt = await createPrompt(projectId, { name: newName.trim(), content: newContent, system_message: newSystem || undefined });
    onSelectPrompt(prompt);
    if (prompt.versions.length > 0) {
      onSelectVersion(prompt.versions[0]);
      syncEditorToVersion(prompt.versions[0]);
    }
    setNewName(''); setNewContent(''); setNewSystem('');
    setShowCreate(false);
  };

  const handleCreateVersion = async () => {
    if (!selectedPrompt || !newContent.trim()) return;
    const { version, prompt } = await createVersion(selectedPrompt.id, { content: newContent, system_message: newSystem || undefined });
    onSelectPrompt(prompt);
    onSelectVersion(version);
    setNewContent(''); setNewSystem('');
    setShowNewVersion(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompt &amp; RAG</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => setShowCreate(true)}>New Prompt</Button>
      </CardHeader>

      {prompts.length > 0 && (
        <>
          <FormGroup>
            <Label>Select Prompt</Label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Select
                style={{ flex: 1 }}
                value={selectedPrompt?.id || ''}
                onChange={(e) => {
                  const p = prompts.find((p) => p.id === e.target.value);
                  onSelectPrompt(p || null);
                  if (p?.versions.length) {
                    const active = p.versions.find((v) => v.is_active) || p.versions[0];
                    onSelectVersion(active);
                    syncEditorToVersion(active);
                  } else {
                    syncEditorToVersion(null);
                  }
                }}
              >
                <option value="">Select a prompt...</option>
                {prompts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              {selectedPrompt && (
                <Button size="sm" variant="danger" onClick={handleDeletePrompt}>Delete</Button>
              )}
            </div>
          </FormGroup>

          {selectedPrompt && selectedPrompt.versions.length > 0 && (
            <VersionSelector>
              <Label style={{ marginBottom: 0 }}>Version:</Label>
              <Select
                style={{ width: 'auto', flex: 1 }}
                value={selectedVersion?.id || ''}
                onChange={(e) => {
                  const v = selectedPrompt.versions.find((v) => v.id === e.target.value);
                  onSelectVersion(v || null);
                  syncEditorToVersion(v || null);
                }}
              >
                {selectedPrompt.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version_number} {v.label ? `- ${v.label}` : ''} {v.is_active ? '(active)' : ''}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="secondary" onClick={() => {
                setNewContent(selectedVersion?.content || '');
                setNewSystem(selectedVersion?.system_message || '');
                setShowNewVersion(true);
              }}>
                New Version
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={handleDeleteVersion}
                disabled={
                  !selectedVersion ||
                  selectedPrompt.versions.length <= 1 ||
                  selectedVersion.is_active
                }
                title={
                  !selectedVersion
                    ? ''
                    : selectedPrompt.versions.length <= 1
                    ? 'Cannot delete the only version'
                    : selectedVersion.is_active
                    ? 'Cannot delete the active version'
                    : 'Delete this version'
                }
              >
                Delete Version
              </Button>
            </VersionSelector>
          )}

          {selectedVersion && (
            <>
              <FormGroup>
                <Label>System Message (optional)</Label>
                <TextArea
                  placeholder="System instructions..."
                  value={editedSystem}
                  onChange={(e) => { setEditedSystem(e.target.value); setDirty(true); }}
                  rows={3}
                  style={{ fontFamily: tokens.fonts.mono, fontSize: '0.85rem' }}
                />
              </FormGroup>
              <FormGroup>
                <Label>
                  Prompt Content
                  <Badge color="primary" style={{ marginLeft: 8 }}>v{selectedVersion.version_number}</Badge>
                  {dirty && <Badge color="warning" style={{ marginLeft: 6 }}>Edited</Badge>}
                </Label>
                <TextArea
                  value={editedContent}
                  onChange={(e) => { setEditedContent(e.target.value); setDirty(true); }}
                  rows={8}
                  style={{ fontFamily: tokens.fonts.mono, fontSize: '0.85rem' }}
                />
              </FormGroup>
              {dirty && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="ghost" onClick={() => syncEditorToVersion(selectedVersion)}>
                    Discard
                  </Button>
                  <Button size="sm" onClick={handleSaveEdit} disabled={!editedContent.trim() || saving}>
                    {saving ? 'Saving...' : 'Save as New Version'}
                  </Button>
                </div>
              )}

              <FormGroup style={{ marginTop: tokens.spacing.md, paddingTop: tokens.spacing.md, borderTop: `1px solid ${tokens.colors.border.subtle}` }}>
                <Label>RAG Knowledge Base (optional)</Label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Select
                    value={selectedVersion.kb_id || ''}
                    onChange={(e) => handleKbChange(e.target.value)}
                    disabled={kbSaving}
                    style={{ flex: 1 }}
                  >
                    <option value="">— no KB —</option>
                    {kbs.map((kb) => (
                      <option key={kb.id} value={kb.id}>
                        {kb.name} ({kb.chunk_count} chunks)
                      </option>
                    ))}
                  </Select>
                  {selectedVersion.kb_id && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 8px',
                      background: tokens.colors.bg.tertiary,
                      border: `1px solid ${tokens.colors.border.subtle}`,
                      borderRadius: tokens.radii.sm,
                      fontSize: '0.75rem',
                      color: tokens.colors.text.secondary,
                    }}>
                      <span>top-k</span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={selectedVersion.kb_top_k}
                        onChange={(e) => handleTopKChange(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                        disabled={kbSaving}
                        style={{
                          width: 48,
                          background: tokens.colors.bg.primary,
                          border: `1px solid ${tokens.colors.border.subtle}`,
                          borderRadius: tokens.radii.sm,
                          color: tokens.colors.text.primary,
                          fontFamily: tokens.fonts.mono,
                          fontSize: '0.8rem',
                          padding: '4px 6px',
                          outline: 'none',
                          textAlign: 'center',
                        }}
                      />
                    </div>
                  )}
                </div>
                {attachedKb ? (
                  <div style={{
                    marginTop: 6,
                    fontSize: '0.72rem',
                    color: tokens.colors.text.muted,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexWrap: 'wrap',
                  }}>
                    <Badge color="primary">RAG ON</Badge>
                    <span>Top {selectedVersion.kb_top_k} chunks from "{attachedKb.name}" will be prepended to the system prompt.</span>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.72rem', color: tokens.colors.text.muted, marginTop: 4 }}>
                    Bind a KB to this prompt version so every run auto-retrieves context. You can still override per-call from the Input panel.
                  </div>
                )}
              </FormGroup>
            </>
          )}
        </>
      )}

      <Modal title="Create New Prompt" open={showCreate} onClose={() => setShowCreate(false)}>
        <FormGroup>
          <Label>Prompt Name</Label>
          <Input placeholder="e.g. Classification Prompt" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
        </FormGroup>
        <FormGroup>
          <Label>System Message (optional)</Label>
          <TextArea placeholder="System instructions..." value={newSystem} onChange={(e) => setNewSystem(e.target.value)} rows={3} />
        </FormGroup>
        <FormGroup>
          <Label>Prompt Content</Label>
          <TextArea placeholder="Your prompt template..." value={newContent} onChange={(e) => setNewContent(e.target.value)} rows={6} />
        </FormGroup>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={handleCreatePrompt} disabled={!newName.trim() || !newContent.trim()}>Create</Button>
        </div>
      </Modal>

      <Modal title="Create New Version" open={showNewVersion} onClose={() => setShowNewVersion(false)}>
        <FormGroup>
          <Label>System Message (optional)</Label>
          <TextArea value={newSystem} onChange={(e) => setNewSystem(e.target.value)} rows={3} />
        </FormGroup>
        <FormGroup>
          <Label>Prompt Content</Label>
          <TextArea value={newContent} onChange={(e) => setNewContent(e.target.value)} rows={6} />
        </FormGroup>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setShowNewVersion(false)}>Cancel</Button>
          <Button onClick={handleCreateVersion} disabled={!newContent.trim()}>Save Version</Button>
        </div>
      </Modal>
    </Card>
  );
}
