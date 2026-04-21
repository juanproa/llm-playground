import styled from 'styled-components';
import { Button } from '../common/Button';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { useInferenceStore } from '../../stores/inferenceStore';

const RunContainer = styled.div`
  display: flex;
  gap: 10px;
`;

const StopIcon = styled.div`
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: white;
  flex-shrink: 0;
`;

interface Props {
  disabled: boolean;
  onRun: () => void;
  onStop: () => void;
}

export function RunButton({ disabled, onRun, onStop }: Props) {
  const isStreaming = useInferenceStore((s) => s.isStreaming);

  return (
    <RunContainer>
      {isStreaming ? (
        <>
          <Button
            size="lg"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled
          >
            <LoadingSpinner style={{ width: 18, height: 18, borderWidth: 2 }} />
            Running...
          </Button>
          <Button
            size="lg"
            variant="danger"
            style={{ justifyContent: 'center', minWidth: 120 }}
            onClick={onStop}
          >
            <StopIcon />
            Stop
          </Button>
        </>
      ) : (
        <Button
          size="lg"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={disabled}
          onClick={onRun}
        >
          Run Inference
        </Button>
      )}
    </RunContainer>
  );
}
