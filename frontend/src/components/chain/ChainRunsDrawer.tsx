import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Button } from '../common/Button';
import type { ChainRunListItem, ChainRunStatus } from '../../types';

const Drawer = styled.div`
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  background: ${tokens.colors.bg.secondary};
  display: flex;
  flex-direction: column;
  /* The parent (RightPane) is a flex column that hands the canvas the bulk of
     the space. Without flex-shrink:0 + a real min-height, the drawer collapses
     to barely-one-row at common viewport sizes. */
  flex-shrink: 0;
  min-height: 320px;
  max-height: 60vh;
  overflow: hidden;
`;

const Header = styled.div`
  padding: 10px 12px;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const Title = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${tokens.colors.text.secondary};
`;

const Body = styled.div`
  overflow-y: auto;
`;

const Row = styled.div<{ $active: boolean }>`
  display: grid;
  grid-template-columns: 90px 1fr auto auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  background: ${({ $active }) => ($active ? tokens.colors.bg.tertiary : 'transparent')};
  border-left: 3px solid
    ${({ $active }) => ($active ? tokens.colors.accent.primary : 'transparent')};
  cursor: pointer;
  font-size: 0.8rem;

  &:hover {
    background: ${tokens.colors.bg.hover};
  }
`;

const StatusBadge = styled.span<{ $status: ChainRunStatus }>`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: ${({ $status }) => {
    switch ($status) {
      case 'running': return tokens.colors.accent.warning;
      case 'completed': return tokens.colors.accent.success;
      case 'failed': return tokens.colors.accent.error;
      case 'pending':
      default: return tokens.colors.border.strong;
    }
  }};
  color: ${tokens.colors.bg.primary};
`;

const Empty = styled.div`
  padding: ${tokens.spacing.lg};
  text-align: center;
  font-size: 0.8rem;
  color: ${tokens.colors.text.muted};
`;

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function durationLabel(started: string | null, completed: string | null): string {
  if (!started) return '';
  const end = completed ? new Date(completed).getTime() : Date.now();
  const ms = end - new Date(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return `${s.toFixed(1)}s`;
}

interface Props {
  runs: ChainRunListItem[];
  activeRunId: string | null;
  onSelect: (runId: string) => void;
  onDelete: (runId: string) => void;
  onClose: () => void;
}

export function ChainRunsDrawer({ runs, activeRunId, onSelect, onDelete, onClose }: Props) {
  return (
    <Drawer>
      <Header>
        <Title>Runs ({runs.length})</Title>
        <Button size="sm" variant="ghost" onClick={onClose}>Hide</Button>
      </Header>
      <Body>
        {runs.length === 0 ? (
          <Empty>No runs yet — click "Run" to execute the chain.</Empty>
        ) : (
          runs.map((r) => (
            <Row key={r.id} $active={r.id === activeRunId} onClick={() => onSelect(r.id)}>
              <StatusBadge $status={r.status}>{r.status}</StatusBadge>
              <span style={{ color: tokens.colors.text.secondary }}>
                {formatTime(r.started_at || r.created_at)}
                {r.started_at && (
                  <span style={{ color: tokens.colors.text.muted, marginLeft: 8 }}>
                    {durationLabel(r.started_at, r.completed_at)}
                  </span>
                )}
              </span>
              <span style={{ color: tokens.colors.text.muted, fontSize: '0.72rem' }}>
                {r.error_message ? r.error_message.slice(0, 40) : ''}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(r.id);
                }}
              >
                ×
              </Button>
            </Row>
          ))
        )}
      </Body>
    </Drawer>
  );
}
