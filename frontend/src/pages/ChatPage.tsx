/**
 * ChatPage — agentic-style chat interface for registered MLX Local / Ollama /
 * any other provider models.  Multi-turn, streaming, persistent sessions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';
import { TopBar } from '../components/layout/TopBar';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { chatApi } from '../api/chat';
import { useModelStore } from '../stores/modelStore';
import { useChatStream, mergeMessages, type StreamingMessage } from '../hooks/useChatStream';
import type { ChatMessage, ChatSession, ChatSessionWithMessages } from '../types';

/* ─── Layout ───────────────────────────────────────────────────────────── */

const Page = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: 300px 1fr;
  overflow: hidden;
`;

const LeftPane = styled.div`
  border-right: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const LeftHeader = styled.div`
  padding: ${tokens.spacing.md};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const LeftTitle = styled.h3`
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: ${tokens.colors.text.secondary};
  margin: 0;
`;

const LeftList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${tokens.spacing.md};
`;

const SessionCard = styled.div<{ $active?: boolean }>`
  padding: 10px 12px;
  background: ${({ $active }) => $active ? 'rgba(108,92,231,0.12)' : tokens.colors.bg.tertiary};
  border: 1px solid ${({ $active }) => $active ? tokens.colors.accent.primary : tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  margin-bottom: 8px;
  cursor: pointer;
  &:hover { border-color: ${tokens.colors.accent.primary}; }
`;

const SessionName = styled.div`
  font-family: ${tokens.fonts.body};
  font-size: 0.88rem;
  color: ${tokens.colors.text.primary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Muted = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 0.68rem;
  color: ${tokens.colors.text.muted};
  margin-top: 3px;
`;

const RightPane = styled.div`
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ChatHeader = styled.div`
  padding: ${tokens.spacing.md};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const ChatName = styled.div`
  font-family: ${tokens.fonts.body};
  font-size: 1rem;
  font-weight: 500;
  color: ${tokens.colors.text.primary};
`;

const Select = styled.select`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  color: ${tokens.colors.text.primary};
  padding: 6px 10px;
  font-size: 0.8rem;
  outline: none;
`;

const Scroll = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${tokens.spacing.lg};
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const Row = styled.div<{ $role: string }>`
  display: flex;
  justify-content: ${({ $role }) => $role === 'user' ? 'flex-end' : 'flex-start'};
`;

const Bubble = styled.div<{ $role: string; $isError?: boolean }>`
  max-width: 720px;
  padding: 12px 14px;
  border-radius: 12px;
  font-family: ${tokens.fonts.body};
  font-size: 0.92rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${tokens.colors.text.primary};
  background: ${({ $role, $isError }) =>
    $isError ? 'rgba(255, 82, 82, 0.08)'
    : $role === 'user' ? 'rgba(108, 92, 231, 0.12)'
    : tokens.colors.bg.tertiary};
  border: 1px solid ${({ $role, $isError }) =>
    $isError ? 'rgba(255, 82, 82, 0.3)'
    : $role === 'user' ? 'rgba(108, 92, 231, 0.3)'
    : tokens.colors.border.subtle};
`;

const BubbleMeta = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 0.68rem;
  color: ${tokens.colors.text.muted};
  margin-top: 6px;
`;

const InputBar = styled.div`
  padding: ${tokens.spacing.md};
  border-top: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  gap: 8px;
  align-items: flex-end;
`;

const InputBox = styled.textarea`
  flex: 1;
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  color: ${tokens.colors.text.primary};
  font-family: ${tokens.fonts.body};
  font-size: 0.92rem;
  padding: 10px 12px;
  outline: none;
  resize: vertical;
  min-height: 48px;
  max-height: 200px;
  &:focus { border-color: ${tokens.colors.accent.primary}; }
`;

const SystemPromptBar = styled.details`
  padding: 6px 12px;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  background: ${tokens.colors.bg.secondary};
  font-size: 0.8rem;
`;

const SystemPromptSummary = styled.summary`
  font-family: ${tokens.fonts.accent};
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${tokens.colors.text.muted};
  cursor: pointer;
  padding: 4px 0;
  &::marker { content: ''; }
  &::-webkit-details-marker { display: none; }
`;

const SystemPromptArea = styled.textarea`
  width: 100%;
  box-sizing: border-box;
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  color: ${tokens.colors.text.primary};
  font-family: ${tokens.fonts.mono};
  font-size: 0.78rem;
  padding: 8px 10px;
  outline: none;
  resize: vertical;
  min-height: 60px;
  margin-top: 6px;
`;

const Empty = styled.div`
  color: ${tokens.colors.text.muted};
  font-size: 0.9rem;
  text-align: center;
  padding: ${tokens.spacing.xl};
`;

const Cursor = styled.span`
  display: inline-block;
  width: 2px;
  height: 1em;
  background: ${tokens.colors.accent.primary};
  margin-left: 1px;
  vertical-align: text-bottom;
  animation: blink 1s ease-in-out infinite;
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
`;

/* ─── Modal for new-session ──────────────────────────────────────────── */

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
`;

const Modal = styled.div`
  background: ${tokens.colors.bg.secondary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  width: 480px;
  max-height: 90vh;
  overflow-y: auto;
`;

const ModalHead = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const ModalBody = styled.div`
  padding: ${tokens.spacing.md};
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.label`
  font-family: ${tokens.fonts.accent};
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${tokens.colors.text.muted};
`;

const Input = styled.input`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  color: ${tokens.colors.text.primary};
  padding: 8px 10px;
  font-size: 0.85rem;
  outline: none;
`;

/* ─── Page ───────────────────────────────────────────────────────────── */

function isStreaming(m: ChatMessage | StreamingMessage): m is StreamingMessage {
  return (m as StreamingMessage).isStreaming !== undefined;
}

export function ChatPage() {
  const { models, fetchModels } = useModelStore();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ChatSessionWithMessages | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newModelId, setNewModelId] = useState('');
  const [newSystemPrompt, setNewSystemPrompt] = useState('You are a helpful assistant.');

  const [input, setInput] = useState('');
  const [localSystemPrompt, setLocalSystemPrompt] = useState('');
  const [localModelId, setLocalModelId] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { pending, send, stop, reset } = useChatStream();

  // Load sessions + models on mount
  useEffect(() => {
    fetchModels();
    void loadSessions();
  }, [fetchModels]);

  const loadSessions = useCallback(async () => {
    try {
      const list = await chatApi.listSessions();
      setSessions(list);
    } catch {
      setSessions([]);
    }
  }, []);

  // Load selected session + reset streaming state
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      reset();
      return;
    }
    reset();
    void (async () => {
      try {
        const full = await chatApi.getSession(selectedId);
        setSelected(full);
        setLocalSystemPrompt(full.system_prompt ?? '');
        setLocalModelId(full.model_config_id);
      } catch {
        setSelected(null);
      }
    })();
  }, [selectedId, reset]);

  // Auto-scroll on new content
  const combined = useMemo(
    () => selected ? mergeMessages(selected.messages, pending) : [],
    [selected, pending],
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [combined, pending]);

  const enabledModels = useMemo(() => models.filter((m) => m.is_enabled), [models]);

  async function handleCreateSession() {
    if (!newName.trim() || !newModelId) return;
    try {
      const created = await chatApi.createSession({
        name: newName.trim(),
        model_config_id: newModelId,
        system_prompt: newSystemPrompt.trim() || undefined,
      });
      setSessions((prev) => [created, ...prev]);
      setSelectedId(created.id);
      setShowCreate(false);
      setNewName('');
      setNewSystemPrompt('You are a helpful assistant.');
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this chat? This cannot be undone.')) return;
    try {
      await chatApi.deleteSession(id);
      if (selectedId === id) setSelectedId(null);
      await loadSessions();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleSend() {
    if (!selectedId || !input.trim()) return;
    const msg = input.trim();
    setInput('');
    await send(selectedId, msg, async () => {
      // After the stream settles, reload the session from server so we have
      // authoritative message ids + stats
      const full = await chatApi.getSession(selectedId);
      setSelected(full);
      reset();
      // Bump the local sessions order
      await loadSessions();
    });
  }

  async function handleSystemPromptBlur() {
    if (!selected) return;
    if (localSystemPrompt === (selected.system_prompt ?? '')) return;
    try {
      const updated = await chatApi.updateSession(selected.id, {
        system_prompt: localSystemPrompt,
      });
      setSelected({ ...selected, ...updated });
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleModelChange(modelId: string) {
    if (!selected) return;
    setLocalModelId(modelId);
    try {
      const updated = await chatApi.updateSession(selected.id, {
        model_config_id: modelId,
      });
      setSelected({ ...selected, ...updated });
      await loadSessions();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isStreamingNow = pending !== null && pending[1].isStreaming;

  return (
    <>
      <TopBar title="Chat" />
      <Page>
        {/* Sessions list */}
        <LeftPane>
          <LeftHeader>
            <LeftTitle>Chats ({sessions.length})</LeftTitle>
            <Button size="sm" onClick={() => {
              if (enabledModels.length === 0) {
                alert('Register at least one model first (Model Registry).');
                return;
              }
              if (!newModelId && enabledModels[0]) {
                setNewModelId(enabledModels[0].id);
              }
              setShowCreate(true);
            }}>+ New</Button>
          </LeftHeader>
          <LeftList>
            {sessions.length === 0 && <Empty>No chats yet.</Empty>}
            {sessions.map((s) => {
              const m = models.find((x) => x.id === s.model_config_id);
              return (
                <SessionCard
                  key={s.id}
                  $active={selectedId === s.id}
                  onClick={() => setSelectedId(s.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <SessionName style={{ flex: 1 }}>{s.name}</SessionName>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                      style={{ color: tokens.colors.accent.error, fontSize: '0.72rem', padding: '2px 4px' }}
                    >
                      ✕
                    </Button>
                  </div>
                  <Muted>{m?.name ?? s.model_config_id.slice(0, 8)} · {m?.provider ?? '—'}</Muted>
                </SessionCard>
              );
            })}
          </LeftList>
        </LeftPane>

        {/* Conversation */}
        <RightPane>
          {!selected ? (
            <Empty style={{ marginTop: 80 }}>Pick a chat on the left, or start a new one.</Empty>
          ) : (
            <>
              <ChatHeader>
                <ChatName>{selected.name}</ChatName>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Label style={{ margin: 0 }}>Model</Label>
                  <Select value={localModelId} onChange={(e) => handleModelChange(e.target.value)}>
                    {enabledModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
                    ))}
                  </Select>
                </div>
              </ChatHeader>

              <SystemPromptBar>
                <SystemPromptSummary>System prompt {localSystemPrompt ? '' : '(empty)'}</SystemPromptSummary>
                <SystemPromptArea
                  value={localSystemPrompt}
                  onChange={(e) => setLocalSystemPrompt(e.target.value)}
                  onBlur={handleSystemPromptBlur}
                  placeholder="Optional: give the assistant a persona or instructions."
                />
              </SystemPromptBar>

              <Scroll ref={scrollRef}>
                {combined.length === 0 && (
                  <Empty>Empty chat. Say something to get started.</Empty>
                )}
                {combined.map((m, i) => {
                  const streaming = isStreaming(m);
                  const isAssistantStreaming = streaming && m.isStreaming;
                  const err = (m as StreamingMessage).error ?? (m as ChatMessage).error_message ?? null;
                  return (
                    <Row key={m.id ?? `pending-${i}`} $role={m.role}>
                      <Bubble $role={m.role} $isError={!!err}>
                        {m.content}
                        {isAssistantStreaming && <Cursor />}
                        {err && (
                          <BubbleMeta style={{ color: tokens.colors.accent.error }}>
                            error: {err}
                          </BubbleMeta>
                        )}
                        {!streaming && (m as ChatMessage).latency_ms != null && (
                          <BubbleMeta>
                            {(m as ChatMessage).latency_ms} ms
                            {(m as ChatMessage).tokens_out != null && <> · ~{(m as ChatMessage).tokens_out} tokens</>}
                          </BubbleMeta>
                        )}
                      </Bubble>
                    </Row>
                  );
                })}
              </Scroll>

              <InputBar>
                <InputBox
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
                  disabled={isStreamingNow}
                />
                {isStreamingNow ? (
                  <Button variant="danger" onClick={stop}>Stop</Button>
                ) : (
                  <Button onClick={handleSend} disabled={!input.trim()}>Send</Button>
                )}
              </InputBar>
            </>
          )}
        </RightPane>
      </Page>

      {showCreate && (
        <ModalOverlay onClick={() => setShowCreate(false)}>
          <Modal onClick={(e) => e.stopPropagation()}>
            <ModalHead>
              <LeftTitle>New Chat</LeftTitle>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Close</Button>
            </ModalHead>
            <ModalBody>
              <FormGroup>
                <Label>Name</Label>
                <Input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. MedGemma brainstorming"
                />
              </FormGroup>
              <FormGroup>
                <Label>Model</Label>
                <Select value={newModelId} onChange={(e) => setNewModelId(e.target.value)}>
                  <option value="">Select a model...</option>
                  {enabledModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
                  ))}
                </Select>
              </FormGroup>
              <FormGroup>
                <Label>System prompt (optional)</Label>
                <SystemPromptArea
                  value={newSystemPrompt}
                  onChange={(e) => setNewSystemPrompt(e.target.value)}
                  placeholder="Optional instructions the model sees on every turn"
                  style={{ minHeight: 80 }}
                />
              </FormGroup>
              <Button
                disabled={!newName.trim() || !newModelId}
                onClick={handleCreateSession}
              >
                Start Chat
              </Button>
            </ModalBody>
          </Modal>
        </ModalOverlay>
      )}
    </>
  );
}
