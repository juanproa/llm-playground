/**
 * AssertionsEditor — edits the list of AssertionSpec on a TestCase.
 *
 * Each assertion has:
 *   - name (display label)
 *   - type (json_path_exact | json_path_numeric | json_path_contains | llm_judge)
 *   - path (JSONPath like "$.extracted_data.classification")
 *   - expected (optional — if null, extracted from expected_output via path)
 *   - weight (1.0 default)
 *   - options (type-specific)
 */
import { useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import type { AssertionSpec } from '../../types';

const TYPE_LABELS: Record<AssertionSpec['type'], string> = {
  json_path_exact: 'JSON field = exact',
  json_path_numeric: 'JSON field = numeric',
  json_path_contains: 'JSON field contains',
  llm_judge: 'LLM judge',
};

const TYPE_HINTS: Record<AssertionSpec['type'], string> = {
  json_path_exact: 'Extract a field from the output via JSONPath and require exact match to expected value.',
  json_path_numeric: 'Extract a numeric field; passes if |actual - expected| ≤ tolerance.',
  json_path_contains: 'Extract a string field; passes if all keywords are present (optionally case-insensitive).',
  llm_judge: 'Send the specified slice (or whole output) to a judge model for semantic grading.',
};

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const Title = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${tokens.colors.text.muted};
`;

const Row = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
`;

const Card = styled.div`
  background: ${tokens.colors.bg.primary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Label = styled.label`
  font-family: ${tokens.fonts.accent};
  font-size: 0.65rem;
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
  font-family: ${tokens.fonts.mono};
  font-size: 0.8rem;
  padding: 6px 8px;
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
  font-size: 0.82rem;
  padding: 6px 8px;
  outline: none;
  box-sizing: border-box;
`;

const Muted = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 0.68rem;
  color: ${tokens.colors.text.muted};
`;

const Empty = styled.div`
  color: ${tokens.colors.text.muted};
  font-size: 0.8rem;
  padding: 8px;
  text-align: center;
  border: 1px dashed ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
`;

interface Props {
  assertions: AssertionSpec[];
  onChange: (next: AssertionSpec[]) => void;
  passThreshold: number | null;
  onThresholdChange: (next: number | null) => void;
}

function formatExpected(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function parseExpected(raw: string, type: AssertionSpec['type']): unknown {
  if (raw === '') return null;
  if (type === 'json_path_numeric') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  // Try JSON first (for booleans, arrays, objects), fall back to string
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function AssertionsEditor({
  assertions,
  onChange,
  passThreshold,
  onThresholdChange,
}: Props) {
  const [newType, setNewType] = useState<AssertionSpec['type']>('json_path_exact');

  const update = (idx: number, patch: Partial<AssertionSpec>) => {
    const next = assertions.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const remove = (idx: number) => {
    const next = assertions.slice();
    next.splice(idx, 1);
    onChange(next);
  };

  const add = () => {
    const base: AssertionSpec = {
      name: `${TYPE_LABELS[newType]} check`,
      type: newType,
      path: newType === 'llm_judge' ? null : '$.',
      expected: null,
      weight: 1.0,
      options: newType === 'json_path_numeric' ? { tolerance: 0.05 }
              : newType === 'json_path_contains' ? { case_insensitive: true }
              : newType === 'json_path_exact' ? { case_insensitive: false }
              : { threshold: 0.7 },
    };
    onChange([...assertions, base]);
  };

  return (
    <Wrap>
      <Header>
        <Title>Assertions ({assertions.length})</Title>
        <Row>
          <Select value={newType} onChange={(e) => setNewType(e.target.value as AssertionSpec['type'])}>
            {(Object.keys(TYPE_LABELS) as AssertionSpec['type'][]).map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </Select>
          <Button size="sm" onClick={add}>+ Add assertion</Button>
        </Row>
      </Header>

      <Row style={{ gap: 12 }}>
        <Label style={{ alignSelf: 'center' }}>Pass threshold</Label>
        <Input
          type="number"
          min={0} max={1} step={0.05}
          style={{ width: 90 }}
          value={passThreshold ?? ''}
          placeholder="0.5"
          onChange={(e) => {
            const v = e.target.value;
            onThresholdChange(v === '' ? null : Number(v));
          }}
        />
        <Muted>Overall score required for this case to pass. Defaults to run-level threshold if left blank.</Muted>
      </Row>

      {assertions.length === 0 && (
        <Empty>
          No assertions — test case will be scored with the run's global strategy (string similarity or LLM judge).
        </Empty>
      )}

      {assertions.map((a, i) => (
        <Card key={i}>
          <Row>
            <Badge color="primary">{TYPE_LABELS[a.type] || a.type}</Badge>
            <Input
              style={{ flex: 1, minWidth: 200 }}
              value={a.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Display name"
            />
            <Input
              style={{ width: 70 }}
              type="number"
              min={0} step={0.25}
              value={a.weight ?? 1.0}
              onChange={(e) => update(i, { weight: Number(e.target.value) })}
              title="Weight (for aggregation)"
            />
            <Button size="sm" variant="ghost" onClick={() => remove(i)} style={{ color: tokens.colors.accent.error }}>
              ✕
            </Button>
          </Row>

          <Muted>{TYPE_HINTS[a.type]}</Muted>

          {a.type !== 'llm_judge' || a.path ? (
            <Row style={{ gap: 8 }}>
              <Label style={{ alignSelf: 'center', minWidth: 70 }}>JSONPath</Label>
              <Input
                style={{ flex: 1 }}
                value={a.path || ''}
                onChange={(e) => update(i, { path: e.target.value })}
                placeholder="$.extracted_data.classification"
              />
            </Row>
          ) : (
            <Muted>No path set → judge evaluates the whole output.</Muted>
          )}

          <Row style={{ gap: 8 }}>
            <Label style={{ alignSelf: 'center', minWidth: 70 }}>Expected</Label>
            <Input
              style={{ flex: 1 }}
              value={formatExpected(a.expected)}
              onChange={(e) => update(i, { expected: parseExpected(e.target.value, a.type) })}
              placeholder={
                a.type === 'json_path_numeric' ? '42'
                : a.type === 'json_path_contains' ? 'keyword1,keyword2'
                : 'Grievance (leave blank to auto-extract from expected_output via the path)'
              }
            />
          </Row>

          {/* Type-specific options */}
          {a.type === 'json_path_numeric' && (
            <Row style={{ gap: 8 }}>
              <Label style={{ alignSelf: 'center', minWidth: 70 }}>Tolerance</Label>
              <Input
                type="number"
                min={0} step={0.01}
                style={{ width: 120 }}
                value={(a.options?.tolerance as number) ?? 0.05}
                onChange={(e) => update(i, { options: { ...a.options, tolerance: Number(e.target.value) } })}
              />
            </Row>
          )}

          {(a.type === 'json_path_exact' || a.type === 'json_path_contains') && (
            <Row style={{ gap: 8 }}>
              <label style={{ fontSize: '0.75rem', color: tokens.colors.text.secondary, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={(a.options?.case_insensitive as boolean) ?? (a.type === 'json_path_contains')}
                  onChange={(e) => update(i, { options: { ...a.options, case_insensitive: e.target.checked } })}
                />
                Case-insensitive
              </label>
            </Row>
          )}

          {a.type === 'llm_judge' && (
            <Row style={{ gap: 8 }}>
              <Label style={{ alignSelf: 'center', minWidth: 70 }}>Pass at</Label>
              <Input
                type="number"
                min={0} max={1} step={0.05}
                style={{ width: 90 }}
                value={(a.options?.threshold as number) ?? 0.7}
                onChange={(e) => update(i, { options: { ...a.options, threshold: Number(e.target.value) } })}
              />
              <Muted>Assertion passes when judge score ≥ this value.</Muted>
            </Row>
          )}
        </Card>
      ))}
    </Wrap>
  );
}
