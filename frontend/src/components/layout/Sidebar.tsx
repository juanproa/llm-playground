import { NavLink } from 'react-router-dom';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';

const SidebarContainer = styled.nav`
  width: 260px;
  min-height: 100%;
  background: ${tokens.colors.bg.secondary};
  border-right: 1px solid ${tokens.colors.border.subtle};
  display: flex;
  flex-direction: column;
`;

const BrandArea = styled.div`
  padding: 20px ${tokens.spacing.lg} 16px;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  margin-bottom: ${tokens.spacing.md};
`;

const AppName = styled.div`
  font-family: ${tokens.fonts.display};
  font-size: 1.15rem;
  font-weight: 700;
  color: ${tokens.colors.text.primary};
  letter-spacing: -0.2px;
`;

const AppNameAccent = styled.span`
  color: ${tokens.colors.accent.primary};
`;

const NavSection = styled.div`
  margin-bottom: ${tokens.spacing.md};
  padding: 0 12px;
`;

const NavLabel = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: ${tokens.colors.text.muted};
  padding: 0 12px;
  margin-bottom: 6px;
`;

const StyledNavLink = styled(NavLink)`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  font-family: ${tokens.fonts.body};
  font-size: 0.85rem;
  color: ${tokens.colors.text.secondary};
  text-decoration: none;
  border-radius: ${tokens.radii.md};
  transition: all 0.15s;

  &:hover {
    background: ${tokens.colors.bg.tertiary};
    color: ${tokens.colors.text.primary};
    text-decoration: none;
  }

  &.active {
    color: ${tokens.colors.accent.primary};
    background: rgba(108, 92, 231, 0.12);
    font-weight: 500;
  }
`;

const Spacer = styled.div`
  flex: 1;
`;

const VersionTag = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 0.7rem;
  color: ${tokens.colors.text.muted};
  padding: ${tokens.spacing.md} ${tokens.spacing.lg};
`;

export function Sidebar() {
  return (
    <SidebarContainer>
      <BrandArea>
        <AppName><AppNameAccent>LLM</AppNameAccent> Playground</AppName>
      </BrandArea>

      <NavSection>
        <NavLabel>Workspace</NavLabel>
        <StyledNavLink to="/projects" end>Projects</StyledNavLink>
        <StyledNavLink to="/chat">Chat</StyledNavLink>
        <StyledNavLink to="/datasets">Datasets</StyledNavLink>
        <StyledNavLink to="/knowledge-base">Knowledge Base &amp; RAG</StyledNavLink>
      </NavSection>

      <NavSection>
        <NavLabel>Post-Training</NavLabel>
        <StyledNavLink to="/post-training" end>Post-Training Hub</StyledNavLink>
        <StyledNavLink to="/model-fusion">Model Fusion</StyledNavLink>
      </NavSection>

      <NavSection>
        <NavLabel>Configuration</NavLabel>
        <StyledNavLink to="/models">Model Registry</StyledNavLink>
        <StyledNavLink to="/settings">Settings</StyledNavLink>
      </NavSection>

      <Spacer />
      <VersionTag>v0.1.0</VersionTag>
    </SidebarContainer>
  );
}
