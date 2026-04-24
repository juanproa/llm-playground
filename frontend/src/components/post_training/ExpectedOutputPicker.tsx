/**
 * ExpectedOutputPicker — renders the test case's `expected_output` as a
 * clickable tree. Clicking a leaf value toggles an assertion on that field.
 *
 * Each click creates an AssertionSpec with:
 *   - path    = JSONPath to the clicked leaf (e.g. "$.extracted_data.classification")
 *   - expected = the actual value from expected_output (pinned, so the user
 *                can change or clear it later in the AssertionsEditor)
 *   - type    = auto-inferred from the value type
 *   - name    = derived from the path's last segment
 *   - options = sensible defaults (case-insensitive strings, 5% tolerance on floats)
 *
 * If the expected_output isn't parseable as JSON, the picker hides itself —
 * users add assertions manually in that case.
 */
import { useMemo, type JSX } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import type { AssertionSpec } from '../../types';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: ${tokens.colors.bg.primary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  padding: 10px 12px;
  max-height: 360px;
  overflow: auto;
`;

const Header = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${tokens.colors.text.muted};
  margin-bottom: 2px;
`;

const Line = styled.div<{ $indent: number }>`
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: ${({ $indent }) => $indent * 16}px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.78rem;
  color: ${tokens.colors.text.primary};
  white-space: nowrap;
  min-height: 22px;
`;

const Key = styled.span`
  color: ${tokens.colors.text.secondary};
`;

const Leaf = styled.button<{ $asserted: boolean; $disabled?: boolean }>`
  border: 1px solid ${({ $asserted }) => $asserted ? tokens.colors.accent.primary : 'transparent'};
  background: ${({ $asserted }) => $asserted ? 'rgba(108,92,231,0.15)' : 'transparent'};
  color: ${({ $asserted }) => $asserted ? tokens.colors.accent.primary : tokens.colors.text.primary};
  border-radius: ${tokens.radii.sm};
  padding: 2px 6px;
  font-family: inherit;
  font-size: inherit;
  cursor: ${({ $disabled }) => $disabled ? 'default' : 'pointer'};
  transition: all 0.12s;
  &:hover {
    ${({ $disabled, $asserted }) => $disabled ? '' : `
      background: ${$asserted ? 'rgba(108,92,231,0.25)' : tokens.colors.bg.tertiary};
      border-color: ${tokens.colors.accent.primary};
    `}
  }
`;

const Muted = styled.span`
  color: ${tokens.colors.text.muted};
`;

const Hint = styled.div`
  font-size: 0.72rem;
  color: ${tokens.colors.text.muted};
  margin-bottom: 6px;
`;

const BadJson = styled.div`
  font-size: 0.78rem;
  color: ${tokens.colors.text.muted};
  padding: 8px;
  text-align: center;
  border: 1px dashed ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
`;

/* ─── JSON extraction (handles markdown fences) ──────────────────────────── */

function extractJson(raw: string): unknown | null {
  if (!raw) return null;
  let t = raw.trim();
  // Try fenced block first
  const fence = t.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  if (fence) t = fence[1];
  // Find the outermost object/array
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  const starts = [firstObj, firstArr].filter((i) => i >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const lastObj = t.lastIndexOf('}');
  const lastArr = t.lastIndexOf(']');
  const end = Math.max(lastObj, lastArr);
  if (end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* ─── Walk + render ─────────────────────────────────────────────────────── */

type Primitive = string | number | boolean | null;

function isPrimitive(v: unknown): v is Primitive {
  const t = typeof v;
  return v === null || t === 'string' || t === 'number' || t === 'boolean';
}

function inferAssertion(path: string, value: Primitive): AssertionSpec {
  const key = path.split(/[.[\]]/).filter(Boolean).pop() || 'field';
  if (typeof value === 'number') {
    const isInt = Number.isInteger(value);
    return {
      name: `${key} = ${value}`,
      type: 'json_path_numeric',
      path,
      expected: value,
      weight: 1.0,
      options: { tolerance: isInt ? 0 : 0.05 },
    };
  }
  if (typeof value === 'boolean') {
    return {
      name: `${key} = ${value}`,
      type: 'json_path_exact',
      path,
      expected: value,
      weight: 1.0,
      options: { case_insensitive: false },
    };
  }
  if (value === null) {
    return {
      name: `${key} is null`,
      type: 'json_path_exact',
      path,
      expected: 'null',
      weight: 1.0,
      options: { case_insensitive: false },
    };
  }
  // string
  return {
    name: `${key} = "${value.length > 40 ? value.slice(0, 40) + '…' : value}"`,
    type: 'json_path_exact',
    path,
    expected: value,
    weight: 1.0,
    options: { case_insensitive: true },
  };
}

function formatValue(v: Primitive): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v.length > 60 ? v.slice(0, 60) + '…' : v}"`;
  return String(v);
}

/* ─── Recursive tree ─────────────────────────────────────────────────────── */

interface RenderRowsArgs {
  value: unknown;
  path: string;
  indent: number;
  isLast: boolean;
  assertedPaths: Set<string>;
  onToggle: (spec: AssertionSpec) => void;
  renderKey?: string | number;
}

function RenderRows({
  value, path, indent, assertedPaths, onToggle, renderKey,
}: RenderRowsArgs): JSX.Element[] {
  const rows: JSX.Element[] = [];
  const rowKey = (extra: string) => `${path || '$'}|${renderKey ?? ''}|${extra}`;

  // Empty string is also a primitive and clickable, so skip-by-type instead.
  if (isPrimitive(value)) {
    const asserted = assertedPaths.has(path);
    rows.push(
      <Line key={rowKey('prim')} $indent={indent}>
        {renderKey !== undefined && (
          <Key>
            {typeof renderKey === 'string' ? `"${renderKey}"` : `[${renderKey}]`}:
          </Key>
        )}
        <Leaf
          $asserted={asserted}
          onClick={() => onToggle(inferAssertion(path, value as Primitive))}
          title={asserted
            ? 'Remove assertion on this field'
            : 'Click to assert this field matches the expected value'
          }
        >
          {asserted && '✓ '}{formatValue(value as Primitive)}
        </Leaf>
      </Line>,
    );
    return rows;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      rows.push(
        <Line key={rowKey('empty_arr')} $indent={indent}>
          {renderKey !== undefined && (
            <Key>{typeof renderKey === 'string' ? `"${renderKey}"` : `[${renderKey}]`}:</Key>
          )}
          <Muted>[]</Muted>
        </Line>,
      );
      return rows;
    }
    rows.push(
      <Line key={rowKey('arr_open')} $indent={indent}>
        {renderKey !== undefined && (
          <Key>{typeof renderKey === 'string' ? `"${renderKey}"` : `[${renderKey}]`}:</Key>
        )}
        <Muted>[</Muted>
      </Line>,
    );
    value.forEach((child, i) => {
      rows.push(...RenderRows({
        value: child,
        path: `${path}[${i}]`,
        indent: indent + 1,
        isLast: i === value.length - 1,
        assertedPaths,
        onToggle,
        renderKey: i,
      }));
    });
    rows.push(
      <Line key={rowKey('arr_close')} $indent={indent}>
        <Muted>]</Muted>
      </Line>,
    );
    return rows;
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      rows.push(
        <Line key={rowKey('empty_obj')} $indent={indent}>
          {renderKey !== undefined && (
            <Key>{typeof renderKey === 'string' ? `"${renderKey}"` : `[${renderKey}]`}:</Key>
          )}
          <Muted>{'{}'}</Muted>
        </Line>,
      );
      return rows;
    }
    rows.push(
      <Line key={rowKey('obj_open')} $indent={indent}>
        {renderKey !== undefined && (
          <Key>{typeof renderKey === 'string' ? `"${renderKey}"` : `[${renderKey}]`}:</Key>
        )}
        <Muted>{'{'}</Muted>
      </Line>,
    );
    entries.forEach(([k, v], i) => {
      rows.push(...RenderRows({
        value: v,
        path: `${path}.${k}`,
        indent: indent + 1,
        isLast: i === entries.length - 1,
        assertedPaths,
        onToggle,
        renderKey: k,
      }));
    });
    rows.push(
      <Line key={rowKey('obj_close')} $indent={indent}>
        <Muted>{'}'}</Muted>
      </Line>,
    );
    return rows;
  }

  return rows;
}

/* ─── Component ──────────────────────────────────────────────────────────── */

interface Props {
  expectedOutput: string;
  assertions: AssertionSpec[];
  onToggle: (spec: AssertionSpec) => void;
}

export function ExpectedOutputPicker({ expectedOutput, assertions, onToggle }: Props) {
  const parsed = useMemo(() => extractJson(expectedOutput), [expectedOutput]);

  // Collect paths that already have an assertion (to show ✓ on leaves).
  const assertedPaths = useMemo(() => {
    const set = new Set<string>();
    for (const a of assertions) {
      if (a.path) set.add(a.path);
    }
    return set;
  }, [assertions]);

  if (parsed === null || parsed === undefined) {
    return (
      <BadJson>
        Expected output isn't valid JSON — can't auto-assert fields. Use "Add assertion" below for manual entries (including LLM-judge on the whole output).
      </BadJson>
    );
  }

  return (
    <Wrap>
      <Header>Click a field to assert it</Header>
      <Hint>
        Each click pins an assertion to that exact path + value. Click again to remove.
        Fine-tune weights, tolerances, and case-sensitivity below.
      </Hint>
      {RenderRows({
        value: parsed,
        path: '$',
        indent: 0,
        isLast: true,
        assertedPaths,
        onToggle,
      })}
    </Wrap>
  );
}
