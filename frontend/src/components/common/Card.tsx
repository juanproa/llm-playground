import styled from 'styled-components';
import { tokens } from '../../theme/tokens';

export const Card = styled.div`
  background: ${tokens.colors.bg.secondary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.lg};
  padding: ${tokens.spacing.lg};
  box-shadow: ${tokens.shadows.card};
  transition: border-color 0.2s;

  &:hover {
    border-color: ${tokens.colors.border.strong};
  }
`;

export const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${tokens.spacing.md};
`;

export const CardTitle = styled.h3`
  font-family: ${tokens.fonts.display};
  font-size: 1.1rem;
  font-weight: 600;
  color: ${tokens.colors.text.primary};
`;
