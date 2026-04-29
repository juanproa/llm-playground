import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Button } from '../common/Button';
import type { ChainListItem } from '../../types';

const List = styled.div`
  display: flex;
  flex-direction: column;
  overflow: auto;
`;

const Item = styled.div<{ $active: boolean }>`
  padding: ${tokens.spacing.md};
  background: ${({ $active }) => ($active ? tokens.colors.bg.tertiary : 'transparent')};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  border-left: 3px solid ${({ $active }) => ($active ? tokens.colors.accent.primary : 'transparent')};
  color: ${tokens.colors.text.primary};
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: ${tokens.colors.bg.hover};
  }
`;

const Name = styled.div`
  font-family: ${tokens.fonts.accent};
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 4px;
`;

const Meta = styled.div`
  font-size: 0.72rem;
  color: ${tokens.colors.text.muted};
`;

const Empty = styled.div`
  padding: ${tokens.spacing.lg};
  text-align: center;
  color: ${tokens.colors.text.muted};
  font-size: 0.85rem;
`;

const Actions = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 8px;
`;

interface Props {
  chains: ChainListItem[];
  selectedChainId: string | null;
  onSelect: (chain: ChainListItem) => void;
  onRename: (chain: ChainListItem) => void;
  onDuplicate: (chain: ChainListItem) => void;
  onDelete: (chain: ChainListItem) => void;
}

export function ChainList({ chains, selectedChainId, onSelect, onRename, onDuplicate, onDelete }: Props) {
  if (chains.length === 0) {
    return <Empty>No chains yet. Click "+ New Chain" to get started.</Empty>;
  }
  return (
    <List>
      {chains.map((c) => (
        <Item
          key={c.id}
          $active={c.id === selectedChainId}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(c)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(c);
            }
          }}
        >
          <Name>{c.name}</Name>
          <Meta>
            {c.node_count} node{c.node_count === 1 ? '' : 's'} · {c.edge_count} edge
            {c.edge_count === 1 ? '' : 's'}
          </Meta>
          {c.description && <Meta style={{ marginTop: 4 }}>{c.description}</Meta>}
          <Actions onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" onClick={() => onRename(c)}>
              Rename
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onDuplicate(c)}>
              Duplicate
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => onDelete(c)}
            >
              Delete
            </Button>
          </Actions>
        </Item>
      ))}
    </List>
  );
}
