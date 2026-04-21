import styled from 'styled-components';
import { tokens } from '../theme/tokens';
import { TopBar } from '../components/layout/TopBar';
import { Card, CardTitle } from '../components/common/Card';

const Container = styled.div`
  padding: ${tokens.spacing.xl};
  max-width: 800px;
`;

const Description = styled.p`
  color: ${tokens.colors.text.secondary};
  font-size: 0.9rem;
  line-height: 1.6;
`;

export function SettingsPage() {
  return (
    <>
      <TopBar title="Settings" />
      <Container>
        <h1 style={{ fontSize: '1.5rem', marginBottom: tokens.spacing.xl }}>Settings</h1>
        <Card>
          <CardTitle>Platform Configuration</CardTitle>
          <Description>
            Platform settings and configuration options will be available here.
            Future features include theme customization, default model preferences,
            and advanced pipeline configuration for post-training workflows.
          </Description>
        </Card>
      </Container>
    </>
  );
}
