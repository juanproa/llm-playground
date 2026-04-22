import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'styled-components';
import { GlobalStyles } from './theme/globalStyles';
import { theme } from './theme/styled';
import { AppShell } from './components/layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsListPage } from './pages/ProjectsListPage';
import { ProjectWorkspacePage } from './pages/ProjectWorkspacePage';
import { PostTrainingPage } from './pages/PostTrainingPage';
import { ModelFusionPage } from './pages/ModelFusionPage';
import { BatchComparePage } from './pages/BatchComparePage';
import { ChatPage } from './pages/ChatPage';
import { KnowledgeBasePage } from './pages/KnowledgeBasePage';
import { ModelRegistryPage } from './pages/ModelRegistryPage';
import { SettingsPage } from './pages/SettingsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <GlobalStyles />
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/projects" element={<ProjectsListPage />} />
              <Route path="/post-training" element={<ProjectsListPage />} />
              <Route path="/projects/:projectId" element={<ProjectWorkspacePage />} />
              <Route path="/projects/:projectId/batch-compare" element={<BatchComparePage />} />
              <Route path="/projects/:projectId/post-training" element={<PostTrainingPage />} />
              <Route path="/model-fusion" element={<ModelFusionPage />} />
              <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/models" element={<ModelRegistryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/projects" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
