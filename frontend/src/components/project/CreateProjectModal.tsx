import { useState } from 'react';
import { Button } from '../common/Button';
import { Input, TextArea, Label, FormGroup } from '../common/Input';
import { Modal } from '../common/Modal';
import { useProjectStore } from '../../stores/projectStore';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

export function CreateProjectModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const createProject = useProjectStore((s) => s.createProject);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const project = await createProject({ name: name.trim(), description: description.trim() || undefined });
      setName('');
      setDescription('');
      onClose();
      onCreated?.(project.id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="New Project" open={open} onClose={onClose}>
      <FormGroup>
        <Label>Project Name</Label>
        <Input
          placeholder="e.g. Case Classification Model Testing"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </FormGroup>
      <FormGroup>
        <Label>Description (optional)</Label>
        <TextArea
          placeholder="Describe the goal of this project..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </FormGroup>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={!name.trim() || loading}>
          {loading ? 'Creating...' : 'Create Project'}
        </Button>
      </div>
    </Modal>
  );
}
