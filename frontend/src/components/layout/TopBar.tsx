import styled from 'styled-components';
import { tokens } from '../../theme/tokens';

const TopBarContainer = styled.header`
  height: 56px;
  background: ${tokens.colors.bg.secondary};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 ${tokens.spacing.lg};
`;

const Breadcrumb = styled.div`
  font-family: ${tokens.fonts.body};
  font-size: 0.875rem;
  color: ${tokens.colors.text.secondary};

  span {
    color: ${tokens.colors.text.primary};
    font-weight: 500;
  }
`;

interface TopBarProps {
  title?: string;
  breadcrumb?: string;
}

export function TopBar({ title, breadcrumb }: TopBarProps) {
  return (
    <TopBarContainer>
      <Breadcrumb>
        {breadcrumb && <>{breadcrumb} / </>}
        <span>{title || 'LLM Playground'}</span>
      </Breadcrumb>
    </TopBarContainer>
  );
}
