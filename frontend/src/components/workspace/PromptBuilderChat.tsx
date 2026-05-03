import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Button } from '../common/Button';
import { promptBuilderApi } from '../../api/promptBuilder';
import { useInferenceStore } from '../../stores/inferenceStore';
import { usePromptStore } from '../../stores/promptStore';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: ${tokens.spacing.lg};
  gap: ${tokens.spacing.md};
`;

const ChatMessages = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: ${tokens.spacing.md};
  margin-bottom: ${tokens.spacing.md};
`;

const Message = styled.div<{ $isUser?: boolean }>`
  padding: ${tokens.spacing.md};
  border-radius: ${tokens.radii.md};
  background: ${({ $isUser }) =>
    $isUser ? tokens.colors.accent.primary : tokens.colors.bg.tertiary};
  color: ${({ $isUser }) =>
    $isUser ? tokens.colors.bg.primary : tokens.colors.text.primary};
  font-size: 0.9rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-width: 100%;
`;

const SuggestionCard = styled.div`
  padding: ${tokens.spacing.lg};
  border: 2px solid ${tokens.colors.accent.success};
  border-radius: ${tokens.radii.md};
  background: ${tokens.colors.bg.tertiary};
  gap: ${tokens.spacing.md};
  display: flex;
  flex-direction: column;
`;

const SuggestionLabel = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: ${tokens.colors.accent.success};
  letter-spacing: 1px;
`;

const SuggestionText = styled.div`
  font-size: 0.9rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
`;

const PromptPreview = styled.div`
  background: ${tokens.colors.bg.primary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: ${tokens.spacing.md};
  font-family: ${tokens.fonts.mono};
  font-size: 0.8rem;
  line-height: 1.6;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
`;

const SuggestionActions = styled.div`
  display: flex;
  gap: ${tokens.spacing.md};
`;

const InputArea = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${tokens.spacing.md};
`;

const InputRow = styled.div`
  display: flex;
  gap: ${tokens.spacing.md};
  align-items: flex-end;
`;

const ModelSelector = styled.select`
  padding: ${tokens.spacing.sm} ${tokens.spacing.md};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  background: ${tokens.colors.bg.primary};
  color: ${tokens.colors.text.primary};
  font-family: ${tokens.fonts.body};
  font-size: 0.85rem;
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: ${tokens.colors.accent.primary};
  }
`;

const TextArea = styled.textarea`
  flex: 1;
  padding: ${tokens.spacing.md};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  background: ${tokens.colors.bg.primary};
  color: ${tokens.colors.text.primary};
  font-family: ${tokens.fonts.body};
  font-size: 0.9rem;
  resize: vertical;
  min-height: 60px;
  max-height: 120px;

  &:focus {
    outline: none;
    border-color: ${tokens.colors.accent.primary};
  }
`;

const ErrorMessage = styled.div`
  padding: ${tokens.spacing.md};
  border-radius: ${tokens.radii.md};
  background: ${tokens.colors.accent.error}22;
  border: 1px solid ${tokens.colors.accent.error};
  color: ${tokens.colors.accent.error};
  font-size: 0.85rem;
`;

const LoadingSpinner = styled.div`
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: ${tokens.colors.accent.primary};
  animation: pulse 1.5s ease-in-out infinite;

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
`;

export interface PromptBuilderChatProps {
  projectId: string;
  runId: string;
  promptVersionId?: string;
  modelConfigId?: string;
  models?: any[];
  onVersionCreated: (versionId: string) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface SuggestionState {
  show: boolean;
  reasoning: string;
  proposedPrompt: string;
  explanation: string;
}

export function PromptBuilderChat({
  projectId,
  runId,
  models = [],
  onVersionCreated,
}: PromptBuilderChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestionState>({
    show: false,
    reasoning: '',
    proposedPrompt: '',
    explanation: '',
  });
  const [approvingChange, setApprovingChange] = useState(false);
  const [helperModelId, setHelperModelId] = useState<string | undefined>(
    models.find((m) => m.model_id?.includes('claude'))?.id
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { fetchHistory } = useInferenceStore();
  const { fetchPrompts } = usePromptStore();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSendMessage = async () => {
    if (!userInput.trim()) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: userInput.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setUserInput('');
    setError(null);
    setLoading(true);

    try {
      const response = await promptBuilderApi.askHelper(projectId, {
        run_id: runId,
        user_question: userMessage.content,
        helper_model_config_id: helperModelId,
      });

      // Add assistant message
      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: response.reasoning,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // If there's a suggestion, show the dialog
      if (response.suggestion === 'improve_prompt' && response.proposed_prompt) {
        setSuggestion({
          show: true,
          reasoning: response.reasoning,
          proposedPrompt: response.proposed_prompt,
          explanation: response.explanation || '',
        });
      } else if (response.suggestion === 'error' && response.error_message) {
        setError(response.error_message);
      } else if (response.suggestion === 'no_change') {
        setError('No changes suggested. Try asking differently.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get response from helper LLM');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveChange = async () => {
    if (!suggestion.proposedPrompt) return;

    setApprovingChange(true);
    setError(null);

    try {
      const response = await promptBuilderApi.approveChange(projectId, {
        run_id: runId,
        proposed_prompt: suggestion.proposedPrompt,
        explanation: suggestion.explanation,
      });

      // Close suggestion dialog
      setSuggestion((prev) => ({ ...prev, show: false }));

      // Add success message
      const successMessage: ChatMessage = {
        id: `msg-${Date.now()}-success`,
        role: 'assistant',
        content: `✓ New prompt version created (v${response.version_number}) and ran successfully. The new output has been generated.`,
      };
      setMessages((prev) => [...prev, successMessage]);

      // Refetch history and prompts
      await fetchHistory(projectId);
      await fetchPrompts(projectId);

      // Notify parent about new version
      onVersionCreated(response.version_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply changes');
    } finally {
      setApprovingChange(false);
    }
  };

  const handleRejectChange = () => {
    setSuggestion((prev) => ({ ...prev, show: false }));
  };

  return (
    <Container>
      <ChatMessages>
        {messages.length === 0 && (
          <Message style={{ textAlign: 'center', color: tokens.colors.text.muted }}>
            Ask the AI helper how to improve this prompt. For example: "Why is the output too verbose?" or "Make it more structured"
          </Message>
        )}
        {messages.map((msg) => (
          <Message key={msg.id} $isUser={msg.role === 'user'}>
            {msg.content}
          </Message>
        ))}
        {loading && (
          <Message style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LoadingSpinner /> Thinking...
          </Message>
        )}
        {suggestion.show && (
          <SuggestionCard>
            <SuggestionLabel>💡 Suggested Change</SuggestionLabel>
            <div>
              <div style={{ marginBottom: tokens.spacing.md, fontSize: '0.85rem', color: tokens.colors.text.secondary }}>
                <strong>Explanation:</strong>
              </div>
              <SuggestionText>{suggestion.explanation}</SuggestionText>
            </div>
            <div>
              <div style={{ marginBottom: tokens.spacing.sm, fontSize: '0.85rem', color: tokens.colors.text.secondary }}>
                <strong>New Prompt:</strong>
              </div>
              <PromptPreview>{suggestion.proposedPrompt}</PromptPreview>
            </div>
            <SuggestionActions>
              <Button
                variant="primary"
                onClick={handleApproveChange}
                disabled={approvingChange}
              >
                {approvingChange ? 'Approving...' : 'Approve & Run'}
              </Button>
              <Button
                variant="ghost"
                onClick={handleRejectChange}
                disabled={approvingChange}
              >
                Reject
              </Button>
            </SuggestionActions>
          </SuggestionCard>
        )}
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div ref={messagesEndRef} />
      </ChatMessages>

      <InputArea>
        {models.length > 0 && (
          <div style={{ fontSize: '0.8rem', color: tokens.colors.text.secondary }}>
            Helper Model:
            <ModelSelector
              value={helperModelId || ''}
              onChange={(e) => setHelperModelId(e.target.value || undefined)}
              disabled={loading || approvingChange}
            >
              <option value="">Default (Claude or first available)</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </ModelSelector>
          </div>
        )}
        <InputRow>
          <TextArea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                handleSendMessage();
              }
            }}
            placeholder="Ask for prompt improvements... (Ctrl+Enter to send)"
            disabled={loading || approvingChange}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!userInput.trim() || loading || approvingChange}
          >
            Send
          </Button>
        </InputRow>
      </InputArea>
    </Container>
  );
}
