import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { postTrainingApi } from '../../api/postTraining';
import type { Dataset } from '../../types';

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
}: Props) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [createNewMode, setCreateNewMode] = useState(false);
  const [newDatasetName, setNewDatasetName] = useState('');
  const [instruction, setInstruction] = useState(defaultInstruction);
  const [systemMessage, setSystemMessage] = useState(defaultSystemMessage);
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync defaults whenever the modal is reopened
  useEffect(() => {
    if (open) {
      setInstruction(defaultInstruction);
      setSystemMessage(defaultSystemMessage);
      setTags('');
      setError(null);
      loadDatasets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultInstruction, defaultSystemMessage]);

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

      // Build payload — apply instruction/system_message to all items
      const payload = items.map((item) => ({
        input_text: item.input_text,
        output_text: item.output_text,
        instruction: instruction.trim() || undefined,
        system_message: systemMessage.trim() || undefined,
        tags: tags.trim() || undefined,
      }));

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
