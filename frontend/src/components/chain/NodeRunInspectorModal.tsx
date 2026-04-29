import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import type { ChainNode, ChainNodeRun } from '../../types';

const Section = styled.div`
  margin-top: ${tokens.spacing.md};
`;

const SectionTitle = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${tokens.colors.text.secondary};
  margin-bottom: 6px;
`;

const Pre = styled.pre`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  padding: 10px 14px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.78rem;
  color: ${tokens.colors.text.primary};
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
  margin: 0;
`;

const Empty = styled.div`
  font-size: 0.78rem;
  color: ${tokens.colors.text.muted};
  font-style: italic;
`;

const MetaRow = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
`;

function badgeColor(status: string): 'primary' | 'success' | 'warning' | 'error' {
  switch (status) {
    case 'completed': return 'success';
    case 'running':
    case 'skipped': return 'warning';
    case 'failed': return 'error';
    default: return 'primary';
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  node: ChainNode | null;
  nodeRun: ChainNodeRun | null;
}

export function NodeRunInspectorModal({ open, onClose, node, nodeRun }: Props) {
  if (!node || !nodeRun) return null;
  const latency = nodeRun.latency_ms != null ? `${nodeRun.latency_ms}ms` : null;

  return (
    <Modal title={`Run details — ${node.name}`} open={open} onClose={onClose} size="lg">
      <MetaRow>
        <Badge color={badgeColor(nodeRun.status)}>{nodeRun.status}</Badge>
        {latency && <span style={{ fontSize: '0.78rem', color: tokens.colors.text.muted }}>{latency}</span>}
        {nodeRun.skip_reason && (
          <span style={{ fontSize: '0.78rem', color: tokens.colors.text.muted }}>
            {nodeRun.skip_reason}
          </span>
        )}
      </MetaRow>

      <Section>
        <SectionTitle>Resolved prompt</SectionTitle>
        {nodeRun.resolved_input ? (
          <Pre>{nodeRun.resolved_input}</Pre>
        ) : (
          <Empty>(no resolved prompt — node hasn't run yet)</Empty>
        )}
      </Section>

      <Section>
        <SectionTitle>Output</SectionTitle>
        {nodeRun.output_text ? (
          <Pre>{nodeRun.output_text}</Pre>
        ) : (
          <Empty>(no output)</Empty>
        )}
      </Section>

      {nodeRun.error_message && (
        <Section>
          <SectionTitle>Error</SectionTitle>
          <Pre style={{ color: tokens.colors.accent.error }}>{nodeRun.error_message}</Pre>
        </Section>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: tokens.spacing.lg }}>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
