import styled from 'styled-components';
import { tokens } from '../../theme/tokens';

export const Select = styled.select`
  width: 100%;
  padding: 10px 14px;
  font-family: ${tokens.fonts.body};
  font-size: 0.875rem;
  color: ${tokens.colors.text.primary};
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  outline: none;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239999AA' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 36px;

  &:focus {
    border-color: ${tokens.colors.accent.primary};
  }

  option {
    background: ${tokens.colors.bg.secondary};
    color: ${tokens.colors.text.primary};
  }
`;
