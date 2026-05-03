import { useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Card, CardTitle } from '../common/Card';
import { Button } from '../common/Button';
import { TextArea, Label, FormGroup } from '../common/Input';
import { Badge } from '../common/Badge';
import { documentsApi } from '../../api/documents';
import { knowledgeBaseApi } from '../../api/knowledgeBase';
import { inputDatasetsApi } from '../../api/inputDatasets';
import type {
  Document,
  InputDataset,
  InputDatasetItem,
  KnowledgeBase,
  PromptVersion,
} from '../../types';

const UploadZone = styled.div<{ $dragOver?: boolean }>`
  border: 2px dashed ${({ $dragOver }) => $dragOver ? tokens.colors.accent.primary : tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: ${tokens.spacing.xl};
  text-align: center;
  color: ${tokens.colors.text.muted};
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: ${tokens.colors.accent.primary};
    color: ${tokens.colors.text.secondary};
  }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.97); }
`;

const scanLine = keyframes`
  0% { top: 8%; }
  50% { top: 85%; }
  100% { top: 8%; }
`;

const UploadingState = styled.div`
  border: 2px solid ${tokens.colors.accent.primary};
  border-radius: ${tokens.radii.lg};
  padding: 28px ${tokens.spacing.xl};
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: ${tokens.colors.text.secondary};
  font-size: 0.85rem;
  background: rgba(108, 92, 231, 0.04);
  animation: ${pulse} 2.5s ease-in-out infinite;
`;

const DocAnimWrapper = styled.div`
  position: relative;
  width: 64px;
  height: 80px;
`;

const DocShape = styled.div`
  width: 64px;
  height: 80px;
  border-radius: 6px 12px 6px 6px;
  background: ${tokens.colors.bg.tertiary};
  border: 2px solid ${tokens.colors.accent.primary};
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 16px;
    left: 10px;
    right: 10px;
    height: 4px;
    border-radius: 2px;
    background: ${tokens.colors.border.strong};
    box-shadow:
      0 10px 0 ${tokens.colors.border.strong},
      0 20px 0 ${tokens.colors.border.strong},
      0 30px 0 ${tokens.colors.border.strong};
  }
`;

const ScanBeam = styled.div`
  position: absolute;
  left: 2px;
  right: 2px;
  height: 3px;
  background: ${tokens.colors.accent.primary};
  border-radius: 2px;
  box-shadow: 0 0 12px ${tokens.colors.accent.primary}, 0 0 24px rgba(108, 92, 231, 0.3);
  animation: ${scanLine} 2s ease-in-out infinite;
`;

const ProgressBarTrack = styled.div`
  width: 180px;
  height: 4px;
  border-radius: 2px;
  background: ${tokens.colors.border.subtle};
  overflow: hidden;
`;

const ProgressBarFill = styled.div`
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, ${tokens.colors.accent.primary}, ${tokens.colors.accent.secondary}, ${tokens.colors.accent.primary});
  background-size: 200% 100%;
  animation: ${shimmer} 1.5s linear infinite;
`;

const UploadFileName = styled.div`
  font-weight: 600;
  color: ${tokens.colors.text.primary};
  font-size: 0.9rem;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const UploadHint = styled.div`
  font-size: 0.75rem;
  color: ${tokens.colors.text.muted};
`;

const DocumentCard = styled.div`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: ${tokens.spacing.md};
  transition: border-color 0.2s;
`;

const DocHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
`;

const DocIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: ${tokens.radii.sm};
  background: rgba(108, 92, 231, 0.15);
  color: ${tokens.colors.accent.primary};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  font-family: ${tokens.fonts.accent};
  flex-shrink: 0;
`;

const DocInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const DocName = styled.div`
  font-size: 0.85rem;
  font-weight: 600;
  color: ${tokens.colors.text.primary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const DocMeta = styled.div`
  font-size: 0.75rem;
  color: ${tokens.colors.text.muted};
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
`;

const DocPreview = styled.div`
  background: ${tokens.colors.bg.primary};
  border-radius: ${tokens.radii.sm};
  padding: ${tokens.spacing.md};
  font-size: 0.8rem;
  color: ${tokens.colors.text.secondary};
  max-height: 150px;
  overflow-y: auto;
  white-space: pre-wrap;
  font-family: ${tokens.fonts.mono};
  line-height: 1.5;
  border: 1px solid ${tokens.colors.border.subtle};
`;

const ErrorBox = styled.div`
  background: rgba(255, 82, 82, 0.08);
  border: 1px solid rgba(255, 82, 82, 0.25);
  border-radius: ${tokens.radii.md};
  padding: ${tokens.spacing.md};
  color: ${tokens.colors.accent.error};
  font-size: 0.8rem;
  margin-top: 8px;
`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type RagOverride =
  | { mode: 'prompt' }           // use whatever is bound to the prompt version
  | { mode: 'off' }              // explicitly disable RAG for this call
  | { mode: 'custom'; kbId: string; topK: number };

interface Props {
  projectId: string;
  inputText: string;
  onInputTextChange: (text: string) => void;
  selectedDocument: Document | null;
  onDocumentSelect: (doc: Document | null) => void;
  onUploadingChange?: (uploading: boolean) => void;
  selectedVersion: PromptVersion | null;
  // Per-call RAG override. The prompt version supplies the default binding;
  // this lets the user disable or swap the KB for a single run.
  onRagOverrideChange?: (override: RagOverride) => void;
}

export function InputPanel({
  projectId,
  inputText,
  onInputTextChange,
  selectedDocument,
  onDocumentSelect,
  onUploadingChange,
  selectedVersion,
  onRagOverrideChange,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);

  // Dataset browsing
  const [datasets, setDatasets] = useState<InputDataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [datasetItems, setDatasetItems] = useState<InputDatasetItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Per-call RAG override
  const [ragMode, setRagMode] = useState<'prompt' | 'off' | 'custom'>('prompt');
  const [customKbId, setCustomKbId] = useState<string>('');
  const [customTopK, setCustomTopK] = useState<number>(5);

  useEffect(() => {
    knowledgeBaseApi.list().then(setKbs).catch(() => setKbs([]));
    inputDatasetsApi.list().then(setDatasets).catch(() => setDatasets([]));
  }, []);

  useEffect(() => {
    if (!selectedDatasetId) { setDatasetItems([]); return; }
    setLoadingItems(true);
    inputDatasetsApi.listItems(selectedDatasetId)
      .then(setDatasetItems)
      .catch(() => setDatasetItems([]))
      .finally(() => setLoadingItems(false));
  }, [selectedDatasetId]);

  // Switching prompt versions: reset override back to "follow the prompt"
  useEffect(() => {
    setRagMode('prompt');
  }, [selectedVersion?.id]);

  useEffect(() => {
    if (!onRagOverrideChange) return;
    if (ragMode === 'prompt') onRagOverrideChange({ mode: 'prompt' });
    else if (ragMode === 'off') onRagOverrideChange({ mode: 'off' });
    else onRagOverrideChange({ mode: 'custom', kbId: customKbId, topK: customTopK });
  }, [ragMode, customKbId, customTopK, onRagOverrideChange]);

  const pickDatasetItem = (item: InputDatasetItem) => {
    const header = item.name ? `--- ${item.name} ---\n` : '';
    // `item.content` is now PII-safe at the API boundary — when the source
    // has been masked, the backend swaps in the masked text before serializing.
    onInputTextChange(header + item.content);
  };

  const promptKb = selectedVersion?.kb_id
    ? kbs.find((k) => k.id === selectedVersion.kb_id) || null
    : null;

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadFileName(file.name);
    onUploadingChange?.(true);
    try {
      const doc = await documentsApi.upload(projectId, file);
      onDocumentSelect(doc);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setUploading(false);
      setUploadFileName('');
      onUploadingChange?.(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.type === 'application/pdf') handleUpload(file);
  };

  return (
    <Card>
      <CardTitle>Input</CardTitle>

      <FormGroup>
        <Label>Text Input</Label>
        <TextArea
          placeholder="Paste or type your input text here..."
          value={inputText}
          onChange={(e) => onInputTextChange(e.target.value)}
          rows={5}
        />
      </FormGroup>

      <FormGroup>
        <Label>PDF Document</Label>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />

        {uploading ? (
          <UploadingState>
            <DocAnimWrapper>
              <DocShape />
              <ScanBeam />
            </DocAnimWrapper>
            <UploadFileName>{uploadFileName}</UploadFileName>
            <ProgressBarTrack>
              <ProgressBarFill />
            </ProgressBarTrack>
            <UploadHint>Extracting text from document...</UploadHint>
          </UploadingState>
        ) : selectedDocument ? (
          <DocumentCard>
            <DocHeader>
              <DocIcon>PDF</DocIcon>
              <DocInfo>
                <DocName>{selectedDocument.name}</DocName>
                <DocMeta>
                  {selectedDocument.file_size_bytes && (
                    <span>{formatBytes(selectedDocument.file_size_bytes)}</span>
                  )}
                  <Badge
                    color={
                      selectedDocument.parse_status === 'completed' ? 'success'
                      : selectedDocument.parse_status === 'failed' ? 'error'
                      : 'warning'
                    }
                  >
                    {selectedDocument.parse_status}
                  </Badge>
                </DocMeta>
              </DocInfo>
              <Button size="sm" variant="ghost" onClick={() => onDocumentSelect(null)}>
                Remove
              </Button>
            </DocHeader>

            {selectedDocument.parse_error && (
              <ErrorBox>{selectedDocument.parse_error}</ErrorBox>
            )}

            {selectedDocument.raw_text && (
              <DocPreview>
                {selectedDocument.raw_text.length > 1000
                  ? selectedDocument.raw_text.substring(0, 1000) + '\n\n... (truncated)'
                  : selectedDocument.raw_text}
              </DocPreview>
            )}

            <div style={{ marginTop: 8, textAlign: 'right' }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => fileRef.current?.click()}
              >
                Replace Document
              </Button>
            </div>
          </DocumentCard>
        ) : (
          <UploadZone
            $dragOver={dragOver}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            Drop a PDF here or click to upload
          </UploadZone>
        )}
      </FormGroup>

      {datasets.length > 0 && (
        <FormGroup>
          <Label>Pick from Dataset (optional)</Label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={selectedDatasetId}
              onChange={(e) => setSelectedDatasetId(e.target.value)}
              style={{
                background: tokens.colors.bg.tertiary,
                border: `1px solid ${tokens.colors.border.subtle}`,
                borderRadius: tokens.radii.sm,
                color: tokens.colors.text.primary,
                fontFamily: tokens.fonts.body,
                fontSize: '0.875rem',
                padding: '8px 12px',
                outline: 'none',
                flex: 1,
                boxSizing: 'border-box',
              }}
            >
              <option value="">— select a dataset to browse —</option>
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name} ({ds.item_count} items)
                </option>
              ))}
            </select>
          </div>

          {selectedDatasetId && (
            <div style={{
              marginTop: 8,
              background: tokens.colors.bg.primary,
              border: `1px solid ${tokens.colors.border.subtle}`,
              borderRadius: tokens.radii.md,
              maxHeight: 220,
              overflowY: 'auto',
            }}>
              {loadingItems ? (
                <div style={{ padding: 12, fontSize: '0.8rem', color: tokens.colors.text.muted }}>
                  Loading items...
                </div>
              ) : datasetItems.length === 0 ? (
                <div style={{ padding: 12, fontSize: '0.8rem', color: tokens.colors.text.muted }}>
                  No items in this dataset.
                </div>
              ) : (
                datasetItems.map((item) => {
                  const label = item.name || item.content.slice(0, 60) + (item.content.length > 60 ? '…' : '');
                  return (
                    <div
                      key={item.id}
                      onClick={() => pickDatasetItem(item)}
                      title="Click to load this item into the input (replaces current content)"
                      style={{
                        padding: '8px 12px',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderBottom: `1px solid ${tokens.colors.border.subtle}`,
                        color: tokens.colors.text.primary,
                        fontFamily: tokens.fonts.mono,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = tokens.colors.bg.tertiary; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label}
                      </div>
                      {item.tags && (
                        <span style={{ marginLeft: 8 }}>
                          <Badge color="secondary">{item.tags}</Badge>
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </FormGroup>
      )}

      {selectedVersion && onRagOverrideChange && (
        <FormGroup>
          <Label>RAG for this call</Label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={ragMode}
              onChange={(e) => setRagMode(e.target.value as typeof ragMode)}
              style={{
                background: tokens.colors.bg.tertiary,
                border: `1px solid ${tokens.colors.border.subtle}`,
                borderRadius: tokens.radii.sm,
                color: tokens.colors.text.primary,
                fontFamily: tokens.fonts.body,
                fontSize: '0.8rem',
                padding: '6px 10px',
                outline: 'none',
              }}
            >
              <option value="prompt">
                Use prompt default {promptKb ? `(${promptKb.name}, top-${selectedVersion.kb_top_k})` : '(none)'}
              </option>
              <option value="off">Disable RAG for this call</option>
              <option value="custom">Override with another KB…</option>
            </select>

            {ragMode === 'custom' && (
              <>
                <select
                  value={customKbId}
                  onChange={(e) => setCustomKbId(e.target.value)}
                  style={{
                    background: tokens.colors.bg.tertiary,
                    border: `1px solid ${tokens.colors.border.subtle}`,
                    borderRadius: tokens.radii.sm,
                    color: tokens.colors.text.primary,
                    fontFamily: tokens.fonts.body,
                    fontSize: '0.8rem',
                    padding: '6px 10px',
                    outline: 'none',
                  }}
                >
                  <option value="">select a KB…</option>
                  {kbs.map((kb) => (
                    <option key={kb.id} value={kb.id}>
                      {kb.name} ({kb.chunk_count} chunks)
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={customTopK}
                  onChange={(e) => setCustomTopK(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  style={{
                    width: 56,
                    background: tokens.colors.bg.tertiary,
                    border: `1px solid ${tokens.colors.border.subtle}`,
                    borderRadius: tokens.radii.sm,
                    color: tokens.colors.text.primary,
                    fontFamily: tokens.fonts.mono,
                    fontSize: '0.8rem',
                    padding: '6px 8px',
                    outline: 'none',
                    textAlign: 'center',
                  }}
                  title="top-k"
                />
              </>
            )}
          </div>
          <div style={{ fontSize: '0.72rem', color: tokens.colors.text.muted, marginTop: 4 }}>
            {ragMode === 'off' && 'RAG is off for this call only. Bind a KB in the Prompt & RAG section to make it default-on.'}
            {ragMode === 'prompt' && !promptKb && 'No KB bound to this prompt version — set one in the Prompt & RAG section above.'}
            {ragMode === 'prompt' && promptKb && 'Inherits the prompt-version binding.'}
            {ragMode === 'custom' && 'Overriding the prompt-bound KB for this call only.'}
          </div>
        </FormGroup>
      )}
    </Card>
  );
}
