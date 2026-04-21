import { Outlet } from 'react-router-dom';
import styled from 'styled-components';
import { Sidebar } from './Sidebar';

const ShellContainer = styled.div`
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
`;

const MainContent = styled.main`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

export function AppShell() {
  return (
    <ShellContainer>
      <Sidebar />
      <MainContent>
        <Outlet />
      </MainContent>
    </ShellContainer>
  );
}
