import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Input, Label, FormGroup, TextArea } from '../common/Input';
import { Select } from '../common/Select';
import { Badge } from '../common/Badge';
import { InputPanel } from '../workspace/InputPanel';
import { PromptEditor } from '../workspace/PromptEditor';
import { ModelSelector } from '../workspace/ModelSelector';
import { useChainStore } from '../../stores/chainStore';
import { usePromptStore } from '../../stores/promptStore';
import { useModelStore } from '../../stores/modelStore';
import { documentsApi } from '../../api/documents';
import { knowledgeBaseApi } from '../../api/knowledgeBase';
import type { ChainNode, Document, KnowledgeBase, ModelConfig, Prompt, PromptVersion } from '../../types';

const Grid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${tokens.spacing.md};
`;

const SectionTitle = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${tokens.colors.text.secondary};
  margin: ${tokens.spacing.lg} 0 ${tokens.spacing.sm};
`;

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: ${tokens.spacing.lg};
  padding-top: ${tokens.spacing.md};
  border-top: 1px solid ${tokens.colors.border.subtle};
`;

const Hint = styled.div`
  font-size: 0.72rem;
  color: ${tokens.colors.text.muted};
  margin-top: 4px;
`;

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  node: ChainNode | null;
  // Whether this node has any incoming edges. Root nodes show input_text.
  isRoot: boolean;
}

export function ChainNodeConfigModal({ open, onClose, projectId, node, isRoot }: Props) {
  const { prompts, fetchPrompts } = usePromptStore();
  const { models, fetchModels } = useModelStore();
  const { updateNode, deleteNode } = useChainStore();

  const [name, setName] = useState('');
  const [inputText, setInputText] = useState('');
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<PromptVersion | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelConfig | null>(null);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [kbId, setKbId] = useState<string | null>(null);
  const [kbTopK, setKbTopK] = useState<number | null>(null);
  const [kbQueryTemplate, setKbQueryTemplate] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Hydrate form when modal opens / node changes.
  useEffect(() => {
    if (!open || !node) return;
    fetchPrompts(projectId);
    fetchModels();
    knowledgeBaseApi.list().then(setKbs).catch(() => setKbs([]));
    setName(node.name);
    setInputText(node.input_text || '');
    setKbId(node.kb_id);
    setKbTopK(node.kb_top_k);
    setKbQueryTemplate(node.kb_query_template || '');
    if (node.input_document_id) {
      documentsApi.get(node.input_document_id).then(setSelectedDocument).catch(() => setSelectedDocument(null));
    } else {
      setSelectedDocument(null);
    }
  }, [open, node, projectId, fetchPrompts, fetchModels]);

  // Resolve prompt/version/model objects from IDs once their stores load.
  useEffect(() => {
    if (!node) return;
    if (node.prompt_version_id) {
      const p = prompts.find((pr) => pr.versions.some((v) => v.id === node.prompt_version_id));
      const v = p?.versions.find((v) => v.id === node.prompt_version_id) || null;
      setSelectedPrompt(p || null);
      setSelectedVersion(v);
    } else {
      setSelectedPrompt(null);
      setSelectedVersion(null);
    }
  }, [node, prompts]);

  useEffect(() => {
    if (!node) return;
    setSelectedModel(node.model_config_id ? models.find((m) => m.id === node.model_config_id) || null : null);
  }, [node, models]);

  const promptVersionId = selectedVersion?.id || null;
  const modelConfigId = selectedModel?.id || null;

  const dirty = useMemo(() => {
    if (!node) return false;
    return (
      name !== node.name ||
      (inputText || null) !== (node.input_text || null) ||
      (selectedDocument?.id || null) !== node.input_document_id ||
      promptVersionId !== node.prompt_version_id ||
      modelConfigId !== node.model_config_id ||
      kbId !== node.kb_id ||
      kbTopK !== node.kb_top_k ||
      (kbQueryTemplate || null) !== (node.kb_query_template || null)
    );
  }, [node, name, inputText, selectedDocument, promptVersionId, modelConfigId, kbId, kbTopK, kbQueryTemplate]);

  const handleSave = async () => {
    if (!node) return;
    setSaving(true);
    try {
      await updateNode(node.id, {
        name,
        input_text: isRoot ? (inputText || null) : null,
        input_document_id: isRoot ? (selectedDocument?.id || null) : null,
        prompt_version_id: promptVersionId,
        model_config_id: modelConfigId,
        kb_id: kbId,
        kb_top_k: kbTopK,
        kb_query_template: kbQueryTemplate.trim() ? kbQueryTemplate : null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!node) return;
    if (!confirm(`Delete node "${node.name}" and any connected edges?`)) return;
    try {
      await deleteNode(node.id);
      onClose();
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    }
  };

  if (!node) return null;

  return (
    <Modal title={`Configure node — ${node.name}`} open={open} onClose={onClose} size="lg">
      <FormGroup>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Classifier" />
        <Hint>
          Use this name in downstream prompts as <code>{`{{${node.name}.output}}`}</code>.
        </Hint>
      </FormGroup>

      {isRoot && (
        <FormGroup>
          <Label>
            Chain input <Badge color="primary" style={{ marginLeft: 8 }}>root</Badge>
          </Label>
          <Hint style={{ marginBottom: 8 }}>
            Same controls as Workspace — paste text, upload a PDF, or pick from a dataset.
            Downstream nodes inherit via <code>{`{{${node.name}.output}}`}</code> templating.
          </Hint>
          <InputPanel
            projectId={projectId}
            inputText={inputText}
            onInputTextChange={setInputText}
            selectedDocument={selectedDocument}
            onDocumentSelect={setSelectedDocument}
            selectedVersion={selectedVersion}
          />
        </FormGroup>
      )}

      <SectionTitle>Prompt</SectionTitle>
      <PromptEditor
        projectId={projectId}
        prompts={prompts}
        selectedPrompt={selectedPrompt}
        selectedVersion={selectedVersion}
        onSelectPrompt={setSelectedPrompt}
        onSelectVersion={setSelectedVersion}
      />

      <SectionTitle>Model</SectionTitle>
      <ModelSelector selectedModel={selectedModel} onSelectModel={setSelectedModel} />

      <SectionTitle>RAG override (optional)</SectionTitle>
      <Grid>
        <FormGroup style={{ marginBottom: 0 }}>
          <Label>Knowledge base</Label>
          <Select
            value={kbId || ''}
            onChange={(e) => setKbId(e.target.value || null)}
          >
            <option value="">— inherit from prompt version —</option>
            {kbs.map((kb) => (
              <option key={kb.id} value={kb.id}>
                {kb.name} ({kb.chunk_count} chunks)
              </option>
            ))}
          </Select>
        </FormGroup>
        <FormGroup style={{ marginBottom: 0 }}>
          <Label>top-k</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={kbTopK ?? ''}
            placeholder="inherit"
            onChange={(e) => {
              const v = e.target.value;
              setKbTopK(v === '' ? null : Math.max(1, Math.min(20, Number(v) || 1)));
            }}
          />
        </FormGroup>
      </Grid>

      <FormGroup style={{ marginTop: tokens.spacing.md }}>
        <Label>Retrieval query template</Label>
        <Hint style={{ marginBottom: 6 }}>
          Optional. Sent verbatim to the vector DB. Supports{' '}
          <code>{'{{node.output}}'}</code> references to upstream nodes. Leave
          blank to use the user input / prompt content (legacy behavior).
        </Hint>
        <TextArea
          rows={3}
          value={kbQueryTemplate}
          placeholder={'e.g. {{QueryGen.output}}'}
          onChange={(e) => setKbQueryTemplate(e.target.value)}
        />
      </FormGroup>

      <Footer>
        <Button variant="danger" onClick={handleDelete}>Delete node</Button>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!dirty || saving || !name.trim()}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </Footer>
    </Modal>
  );
}
