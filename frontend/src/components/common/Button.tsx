import styled, { css } from 'styled-components';
import { tokens } from '../../theme/tokens';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const variants = {
  primary: css`
    background: ${tokens.colors.accent.primary};
    color: white;
    &:hover:not(:disabled) { background: ${tokens.colors.accent.primaryHover}; }
  `,
  secondary: css`
    background: ${tokens.colors.bg.tertiary};
    color: ${tokens.colors.text.primary};
    border: 1px solid ${tokens.colors.border.subtle};
    &:hover:not(:disabled) { background: ${tokens.colors.bg.hover}; }
  `,
  danger: css`
    background: ${tokens.colors.accent.error};
    color: white;
    &:hover:not(:disabled) { opacity: 0.9; }
  `,
  ghost: css`
    background: transparent;
    color: ${tokens.colors.text.secondary};
    &:hover:not(:disabled) { background: ${tokens.colors.bg.tertiary}; color: ${tokens.colors.text.primary}; }
  `,
};

const sizes = {
  sm: css`font-size: 0.8rem; padding: 6px 12px;`,
  md: css`font-size: 0.875rem; padding: 8px 16px;`,
  lg: css`font-size: 1rem; padding: 12px 24px;`,
};

export const Button = styled.button<ButtonProps>`
  font-family: ${tokens.fonts.accent};
  font-weight: 500;
  border: none;
  border-radius: ${tokens.radii.md};
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;

  ${({ variant = 'primary' }) => variants[variant]}
  ${({ size = 'md' }) => sizes[size]}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
