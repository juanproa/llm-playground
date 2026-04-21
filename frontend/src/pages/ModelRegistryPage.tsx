import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../theme/tokens';
import { TopBar } from '../components/layout/TopBar';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ModelConfigForm } from '../components/registry/ModelConfigForm';
import { ModelConfigTable } from '../components/registry/ModelConfigTable';
import { useModelStore } from '../stores/modelStore';
import type { ModelConfig } from '../types';

const Container = styled.div`
  padding: ${tokens.spacing.xl};
  max-width: 1200px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${tokens.spacing.xl};
`;

const Title = styled.h1`
  font-size: 1.5rem;
`;

export function ModelRegistryPage() {
  const { models, loading, fetchModels } = useModelStore();
  const [showForm, setShowForm] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const handleAdd = () => {
    setEditingModel(null);
    setShowForm(true);
  };

  const handleEdit = (model: ModelConfig) => {
    setEditingModel(model);
    setShowForm(true);
  };

  const handleClose = () => {
    setShowForm(false);
    setEditingModel(null);
  };

  return (
    <>
      <TopBar title="Model Registry" />
      <Container>
        <Header>
          <Title>Model Registry</Title>
          <Button onClick={handleAdd}>Add Model</Button>
        </Header>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <LoadingSpinner />
            </div>
          ) : (
            <ModelConfigTable models={models} onEdit={handleEdit} />
          )}
        </Card>

        <ModelConfigForm open={showForm} onClose={handleClose} editModel={editingModel} />
      </Container>
    </>
  );
}
