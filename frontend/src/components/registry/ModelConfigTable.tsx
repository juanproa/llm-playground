import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import type { ModelConfig } from '../../types';
import { useModelStore } from '../../stores/modelStore';
import { modelsApi, type MlxStatus } from '../../api/models';
import { useEffect, useRef, useState } from 'react';

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const Th = styled.th`
  text-align: left;
  padding: 12px 16px;
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${tokens.colors.text.muted};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
`;

const Td = styled.td`
  padding: 12px 16px;
  font-size: 0.875rem;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  color: ${tokens.colors.text.primary};
`;

const Row = styled.tr`
  &:hover {
    background: ${tokens.colors.bg.tertiary};
  }
`;

const ProviderLabel = styled.span`
  font-family: ${tokens.fonts.mono};
  font-size: 0.8rem;
  color: ${tokens.colors.accent.secondary};
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

const MlxStatusChip = styled.span<{ $state: 'loaded' | 'downloaded' | 'missing' | 'running' | 'error' }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 100px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.7rem;
  font-weight: 500;
  color: ${({ $state }) => {
    switch ($state) {
      case 'loaded': return tokens.colors.accent.success;
      case 'downloaded': return tokens.colors.accent.warning;
      case 'missing': return tokens.colors.accent.error;
      case 'running': return tokens.colors.accent.primary;
      case 'error': return tokens.colors.accent.error;
    }
  }};
  background: ${({ $state }) => {
    switch ($state) {
      case 'loaded': return 'rgba(0, 230, 118, 0.12)';
      case 'downloaded': return 'rgba(255, 171, 0, 0.12)';
      case 'missing': return 'rgba(255, 82, 82, 0.12)';
      case 'running': return 'rgba(108, 92, 231, 0.12)';
      case 'error': return 'rgba(255, 82, 82, 0.12)';
    }
  }};
  border: 1px solid ${({ $state }) => {
    switch ($state) {
      case 'loaded': return 'rgba(0, 230, 118, 0.3)';
      case 'downloaded': return 'rgba(255, 171, 0, 0.3)';
      case 'missing': return 'rgba(255, 82, 82, 0.3)';
      case 'running': return 'rgba(108, 92, 231, 0.3)';
      case 'error': return 'rgba(255, 82, 82, 0.3)';
    }
  }};
`;

interface Props {
  models: ModelConfig[];
  onEdit: (model: ModelConfig) => void;
}

function deriveMlxState(s: MlxStatus | undefined): 'loaded' | 'downloaded' | 'missing' | 'running' | 'error' | null {
  if (!s) return null;
  if (s.preload_state === 'running') return 'running';
  if (s.preload_state === 'error') return 'error';
  if (s.loaded) return 'loaded';
  if (s.downloaded) return 'downloaded';
  return 'missing';
}

function mlxStateLabel(state: 'loaded' | 'downloaded' | 'missing' | 'running' | 'error', status?: MlxStatus): string {
  switch (state) {
    case 'loaded': return '✓ Loaded in memory';
    case 'downloaded': return '⚠ Downloaded, not loaded';
    case 'missing': return '⚠ Not downloaded';
    case 'running': {
      if (status?.download_state === 'downloading' && status.download_total_bytes > 0) {
        const mbDone = (status.download_done_bytes / 1024 / 1024).toFixed(0);
        const mbTotal = (status.download_total_bytes / 1024 / 1024).toFixed(0);
        return `⏳ Downloading ${status.download_pct}% (${mbDone}/${mbTotal} MB)`;
      }
      if (status?.download_state === 'done') return '⏳ Loading into memory...';
      if (status?.download_state === 'listing') return '⏳ Listing files...';
      return '⏳ Preloading...';
    }
    case 'error': return '⚠ Preload failed';
  }
}

function mlxStateTooltip(state: 'loaded' | 'downloaded' | 'missing' | 'running' | 'error'): string {
  switch (state) {
    case 'loaded': return 'Model is loaded and ready for instant inference.';
    case 'downloaded': return 'Weights are on disk but not yet in memory. First inference will take ~10s to load.';
    case 'missing': return 'Model weights not downloaded. First inference will trigger a multi-GB download that may take minutes.';
    case 'running': return 'Downloading and loading the model in the background...';
    case 'error': return 'Preload failed. Click Preload to retry.';
  }
}

export function ModelConfigTable({ models, onEdit }: Props) {
  const { deleteModel, testModel } = useModelStore();
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [mlxStatuses, setMlxStatuses] = useState<Record<string, MlxStatus>>({});
  const pollingRef = useRef<Set<string>>(new Set());

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const result = await testModel(id);
      setTestResult((prev) => ({ ...prev, [id]: result }));
    } catch (e) {
      setTestResult((prev) => ({ ...prev, [id]: `Error: ${(e as Error).message}` }));
    } finally {
      setTesting(null);
    }
  };

  const handleDelete = async (model: ModelConfig) => {
    if (!confirm(`Delete model "${model.name}"?`)) return;
    try {
      await deleteModel(model.id);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // Fetch MLX status once on mount for any mlx_local rows
  useEffect(() => {
    const mlxModels = models.filter((m) => m.provider === 'mlx_local');
    mlxModels.forEach((m) => {
      modelsApi.mlxStatus(m.id)
        .then((s) => setMlxStatuses((prev) => ({ ...prev, [m.id]: s })))
        .catch(() => {});
    });
  }, [models]);

  // Poll while a preload is running
  useEffect(() => {
    const runningIds = Object.entries(mlxStatuses)
      .filter(([, s]) => s.preload_state === 'running')
      .map(([id]) => id);

    runningIds.forEach((id) => {
      if (pollingRef.current.has(id)) return;
      pollingRef.current.add(id);

      const tick = () => {
        modelsApi.mlxStatus(id)
          .then((s) => {
            setMlxStatuses((prev) => ({ ...prev, [id]: s }));
            if (s.preload_state === 'running') {
              setTimeout(tick, 2000);
            } else {
              pollingRef.current.delete(id);
            }
          })
          .catch(() => {
            pollingRef.current.delete(id);
          });
      };
      setTimeout(tick, 2000);
    });
  }, [mlxStatuses]);

  const handlePreload = async (id: string) => {
    try {
      const s = await modelsApi.mlxPreload(id);
      setMlxStatuses((prev) => ({ ...prev, [id]: s }));
    } catch (e) {
      alert(`Preload failed: ${(e as Error).message}`);
    }
  };

  const handleUnload = async (id: string) => {
    try {
      const s = await modelsApi.mlxUnload(id);
      setMlxStatuses((prev) => ({ ...prev, [id]: s }));
    } catch (e) {
      alert(`Unload failed: ${(e as Error).message}`);
    }
  };

  if (models.length === 0) {
    return <p style={{ color: tokens.colors.text.muted, textAlign: 'center', padding: 40 }}>No models configured yet. Add one to get started.</p>;
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th>Name</Th>
          <Th>Provider</Th>
          <Th>Model ID</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </tr>
      </thead>
      <tbody>
        {models.map((model) => {
          const isMlx = model.provider === 'mlx_local';
          const mlxStatus = mlxStatuses[model.id];
          const state = deriveMlxState(mlxStatus);
          return (
            <Row key={model.id}>
              <Td style={{ fontWeight: 500 }}>{model.name}</Td>
              <Td><ProviderLabel>{model.provider}</ProviderLabel></Td>
              <Td style={{ fontFamily: tokens.fonts.mono, fontSize: '0.8rem' }}>{model.model_id}</Td>
              <Td>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div>
                    <Badge color={model.is_enabled ? 'success' : 'secondary'}>
                      {model.is_enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  {isMlx && state && (
                    <MlxStatusChip $state={state} title={mlxStateTooltip(state)}>
                      {mlxStateLabel(state, mlxStatus)}
                    </MlxStatusChip>
                  )}
                  {mlxStatus?.preload_error && (
                    <div style={{ fontSize: '0.7rem', color: tokens.colors.accent.error, maxWidth: 240 }}>
                      {mlxStatus.preload_error.substring(0, 120)}
                    </div>
                  )}
                  {testResult[model.id] && (
                    <div style={{ fontSize: '0.75rem', color: tokens.colors.text.muted }}>
                      {testResult[model.id].substring(0, 60)}
                    </div>
                  )}
                </div>
              </Td>
              <Td>
                <Actions>
                  <Button size="sm" variant="secondary" onClick={() => onEdit(model)}>
                    Edit
                  </Button>
                  {isMlx && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={state === 'running' || state === 'loaded'}
                        onClick={() => handlePreload(model.id)}
                        title={
                          state === 'loaded'
                            ? 'Already in memory'
                            : state === 'running'
                              ? 'Download in progress'
                              : 'Download + load model in background'
                        }
                      >
                        {state === 'running' ? 'Preloading...' : 'Preload'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={state !== 'loaded'}
                        onClick={() => handleUnload(model.id)}
                        title={
                          state === 'loaded'
                            ? 'Free memory by dropping the model from RAM (weights stay on disk).'
                            : 'Model is not loaded.'
                        }
                      >
                        Unload
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => handleTest(model.id)} disabled={testing === model.id}>
                    {testing === model.id ? 'Testing...' : 'Test'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => handleDelete(model)}>
                    Delete
                  </Button>
                </Actions>
              </Td>
            </Row>
          );
        })}
      </tbody>
    </Table>
  );
}
