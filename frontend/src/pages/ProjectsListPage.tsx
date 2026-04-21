import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';
import { TopBar } from '../components/layout/TopBar';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { ProjectCard } from '../components/project/ProjectCard';
import { CreateProjectModal } from '../components/project/CreateProjectModal';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useProjectStore } from '../stores/projectStore';
import { useLocation, useNavigate } from 'react-router-dom';

const Container = styled.div`
  padding: ${tokens.spacing.xl};
  max-width: 1200px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${tokens.spacing.xl};
`;

const Title = styled.h1`
  font-size: 1.5rem;
`;

const SearchRow = styled.div`
  margin-bottom: ${tokens.spacing.lg};
  max-width: 400px;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: ${tokens.spacing.lg};
`;

const EmptyState = styled.div`
  text-align: center;
  padding: ${tokens.spacing.xxl};
  color: ${tokens.colors.text.muted};
`;

export function ProjectsListPage() {
  const { projects, loading, fetchProjects } = useProjectStore();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  // Which section the user entered through — determines where project clicks go.
  const isPostTrainingMode = location.pathname.startsWith('/post-training');
  const title = isPostTrainingMode ? 'Post-Training Hub' : 'Projects';
  const subtitle = isPostTrainingMode
    ? 'Pick a project to open its post-training workspace'
    : undefined;

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const filtered = search
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;

  const projectDestination = (id: string) =>
    isPostTrainingMode ? `/projects/${id}/post-training` : `/projects/${id}`;

  return (
    <>
      <TopBar title={title} />
      <Container>
        <Header>
          <div>
            <Title>{title}</Title>
            {subtitle && (
              <div style={{
                fontSize: '0.85rem',
                color: tokens.colors.text.muted,
                marginTop: 4,
              }}>
                {subtitle}
              </div>
            )}
          </div>
          <Button onClick={() => setShowCreate(true)}>New Project</Button>
        </Header>

        <SearchRow>
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </SearchRow>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <LoadingSpinner />
          </div>
        ) : filtered.length > 0 ? (
          <Grid>
            {filtered.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => navigate(projectDestination(project.id))}
              />
            ))}
          </Grid>
        ) : (
          <EmptyState>
            <p>No projects yet. Create one to get started.</p>
          </EmptyState>
        )}

        <CreateProjectModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => navigate(projectDestination(id))}
        />
      </Container>
    </>
  );
}
