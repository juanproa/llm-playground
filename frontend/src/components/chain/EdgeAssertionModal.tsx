import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Input, Label, FormGroup } from '../common/Input';
import { Select } from '../common/Select';
import { useChainStore } from '../../stores/chainStore';
import type { ChainEdge, EdgeAssertion } from '../../types';

const Row = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 8px;
`;

const Hint = styled.div`
  font-size: 0.72rem;
  color: ${tokens.colors.text.muted};
  margin-top: 6px;
`;

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  margin-top: ${tokens.spacing.lg};
  padding-top: ${tokens.spacing.md};
  border-top: 1px solid ${tokens.colors.border.subtle};
`;

const ALL_OPS: EdgeAssertion['op'][] = ['contains', 'equals', 'startswith', 'endswith', 'regex'];

interface Props {
  open: boolean;
  onClose: () => void;
  edge: ChainEdge | null;
  sourceName: string;
  targetName: string;
}

export function EdgeAssertionModal({ open, onClose, edge, sourceName, targetName }: Props) {
  const { updateEdgeAssertion, deleteEdge } = useChainStore();

  const [enabled, setEnabled] = useState(false);
  const [op, setOp] = useState<EdgeAssertion['op']>('contains');
  const [value, setValue] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [negate, setNegate] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !edge) return;
    if (edge.assertion) {
      setEnabled(true);
      setOp(edge.assertion.op);
      setValue(edge.assertion.value);
      setCaseSensitive(!!edge.assertion.case_sensitive);
      setNegate(!!edge.assertion.negate);
    } else {
      setEnabled(false);
      setOp('contains');
      setValue('');
      setCaseSensitive(false);
      setNegate(false);
    }
  }, [open, edge]);

  const handleSave = async () => {
    if (!edge) return;
    setSaving(true);
    try {
      const next: EdgeAssertion | null = enabled
        ? { op, value, case_sensitive: caseSensitive, negate }
        : null;
      await updateEdgeAssertion(edge.id, next);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!edge) return;
    if (!confirm(`Delete edge from "${sourceName}" to "${targetName}"?`)) return;
    await deleteEdge(edge.id);
    onClose();
  };

  if (!edge) return null;

  return (
    <Modal title={`Edge: ${sourceName} → ${targetName}`} open={open} onClose={onClose}>
      <FormGroup>
        <Label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Conditional (assert on source output)
        </Label>
        <Hint>
          When enabled, this edge only fires if the source node's output matches the assertion.
          Disabled = unconditional fan-out.
        </Hint>
      </FormGroup>

      {enabled && (
        <>
          <Row>
            <div style={{ flex: 1 }}>
              <Label>Operator</Label>
              <Select value={op} onChange={(e) => setOp(e.target.value as EdgeAssertion['op'])}>
                {ALL_OPS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </div>
            <div style={{ flex: 2 }}>
              <Label>Value</Label>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={op === 'regex' ? '^Pre-Service' : 'e.g. Grievance'}
              />
            </div>
          </Row>
          <Row>
            <Label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
              />
              case-sensitive
            </Label>
            <Label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={negate}
                onChange={(e) => setNegate(e.target.checked)}
              />
              negate (NOT)
            </Label>
          </Row>
        </>
      )}

      <Footer>
        <Button variant="danger" onClick={handleDelete}>Delete edge</Button>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || (enabled && !value.trim())}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </Footer>
    </Modal>
  );
}
