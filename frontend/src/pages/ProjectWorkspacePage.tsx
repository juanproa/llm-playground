import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WorkspaceSubNav } from '../components/workspace/WorkspaceSubNav';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';
import { TopBar } from '../components/layout/TopBar';
import { InputPanel, type RagOverride } from '../components/workspace/InputPanel';
import { PromptEditor } from '../components/workspace/PromptEditor';
import { ModelSelector } from '../components/workspace/ModelSelector';
import { ResultsPanel } from '../components/workspace/ResultsPanel';
import { RunButton } from '../components/workspace/RunButton';
import { CompareButton } from '../components/workspace/CompareButton';
import { ComparisonModal } from '../components/workspace/ComparisonModal';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useProjectStore } from '../stores/projectStore';
import { usePromptStore } from '../stores/promptStore';
import { useModelStore } from '../stores/modelStore';
import { useInferenceStore } from '../stores/inferenceStore';
import { useStreamingInference } from '../hooks/useStreamingInference';
import { useComparisonInference } from '../hooks/useComparisonInference';
import type { Prompt, PromptVersion, ModelConfig, Document } from '../types';

const WorkspaceLayout = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`;

const LeftPanel = styled.div`
  width: 50%;
  min-width: 400px;
  overflow-y: auto;
  padding: ${tokens.spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${tokens.spacing.md};
  border-right: 1px solid ${tokens.colors.border.subtle};
`;

const RightPanel = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${tokens.spacing.lg};
`;

const CenterLoader = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
`;

const ButtonRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: ${tokens.spacing.md} 0;
`;

export function ProjectWorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { currentProject, fetchProject } = useProjectStore();
  const { prompts, fetchPrompts } = usePromptStore();
  const { models } = useModelStore();
  const { fetchHistory } = useInferenceStore();
  const { startStream, stopStream } = useStreamingInference();
  const comparison = useComparisonInference();

  const [inputText, setInputText] = useState('');
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<PromptVersion | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelConfig | null>(null);
  const [isDocUploading, setIsDocUploading] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonModels, setComparisonModels] = useState<[ModelConfig | null, ModelConfig | null]>([null, null]);
  const [ragOverride, setRagOverride] = useState<RagOverride>({ mode: 'prompt' });
  const [promptBuilderEnabled, setPromptBuilderEnabled] = useState(false);
  const [selectedHistoryRunId, setSelectedHistoryRunId] = useState<string | null>(null);

  // Translate the per-call RAG override into the fields the inference API
  // expects (request-level override → else fall back to prompt-version binding).
  const ragFields = (): { kb_id?: string | null; kb_top_k?: number; rag_override_none?: boolean } => {
    if (ragOverride.mode === 'off') return { rag_override_none: true };
    if (ragOverride.mode === 'custom') return { kb_id: ragOverride.kbId || null, kb_top_k: ragOverride.topK };
    return {}; // "prompt" → send nothing, backend reads prompt_version defaults
  };

  useEffect(() => {
    if (projectId) {
      fetchProject(projectId);
      fetchPrompts(projectId);
      fetchHistory(projectId);
    }
  }, [projectId, fetchProject, fetchPrompts, fetchHistory]);

  const canRun = !!selectedVersion && !!selectedModel && (!!inputText.trim() || !!selectedDocument) && !isDocUploading;
  const canCompare = !!selectedVersion && (!!inputText.trim() || !!selectedDocument) && !isDocUploading;

  const handleRun = () => {
    if (!projectId || !selectedVersion || !selectedModel) return;
    startStream({
      projectId,
      prompt_version_id: selectedVersion.id,
      model_config_id: selectedModel.id,
      document_id: selectedDocument?.id,
      input_text: inputText,
      ...ragFields(),
    });
  };

  const handleCompare = (modelA: ModelConfig, modelB: ModelConfig) => {
    if (!projectId || !selectedVersion) return;
    setComparisonModels([modelA, modelB]);
    setShowComparison(true);
    comparison.startComparison({
      projectId,
      prompt_version_id: selectedVersion.id,
      document_id: selectedDocument?.id,
      input_text: inputText,
      modelA_id: modelA.id,
      modelB_id: modelB.id,
      ...ragFields(),
    });
  };

  if (!currentProject) {
    return <CenterLoader><LoadingSpinner /></CenterLoader>;
  }

  return (
    <>
      <TopBar title={currentProject.name} breadcrumb="Projects" />
      <WorkspaceSubNav projectId={projectId!} />
      <WorkspaceLayout>
        <LeftPanel>
          <InputPanel
            projectId={currentProject.id}
            inputText={inputText}
            onInputTextChange={setInputText}
            selectedDocument={selectedDocument}
            onDocumentSelect={setSelectedDocument}
            onUploadingChange={setIsDocUploading}
            selectedVersion={selectedVersion}
            onRagOverrideChange={setRagOverride}
          />
          <PromptEditor
            projectId={currentProject.id}
            prompts={prompts}
            selectedPrompt={selectedPrompt}
            selectedVersion={selectedVersion}
            onSelectPrompt={setSelectedPrompt}
            onSelectVersion={setSelectedVersion}
          />
          <ModelSelector
            selectedModel={selectedModel}
            onSelectModel={setSelectedModel}
          />
          <ButtonRow>
            <RunButton disabled={!canRun} onRun={handleRun} onStop={stopStream} />
            <CompareButton disabled={!canCompare} onCompare={handleCompare} />
          </ButtonRow>
        </LeftPanel>
        <RightPanel>
          <ResultsPanel
            projectId={currentProject.id}
            models={models}
            prompts={prompts}
            promptBuilderEnabled={promptBuilderEnabled}
            setPromptBuilderEnabled={setPromptBuilderEnabled}
            selectedHistoryRunId={selectedHistoryRunId}
            setSelectedHistoryRunId={setSelectedHistoryRunId}
            selectedVersion={selectedVersion}
            selectedModel={selectedModel}
            onVersionCreated={(versionId: string) => {
              // Find the new version in the prompts and select it
              const newVersion = prompts
                .flatMap((p) => p.versions)
                .find((v) => v.id === versionId);
              if (newVersion) setSelectedVersion(newVersion);
            }}
          />
        </RightPanel>
      </WorkspaceLayout>

      <ComparisonModal
        open={showComparison}
        onClose={() => setShowComparison(false)}
        onStop={comparison.stopComparison}
        slots={comparison.slots}
        models={comparisonModels}
        isActive={comparison.isActive}
      />
    </>
  );
}
