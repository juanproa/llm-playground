import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Button } from '../common/Button';
import { Select } from '../common/Select';
import { Label } from '../common/Input';
import type { ModelConfig } from '../../types';
import { useModelStore } from '../../stores/modelStore';

/* ── Styles ── */

const Wrapper = styled.div`
  position: relative;
`;

const Popover = styled.div`
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  right: 0;
  background: ${tokens.colors.bg.secondary};
  border: 1px solid ${tokens.colors.border.strong};
  border-radius: ${tokens.radii.lg};
  padding: ${tokens.spacing.lg};
  box-shadow: ${tokens.shadows.elevated};
  z-index: 100;
`;

const PopoverTitle = styled.div`
  font-family: ${tokens.fonts.display};
  font-size: 0.95rem;
  font-weight: 600;
  color: ${tokens.colors.text.primary};
  margin-bottom: ${tokens.spacing.md};
`;

const ModelRow = styled.div`
  margin-bottom: 12px;
`;

const ErrorMsg = styled.div`
  font-size: 0.75rem;
  color: ${tokens.colors.accent.error};
  margin-bottom: 8px;
`;

const PopoverActions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
`;

/* ── Component ── */

interface Props {
  disabled: boolean;
  onCompare: (modelA: ModelConfig, modelB: ModelConfig) => void;
}

export function CompareButton({ disabled, onCompare }: Props) {
  const { models, fetchModels } = useModelStore();
  const [open, setOpen] = useState(false);
  const [modelAId, setModelAId] = useState('');
  const [modelBId, setModelBId] = useState('');
  const [error, setError] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const enabledModels = models.filter((m) => m.is_enabled);

  const handleStart = () => {
    if (!modelAId || !modelBId) {
      setError('Select both models');
      return;
    }
    if (modelAId === modelBId) {
      setError('Select two different models');
      return;
    }
    const a = models.find((m) => m.id === modelAId);
    const b = models.find((m) => m.id === modelBId);
    if (!a || !b) return;

    setError('');
    setOpen(false);
    onCompare(a, b);
  };

  return (
    <Wrapper ref={popoverRef}>
      {open && (
        <Popover>
          <PopoverTitle>Compare Two Models</PopoverTitle>

          <ModelRow>
            <Label>Model A</Label>
            <Select value={modelAId} onChange={(e) => { setModelAId(e.target.value); setError(''); }}>
              <option value="">Select model...</option>
              {enabledModels.map((m) => (
                <option key={m.id} value={m.id} disabled={m.id === modelBId}>
                  {m.name} ({m.provider})
                </option>
              ))}
            </Select>
          </ModelRow>

          <ModelRow>
            <Label>Model B</Label>
            <Select value={modelBId} onChange={(e) => { setModelBId(e.target.value); setError(''); }}>
              <option value="">Select model...</option>
              {enabledModels.map((m) => (
                <option key={m.id} value={m.id} disabled={m.id === modelAId}>
                  {m.name} ({m.provider})
                </option>
              ))}
            </Select>
          </ModelRow>

          {error && <ErrorMsg>{error}</ErrorMsg>}

          <PopoverActions>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleStart} disabled={!modelAId || !modelBId}>
              Start Comparison
            </Button>
          </PopoverActions>
        </Popover>
      )}

      <Button
        variant="secondary"
        size="lg"
        style={{ width: '100%', justifyContent: 'center' }}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        Compare Models
      </Button>
    </Wrapper>
  );
}
