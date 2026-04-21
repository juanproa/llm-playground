import styled from 'styled-components';
import { tokens } from '../../theme/tokens';

export const Input = styled.input`
  width: 100%;
  padding: 10px 14px;
  font-family: ${tokens.fonts.body};
  font-size: 0.875rem;
  color: ${tokens.colors.text.primary};
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  outline: none;
  transition: border-color 0.2s;

  &:focus {
    border-color: ${tokens.colors.accent.primary};
  }

  &::placeholder {
    color: ${tokens.colors.text.muted};
  }
`;

export const TextArea = styled.textarea`
  width: 100%;
  padding: 10px 14px;
  font-family: ${tokens.fonts.body};
  font-size: 0.875rem;
  color: ${tokens.colors.text.primary};
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  outline: none;
  resize: vertical;
  min-height: 80px;
  transition: border-color 0.2s;

  &:focus {
    border-color: ${tokens.colors.accent.primary};
  }

  &::placeholder {
    color: ${tokens.colors.text.muted};
  }
`;

export const Label = styled.label`
  display: block;
  font-family: ${tokens.fonts.accent};
  font-size: 0.8rem;
  font-weight: 500;
  color: ${tokens.colors.text.secondary};
  margin-bottom: 6px;
`;

export const FormGroup = styled.div`
  margin-bottom: ${tokens.spacing.md};
`;
