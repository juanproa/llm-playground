import { useEffect } from 'react';
import { Card, CardTitle } from '../common/Card';
import { Select } from '../common/Select';
import { Label, FormGroup } from '../common/Input';
import { useModelStore } from '../../stores/modelStore';
import type { ModelConfig } from '../../types';

interface Props {
  selectedModel: ModelConfig | null;
  onSelectModel: (model: ModelConfig | null) => void;
}

export function ModelSelector({ selectedModel, onSelectModel }: Props) {
  const { models, fetchModels } = useModelStore();

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const enabledModels = models.filter((m) => m.is_enabled);

  return (
    <Card>
      <CardTitle>Model</CardTitle>
      <FormGroup>
        <Label>Select Model</Label>
        <Select
          value={selectedModel?.id || ''}
          onChange={(e) => {
            const m = models.find((m) => m.id === e.target.value);
            onSelectModel(m || null);
          }}
        >
          <option value="">Choose a model...</option>
          {enabledModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.provider})
            </option>
          ))}
        </Select>
      </FormGroup>
    </Card>
  );
}
