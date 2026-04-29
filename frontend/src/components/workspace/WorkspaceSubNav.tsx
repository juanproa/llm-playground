import { NavLink } from 'react-router-dom';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';

const Bar = styled.div`
  display: flex;
  gap: 2px;
  padding: 0 ${tokens.spacing.lg};
  background: ${tokens.colors.bg.primary};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
`;

const Link = styled(NavLink)`
  font-family: ${tokens.fonts.accent};
  font-size: 0.8rem;
  font-weight: 500;
  padding: 10px 16px;
  border: none;
  background: transparent;
  text-decoration: none;
  color: ${tokens.colors.text.secondary};
  border-bottom: 2px solid transparent;
  transition: all 0.15s;

  &:hover {
    color: ${tokens.colors.text.primary};
    text-decoration: none;
  }

  &.active {
    color: ${tokens.colors.accent.primary};
    border-bottom-color: ${tokens.colors.accent.primary};
  }
`;

export function WorkspaceSubNav({ projectId }: { projectId: string }) {
  return (
    <Bar>
      <Link to={`/projects/${projectId}`} end>Workspace</Link>
      <Link to={`/projects/${projectId}/batch-compare`}>Batch Compare</Link>
      <Link to={`/projects/${projectId}/model-chain`}>Model Chain</Link>
      <Link to={`/projects/${projectId}/post-training`}>Post-Training</Link>
    </Bar>
  );
}
