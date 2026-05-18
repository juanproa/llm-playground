import { useCallback, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import type { SlotState } from '../../hooks/useComparisonInference';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import type { ModelConfig } from '../../types';
import { parseThinking, stripThinkingFromStream } from '../../utils/thinkingFilter';

/* ── Styled Components ── */

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 2000;
  display: flex;
  flex-direction: column;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: ${tokens.colors.bg.secondary};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  flex-shrink: 0;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const Title = styled.h2`
  font-family: ${tokens.fonts.display};
  font-size: 1.15rem;
  font-weight: 600;
  color: ${tokens.colors.text.primary};
`;

const SyncToggle = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  font-weight: 500;
  color: ${({ $active }) => $active ? tokens.colors.accent.primary : tokens.colors.text.muted};
  background: ${({ $active }) => $active ? 'rgba(108, 92, 231, 0.12)' : tokens.colors.bg.tertiary};
  border: 1px solid ${({ $active }) => $active ? tokens.colors.accent.primary : tokens.colors.border.subtle};
  border-radius: 100px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: ${tokens.colors.accent.primary};
    color: ${tokens.colors.accent.primary};
  }
`;

const PanelGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: ${tokens.colors.border.subtle};
  flex: 1;
  min-height: 0;
`;

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  background: ${tokens.colors.bg.primary};
  min-height: 0;
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: ${tokens.colors.bg.secondary};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  flex-shrink: 0;
`;

const ModelName = styled.div`
  font-family: ${tokens.fonts.body};
  font-size: 0.9rem;
  font-weight: 600;
  color: ${tokens.colors.text.primary};
`;

const ModelProvider = styled.span`
  font-family: ${tokens.fonts.mono};
  font-size: 0.7rem;
  color: ${tokens.colors.text.muted};
  margin-left: 8px;
`;

const PanelBody = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  min-height: 0;
`;

const OutputText = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 0.85rem;
  line-height: 1.7;
  color: ${tokens.colors.text.primary};
  white-space: pre-wrap;
  word-break: break-word;
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const Cursor = styled.span`
  display: inline-block;
  width: 8px;
  height: 16px;
  background: ${tokens.colors.accent.primary};
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: ${pulse} 1s ease-in-out infinite;
`;

const ThinkingIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: ${tokens.fonts.accent};
  font-size: 0.8rem;
  color: ${tokens.colors.accent.primary};
  margin-bottom: 12px;
  opacity: 0.8;
`;

const ThinkingToggle = styled.details`
  margin-bottom: 12px;
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  overflow: hidden;
`;

const ThinkingSummary = styled.summary`
  padding: 8px 12px;
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  color: ${tokens.colors.text.muted};
  background: rgba(108, 92, 231, 0.06);
  cursor: pointer;
  user-select: none;

  &:hover { color: ${tokens.colors.text.secondary}; }
  &::marker { content: ''; }
  &::-webkit-details-marker { display: none; }
`;

const ThinkingBody = styled.div`
  padding: 10px 12px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.75rem;
  line-height: 1.6;
  color: ${tokens.colors.text.muted};
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
  border-top: 1px solid ${tokens.colors.border.subtle};
  background: ${tokens.colors.bg.secondary};
`;

const Placeholder = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 200px;
  color: ${tokens.colors.text.muted};
  font-size: 0.9rem;
`;

const ErrorText = styled.div`
  color: ${tokens.colors.accent.error};
  font-size: 0.85rem;
  margin-bottom: 12px;
`;

// Exported for future use (rating, winner selection, export)
export const ComparisonFooter = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: ${tokens.colors.border.subtle};
  flex-shrink: 0;
`;

const FooterPanel = styled.div`
  display: flex;
  gap: 20px;
  padding: 10px 20px;
  background: ${tokens.colors.bg.secondary};
  font-size: 0.75rem;
  color: ${tokens.colors.text.muted};
`;

const MetaStat = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;

  strong {
    color: ${tokens.colors.text.secondary};
    font-weight: 600;
  }
`;

/* ── Component ── */

interface Props {
  open: boolean;
  onClose: () => void;
  onStop: () => void;
  slots: [SlotState, SlotState];
  models: [ModelConfig | null, ModelConfig | null];
  isActive: boolean;
  footer?: React.ReactNode;
}

export function ComparisonModal({ open, onClose, onStop, slots, models, isActive, footer }: Props) {
  const [syncScroll, setSyncScroll] = useState(true);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const scrollingRef = useRef(false);

  const handleScroll = useCallback((source: 'left' | 'right') => () => {
    if (!syncScroll || scrollingRef.current) return;
    scrollingRef.current = true;
    const from = source === 'left' ? leftRef.current : rightRef.current;
    const to = source === 'left' ? rightRef.current : leftRef.current;
    if (from && to) {
      to.scrollTop = from.scrollTop;
    }
    requestAnimationFrame(() => { scrollingRef.current = false; });
  }, [syncScroll]);

  // Esc closes the modal — but not while inference is still streaming
  // (otherwise the user loses in-flight output without an explicit Stop).
  useEscapeKey(onClose, open && !isActive);

  if (!open) return null;

  return (
    <Overlay>
      <Header>
        <HeaderLeft>
          <Title>Model Comparison</Title>
          {isActive && <Badge color="primary">Running</Badge>}
        </HeaderLeft>
        <HeaderRight>
          <SyncToggle $active={syncScroll} onClick={() => setSyncScroll((s) => !s)}>
            {syncScroll ? '↕ Sync Scroll On' : '↕ Sync Scroll Off'}
          </SyncToggle>
          {isActive && (
            <Button size="sm" variant="danger" onClick={onStop}>Stop Both</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </HeaderRight>
      </Header>

      <PanelGrid>
        {([0, 1] as const).map((i) => {
          const slot = slots[i];
          const model = models[i];
          const ref = i === 0 ? leftRef : rightRef;
          const onScrollHandler = handleScroll(i === 0 ? 'left' : 'right');

          let content: React.ReactNode;
          if (slot.error) {
            content = <ErrorText>Error: {slot.error}</ErrorText>;
          }

          if (slot.output) {
            if (slot.isStreaming) {
              const { visible, isThinking } = stripThinkingFromStream(slot.output);
              content = (
                <>
                  {isThinking && (
                    <ThinkingIndicator>
                      <Cursor style={{ width: 6, height: 12 }} /> Thinking...
                    </ThinkingIndicator>
                  )}
                  {visible && <OutputText>{visible}<Cursor /></OutputText>}
                  {!visible && !isThinking && <OutputText><Cursor /></OutputText>}
                </>
              );
            } else {
              const { answer, thinkingBlocks } = parseThinking(slot.output);
              content = (
                <>
                  {thinkingBlocks.length > 0 && (
                    <ThinkingToggle>
                      <ThinkingSummary>
                        &#9654; Model reasoning ({thinkingBlocks.length} block{thinkingBlocks.length > 1 ? 's' : ''})
                      </ThinkingSummary>
                      <ThinkingBody>{thinkingBlocks.join('\n\n---\n\n')}</ThinkingBody>
                    </ThinkingToggle>
                  )}
                  <OutputText>{answer || slot.output}</OutputText>
                </>
              );
            }
          } else if (!slot.isStreaming && !slot.error) {
            content = <Placeholder>Waiting for response...</Placeholder>;
          } else if (slot.isStreaming) {
            content = <Placeholder>Connecting to model...</Placeholder>;
          }

          const elapsed = slot.startedAt && slot.completedAt
            ? ((slot.completedAt - slot.startedAt) / 1000).toFixed(1)
            : slot.startedAt
              ? ((Date.now() - slot.startedAt) / 1000).toFixed(0)
              : null;

          return (
            <Panel key={i}>
              <PanelHeader>
                <div>
                  <ModelName>
                    {model?.name || `Model ${i + 1}`}
                    <ModelProvider>{model?.provider || ''}</ModelProvider>
                  </ModelName>
                </div>
                <Badge
                  color={
                    slot.error ? 'error'
                    : slot.isStreaming ? 'primary'
                    : slot.output ? 'success'
                    : 'secondary'
                  }
                >
                  {slot.error ? 'Error' : slot.isStreaming ? 'Streaming' : slot.output ? 'Done' : 'Idle'}
                </Badge>
              </PanelHeader>
              <PanelBody ref={ref} onScroll={onScrollHandler}>
                {content}
              </PanelBody>
              <FooterPanel>
                {elapsed && <MetaStat>Elapsed: <strong>{elapsed}s</strong></MetaStat>}
                <MetaStat>Output: <strong>{slot.output.length.toLocaleString()} chars</strong></MetaStat>
              </FooterPanel>
            </Panel>
          );
        })}
      </PanelGrid>

      {footer}
    </Overlay>
  );
}
