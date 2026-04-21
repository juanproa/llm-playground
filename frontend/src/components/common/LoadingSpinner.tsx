import styled, { keyframes } from 'styled-components';
import { tokens } from '../../theme/tokens';

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

export const LoadingSpinner = styled.div`
  width: 24px;
  height: 24px;
  border: 3px solid ${tokens.colors.border.subtle};
  border-top-color: ${tokens.colors.accent.primary};
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
`;
