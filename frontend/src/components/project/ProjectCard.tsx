import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import type { Project } from '../../types';

const StyledCard = styled(Card)`
  cursor: pointer;
  &:hover {
    border-color: ${tokens.colors.accent.primary};
  }
`;

const ProjectName = styled.h3`
  font-family: ${tokens.fonts.display};
  font-size: 1.05rem;
  margin-bottom: 8px;
`;

const ProjectDesc = styled.p`
  font-size: 0.85rem;
  color: ${tokens.colors.text.secondary};
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const Meta = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.75rem;
  color: ${tokens.colors.text.muted};
`;

export function ProjectCard({
  project,
  onOpen,
}: {
  project: Project;
  onOpen?: () => void;
}) {
  const navigate = useNavigate();
  const handleClick = onOpen ?? (() => navigate(`/projects/${project.id}`));
  return (
    <StyledCard onClick={handleClick}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <ProjectName>{project.name}</ProjectName>
        <Badge color={project.status === 'active' ? 'success' : 'secondary'}>
          {project.status}
        </Badge>
      </div>
      {project.description && <ProjectDesc>{project.description}</ProjectDesc>}
      <Meta>
        <span>Created {new Date(project.created_at).toLocaleDateString()}</span>
      </Meta>
    </StyledCard>
  );
}
