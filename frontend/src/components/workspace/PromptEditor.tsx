import { useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Card, CardTitle, CardHeader } from '../common/Card';
import { Button } from '../common/Button';
import { Input, TextArea, Label, FormGroup } from '../common/Input';
import { Select } from '../common/Select';
import { Badge } from '../common/Badge';
import { Modal } from '../common/Modal';
import type { Prompt, PromptVersion } from '../../types';
import { usePromptStore } from '../../stores/promptStore';

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
  const { createPrompt, createVersion, deletePrompt, fetchPrompts } = usePromptStore();
  const [editedContent, setEditedContent] = useState('');
  const [editedSystem, setEditedSystem] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const syncEditorToVersion = (version: PromptVersion | null) => {
    setEditedContent(version?.content || '');
    setEditedSystem(version?.system_message || '');
    setDirty(false);
  };

  const handleDeletePrompt = async () => {
    if (!selectedPrompt) return;
    if (!confirm(`Delete prompt "${selectedPrompt.name}" and all its versions?`)) return;
    await deletePrompt(selectedPrompt.id);
    onSelectPrompt(null);
    onSelectVersion(null);
    await fetchPrompts(projectId);
  };

  const handleSaveEdit = async () => {
    if (!selectedPrompt || !editedContent.trim()) return;
    setSaving(true);
    try {
      const version = await createVersion(selectedPrompt.id, {
        content: editedContent,
        system_message: editedSystem || undefined,
        label: `edited from v${selectedVersion?.version_number || 1}`,
      });
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
    await createVersion(selectedPrompt.id, { content: newContent, system_message: newSystem || undefined });
    setNewContent(''); setNewSystem('');
    setShowNewVersion(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompt</CardTitle>
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
