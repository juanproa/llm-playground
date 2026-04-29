import React from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const ModalBox = styled.div<{ $size?: 'md' | 'lg' }>`
  background: ${tokens.colors.bg.secondary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.xl};
  padding: ${tokens.spacing.xl};
  min-width: 400px;
  max-width: ${({ $size }) => ($size === 'lg' ? '900px' : '600px')};
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: ${tokens.shadows.elevated};
`;

const ModalTitle = styled.h2`
  font-family: ${tokens.fonts.display};
  font-size: 1.25rem;
  margin-bottom: ${tokens.spacing.lg};
`;

interface ModalProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'md' | 'lg';
}

export function Modal({ title, open, onClose, children, size = 'md' }: ModalProps) {
  if (!open) return null;
  return (
    <Overlay onClick={onClose}>
      <ModalBox $size={size} onClick={(e) => e.stopPropagation()}>
        <ModalTitle>{title}</ModalTitle>
        {children}
      </ModalBox>
    </Overlay>
  );
}
