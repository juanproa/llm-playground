import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';
import { TopBar } from '../components/layout/TopBar';
import { SFTPanel } from '../components/post_training/SFTPanel';
import { FeedbackPanel } from '../components/post_training/FeedbackPanel';
import { BacktestPanel } from '../components/post_training/BacktestPanel';
import { WorkspaceSubNav } from '../components/workspace/WorkspaceSubNav';
import { useProjectStore } from '../stores/projectStore';

type Tab = 'sft' | 'feedback' | 'backtest';

const PageWrapper = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
`;

const TabBar = styled.div`
  display: flex;
  gap: 2px;
  padding: 0 ${tokens.spacing.lg};
  background: ${tokens.colors.bg.secondary};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
`;

const TabButton = styled.button<{ $active: boolean }>`
  font-family: ${tokens.fonts.accent};
  font-size: 0.825rem;
  font-weight: 500;
  padding: 12px 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-bottom: 2px solid ${({ $active }) => ($active ? tokens.colors.accent.primary : 'transparent')};
  color: ${({ $active }) => ($active ? tokens.colors.accent.primary : tokens.colors.text.secondary)};
  transition: all 0.15s;

  &:hover {
    color: ${tokens.colors.text.primary};
  }
`;

const TabContent = styled.div`
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

const NoProjectWrapper = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${tokens.spacing.md};
  color: ${tokens.colors.text.secondary};
  font-family: ${tokens.fonts.body};
`;

const NoProjectTitle = styled.h2`
  font-family: ${tokens.fonts.display};
  font-size: 1.25rem;
  color: ${tokens.colors.text.primary};
  margin: 0;
`;

const BackButton = styled.button`
  font-family: ${tokens.fonts.accent};
  font-size: 0.875rem;
  font-weight: 500;
  padding: 10px 20px;
  background: ${tokens.colors.accent.primary};
  color: white;
  border: none;
  border-radius: ${tokens.radii.md};
  cursor: pointer;
  transition: all 0.2s;
  &:hover { background: ${tokens.colors.accent.primaryHover}; }
`;

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'sft', label: 'Fine-Tuning (SFT)' },
  { id: 'feedback', label: 'Reinforcement Learning' },
  { id: 'backtest', label: 'Backtesting' },
];

export function PostTrainingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { currentProject, fetchProject } = useProjectStore();
  const [activeTab, setActiveTab] = useState<Tab>('sft');

  useEffect(() => {
    if (projectId) {
      fetchProject(projectId);
    }
  }, [projectId, fetchProject]);

  if (!projectId) {
    return (
      <PageWrapper>
        <TopBar title="Post-Training Hub" breadcrumb="Projects" />
        <NoProjectWrapper>
          <NoProjectTitle>No Project Selected</NoProjectTitle>
          <p>Select a project to access the Post-Training Hub.</p>
          <BackButton onClick={() => navigate('/projects')}>Go to Projects</BackButton>
        </NoProjectWrapper>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <TopBar
        title={currentProject ? `${currentProject.name} — Post-Training` : 'Post-Training Hub'}
        breadcrumb="Projects"
      />
      <WorkspaceSubNav projectId={projectId} />
      <TabBar>
        {TABS.map((tab) => (
          <TabButton
            key={tab.id}
            $active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </TabButton>
        ))}
      </TabBar>
      <TabContent>
        {activeTab === 'sft' && <SFTPanel projectId={projectId} />}
        {activeTab === 'feedback' && <FeedbackPanel projectId={projectId} />}
        {activeTab === 'backtest' && <BacktestPanel projectId={projectId} />}
      </TabContent>
    </PageWrapper>
  );
}
