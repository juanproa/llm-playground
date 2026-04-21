import styled from 'styled-components';
import { tokens } from '../../theme/tokens';

interface BadgeProps {
  color?: 'primary' | 'success' | 'warning' | 'error' | 'secondary';
}

const colorMap = {
  primary: tokens.colors.accent.primary,
  success: tokens.colors.accent.success,
  warning: tokens.colors.accent.warning,
  error: tokens.colors.accent.error,
  secondary: tokens.colors.text.muted,
};

export const Badge = styled.span<BadgeProps>`
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  font-family: ${tokens.fonts.accent};
  font-size: 0.7rem;
  font-weight: 500;
  color: white;
  background: ${({ color = 'primary' }) => colorMap[color]};
  border-radius: 100px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;
