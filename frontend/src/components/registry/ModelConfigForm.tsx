import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Button } from '../common/Button';
import { Input, Label, FormGroup } from '../common/Input';
import { Select } from '../common/Select';
import { Modal } from '../common/Modal';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { useModelStore } from '../../stores/modelStore';
import { apiFetch } from '../../api/client';
import { postTrainingApi } from '../../api/postTraining';
import type { ArtifactInfo, MlxModelInfo, ModelConfig } from '../../types';

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic Claude' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'nvidia', label: 'NVIDIA' },
  { value: 'ollama', label: 'Ollama (Local)' },
  { value: 'mlx_local', label: 'MLX Local (Apple Silicon) — supports LoRA adapter' },
];

interface OllamaModel {
  name: string;
  size: number;
}

const OllamaHint = styled.div`
  font-size: 0.75rem;
  color: ${tokens.colors.text.muted};
  margin-top: 4px;
`;

const OllamaList = styled.div`
  margin-top: 8px;
  background: ${tokens.colors.bg.primary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  max-height: 160px;
  overflow-y: auto;
`;

const OllamaItem = styled.div<{ $selected?: boolean }>`
  padding: 8px 12px;
  font-size: 0.8rem;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  background: ${({ $selected }) => $selected ? 'rgba(108, 92, 231, 0.12)' : 'transparent'};
  color: ${({ $selected }) => $selected ? tokens.colors.accent.primary : tokens.colors.text.primary};
  font-family: ${tokens.fonts.mono};

  &:hover {
    background: ${tokens.colors.bg.tertiary};
  }

  &:last-child {
    border-bottom: none;
  }
`;

const SizeLabel = styled.span`
  font-size: 0.7rem;
  color: ${tokens.colors.text.muted};
  font-family: ${tokens.fonts.accent};
`;

const ApiKeyHint = styled.div`
  font-size: 0.7rem;
  color: ${tokens.colors.text.muted};
  margin-top: 4px;
  font-style: italic;
`;

const SliderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
`;

const Slider = styled.input`
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: ${tokens.colors.border.strong};
  outline: none;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${tokens.colors.accent.primary};
    cursor: pointer;
    transition: transform 0.15s;
  }
  &::-webkit-slider-thumb:hover {
    transform: scale(1.2);
  }
  &::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${tokens.colors.accent.primary};
    border: none;
    cursor: pointer;
  }
`;

const SliderValue = styled.div`
  min-width: 52px;
  text-align: right;
  font-family: ${tokens.fonts.mono};
  font-size: 0.8rem;
  font-weight: 600;
  color: ${tokens.colors.text.primary};
`;

const Presets = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
`;

const PresetChip = styled.button<{ $active?: boolean }>`
  padding: 3px 10px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.7rem;
  border-radius: 100px;
  border: 1px solid ${({ $active }) => $active ? tokens.colors.accent.primary : tokens.colors.border.subtle};
  background: ${({ $active }) => $active ? 'rgba(108, 92, 231, 0.15)' : 'transparent'};
  color: ${({ $active }) => $active ? tokens.colors.accent.primary : tokens.colors.text.muted};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: ${tokens.colors.accent.primary};
    color: ${tokens.colors.accent.primary};
  }
`;

const ToggleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ToggleLabel = styled.span`
  font-size: 0.75rem;
  color: ${tokens.colors.text.muted};
`;

const Toggle = styled.div<{ $active?: boolean }>`
  width: 34px;
  height: 18px;
  border-radius: 9px;
  background: ${({ $active }) => $active ? tokens.colors.accent.primary : tokens.colors.border.strong};
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
`;

const ToggleKnob = styled.div<{ $active?: boolean }>`
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: white;
  position: absolute;
  top: 2px;
  left: ${({ $active }) => $active ? '18px' : '2px'};
  transition: left 0.2s;
`;

const ParamHint = styled.div`
  font-size: 0.7rem;
  color: ${tokens.colors.text.muted};
  margin-top: 6px;
  font-style: italic;
`;

function formatSize(bytes: number): string {
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

const EMPTY_FORM = {
  name: '',
  provider: 'anthropic',
  model_id: '',
  api_key: '',
  base_url: '',
  namespace: '',
  max_tokens: 4096,
  temperature: 0.7,
  adapter_path: '',
  enable_thinking: true,
  is_enabled: true,
  // YaRN context extension
  yarn_enabled: false,
  yarn_factor: 4.0,
  yarn_original_max_position_embeddings: 32768,
  // Quantization / conversion metadata
  q_bits: null as number | null,
  q_group_size: null as number | null,
  // KV cache
  kv_bits: null as number | null,
  kv_group_size: 64,
  max_kv_size: null as number | null,
  // Sampling (all providers)
  top_p: null as number | null,
  top_k: null as number | null,
  min_p: null as number | null,
};

interface Props {
  open: boolean;
  onClose: () => void;
  editModel?: ModelConfig | null;
}

export function ModelConfigForm({ open, onClose, editModel }: Props) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [mlxModels, setMlxModels] = useState<MlxModelInfo[]>([]);
  const [sftArtifacts, setSftArtifacts] = useState<ArtifactInfo[]>([]);
  const { createModel, updateModel } = useModelStore();

  const isEdit = !!editModel;

  // Populate form when editing
  useEffect(() => {
    if (editModel && open) {
      setForm({
        name: editModel.name,
        provider: editModel.provider,
        model_id: editModel.model_id,
        api_key: '',
        base_url: editModel.base_url || '',
        namespace: editModel.namespace || '',
        max_tokens: editModel.max_tokens,
        temperature: editModel.temperature,
        adapter_path: editModel.adapter_path || '',
        enable_thinking: editModel.enable_thinking ?? true,
        is_enabled: editModel.is_enabled,
        yarn_enabled: editModel.yarn_factor != null,
        yarn_factor: editModel.yarn_factor ?? 4.0,
        yarn_original_max_position_embeddings: editModel.yarn_original_max_position_embeddings ?? 32768,
        q_bits: editModel.q_bits ?? null,
        q_group_size: editModel.q_group_size ?? null,
        kv_bits: editModel.kv_bits ?? null,
        kv_group_size: editModel.kv_group_size ?? 64,
        max_kv_size: editModel.max_kv_size ?? null,
        top_p: editModel.top_p ?? null,
        top_k: editModel.top_k ?? null,
        min_p: editModel.min_p ?? null,
      });
    } else if (!editModel && open) {
      setForm(EMPTY_FORM);
    }
  }, [editModel, open]);

  // Load curated catalogs + SFT artifacts when the form opens
  useEffect(() => {
    if (!open) return;
    Promise.all([
      postTrainingApi.listMlxModels().catch(() => []),
      postTrainingApi.listSftArtifacts().catch(() => []),
    ]).then(([mlx, arts]) => {
      setMlxModels(mlx);
      setSftArtifacts(arts);
    });
  }, [open]);

  const update = (field: string, value: string | number | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // Fetch Ollama models when provider is ollama
  useEffect(() => {
    if (form.provider === 'ollama' && open) {
      setOllamaLoading(true);
      apiFetch<OllamaModel[]>(`/models/ollama/available${form.base_url ? `?base_url=${encodeURIComponent(form.base_url)}` : ''}`)
        .then(setOllamaModels)
        .catch(() => setOllamaModels([]))
        .finally(() => setOllamaLoading(false));
    }
  }, [form.provider, form.base_url, open]);

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.model_id.trim()) return;
    setLoading(true);
    try {
      const mlxFields = form.provider === 'mlx_local' ? {
        yarn_factor: form.yarn_enabled ? form.yarn_factor : null,
        yarn_original_max_position_embeddings: form.yarn_enabled ? form.yarn_original_max_position_embeddings : null,
        q_bits: form.q_bits,
        q_group_size: form.q_group_size,
        kv_bits: form.kv_bits,
        kv_group_size: form.kv_bits != null ? form.kv_group_size : null,
        max_kv_size: form.max_kv_size,
      } : {};

      const samplingFields = {
        top_p: form.top_p,
        top_k: form.top_k,
        min_p: form.min_p,
      };

      if (isEdit) {
        const data: Record<string, unknown> = {
          name: form.name.trim(),
          provider: form.provider,
          model_id: form.model_id.trim(),
          base_url: form.base_url || undefined,
          namespace: form.namespace || undefined,
          max_tokens: form.max_tokens,
          temperature: form.temperature,
          adapter_path: form.adapter_path || null,
          enable_thinking: form.enable_thinking,
          is_enabled: form.is_enabled,
          ...samplingFields,
          ...mlxFields,
        };
        if (form.api_key) data.api_key = form.api_key;
        await updateModel(editModel!.id, data);
      } else {
        await createModel({
          name: form.name.trim(),
          provider: form.provider,
          model_id: form.model_id.trim(),
          api_key: form.api_key || undefined,
          base_url: form.base_url || undefined,
          namespace: form.namespace || undefined,
          max_tokens: form.max_tokens,
          temperature: form.temperature,
          adapter_path: form.adapter_path || undefined,
          enable_thinking: form.enable_thinking,
          ...samplingFields,
          ...mlxFields,
        });
      }
      setForm(EMPTY_FORM);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit Model Configuration' : 'Add Model Configuration'} open={open} onClose={onClose}>
      <FormGroup>
        <Label>Display Name</Label>
        <Input placeholder="e.g. Claude Sonnet 4" value={form.name} onChange={(e) => update('name', e.target.value)} autoFocus />
      </FormGroup>
      <FormGroup>
        <Label>Provider</Label>
        <Select value={form.provider} onChange={(e) => update('provider', e.target.value)}>
          {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
      </FormGroup>

      {form.provider === 'ollama' && (
        <FormGroup>
          <Label>Base URL (optional)</Label>
          <Input
            placeholder="http://localhost:11434"
            value={form.base_url}
            onChange={(e) => update('base_url', e.target.value)}
          />
        </FormGroup>
      )}

      <FormGroup>
        <Label>Model ID</Label>
        <Input
          placeholder={
            form.provider === 'ollama'
              ? 'Select from list below or type exact name'
              : form.provider === 'mlx_local'
                ? 'Select from curated MLX list below or type HF repo id'
                : 'e.g. claude-sonnet-4-20250514'
          }
          value={form.model_id}
          onChange={(e) => update('model_id', e.target.value)}
        />

        {form.provider === 'mlx_local' && mlxModels.length > 0 && (
          <>
            <OllamaHint>Curated MLX-community models — click to select:</OllamaHint>
            <OllamaList>
              {mlxModels.map((m) => (
                <OllamaItem
                  key={m.id}
                  $selected={form.model_id === m.id}
                  onClick={() => {
                    update('model_id', m.id);
                    if (!form.name) update('name', m.name);
                  }}
                >
                  <span>{m.name}</span>
                  <SizeLabel>{m.size} · {m.quantization}</SizeLabel>
                </OllamaItem>
              ))}
            </OllamaList>
          </>
        )}

        {form.provider === 'ollama' && (
          <>
            {ollamaLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <LoadingSpinner style={{ width: 16, height: 16, borderWidth: 2 }} />
                <OllamaHint>Fetching models from Ollama...</OllamaHint>
              </div>
            ) : ollamaModels.length > 0 ? (
              <>
                <OllamaHint>Available on your Ollama instance — click to select:</OllamaHint>
                <OllamaList>
                  {ollamaModels.map((m) => (
                    <OllamaItem
                      key={m.name}
                      $selected={form.model_id === m.name}
                      onClick={() => {
                        update('model_id', m.name);
                        if (!form.name) update('name', m.name.split(':')[0].split('/').pop() || m.name);
                      }}
                    >
                      <span>{m.name}</span>
                      <SizeLabel>{formatSize(m.size)}</SizeLabel>
                    </OllamaItem>
                  ))}
                </OllamaList>
              </>
            ) : (
              <OllamaHint>No models found. Make sure Ollama is running and has models pulled.</OllamaHint>
            )}
          </>
        )}
      </FormGroup>

      {form.provider !== 'ollama' && (
        <FormGroup>
          <Label>API Key</Label>
          <Input
            type="password"
            placeholder={isEdit ? 'Leave blank to keep current key' : 'sk-...'}
            value={form.api_key}
            onChange={(e) => update('api_key', e.target.value)}
          />
          {isEdit && editModel?.has_api_key && !form.api_key && (
            <ApiKeyHint>Current API key is set. Enter a new value to replace it.</ApiKeyHint>
          )}
        </FormGroup>
      )}
      {form.provider !== 'ollama' && (
        <FormGroup>
          <Label>Base URL (optional)</Label>
          <Input placeholder="Leave blank for default" value={form.base_url} onChange={(e) => update('base_url', e.target.value)} />
        </FormGroup>
      )}
      <FormGroup>
        <Label>Namespace (optional)</Label>
        <Input placeholder="Organization or workspace" value={form.namespace} onChange={(e) => update('namespace', e.target.value)} />
      </FormGroup>

      {/* LoRA adapter — only shown for providers that can use it */}
      {(form.provider === 'mlx_local' || form.provider === 'ollama') && (
        <FormGroup>
          <Label>
            LoRA Adapter Path (optional)
            {form.provider === 'mlx_local'
              ? ' — loaded on top of base model at inference'
              : ' — metadata only; for Ollama you must fuse & ollama create first'}
          </Label>
          <Input
            placeholder="Select below or paste a path"
            value={form.adapter_path}
            onChange={(e) => update('adapter_path', e.target.value)}
          />
          <OllamaHint>
            {sftArtifacts.filter(a => a.adapter_path).length > 0
              ? 'Completed SFT adapters — click to attach:'
              : 'No SFT adapters on disk yet.'}
          </OllamaHint>
          <OllamaList>
            {sftArtifacts.filter(a => a.adapter_path).length === 0 ? (
              <OllamaItem style={{ cursor: 'default', color: tokens.colors.text.muted }}>
                <span>Train an adapter in Post-Training → Fine Tuning</span>
              </OllamaItem>
            ) : (
              sftArtifacts.filter(a => a.adapter_path).map((a) => (
                <OllamaItem
                  key={a.job_id}
                  $selected={form.adapter_path === a.adapter_path}
                  onClick={() => update('adapter_path', a.adapter_path || '')}
                >
                  <span>{a.job_id}</span>
                  <SizeLabel>{(a.size_bytes / 1024 / 1024).toFixed(1)} MB</SizeLabel>
                </OllamaItem>
              ))
            )}
            {form.adapter_path && !sftArtifacts.some(a => a.adapter_path === form.adapter_path) && (
              <OllamaItem
                $selected
                onClick={() => update('adapter_path', '')}
                title="Click to clear"
                style={{ borderTop: `1px solid ${tokens.colors.border.subtle}` }}
              >
                <span>Custom: {form.adapter_path}</span>
                <SizeLabel>✕ clear</SizeLabel>
              </OllamaItem>
            )}
          </OllamaList>
        </FormGroup>
      )}
      <FormGroup>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label style={{ marginBottom: 0 }}>Max Output Tokens</Label>
          <ToggleRow>
            <ToggleLabel>No limit</ToggleLabel>
            <Toggle
              $active={form.max_tokens === 0}
              onClick={() => update('max_tokens', form.max_tokens === 0 ? 4096 : 0)}
            >
              <ToggleKnob $active={form.max_tokens === 0} />
            </Toggle>
          </ToggleRow>
        </div>
        {form.max_tokens > 0 && (
          <>
            <SliderRow>
              <Slider
                type="range"
                min={128}
                max={131072}
                step={128}
                value={form.max_tokens}
                onChange={(e) => update('max_tokens', parseInt(e.target.value))}
              />
              <SliderValue>{form.max_tokens.toLocaleString()}</SliderValue>
            </SliderRow>
            <Presets>
              {[1024, 4096, 8192, 16384, 32768, 65536, 131072].map((v) => (
                <PresetChip
                  key={v}
                  $active={form.max_tokens === v}
                  onClick={() => update('max_tokens', v)}
                >
                  {v >= 1024 ? `${v / 1024}k` : v}
                </PresetChip>
              ))}
            </Presets>
          </>
        )}
        {form.max_tokens === 0 && (
          <ParamHint>The model will decide when to stop generating.</ParamHint>
        )}
      </FormGroup>

      <FormGroup>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label style={{ marginBottom: 0 }}>Thinking / Reasoning</Label>
          <ToggleRow>
            <ToggleLabel>{form.enable_thinking ? 'On' : 'Off'}</ToggleLabel>
            <Toggle
              $active={form.enable_thinking}
              onClick={() => update('enable_thinking', !form.enable_thinking)}
            >
              <ToggleKnob $active={form.enable_thinking} />
            </Toggle>
          </ToggleRow>
        </div>
        <ParamHint>
          {form.enable_thinking
            ? 'Model uses its built-in reasoning/thinking mode (default).'
            : "Skips the <think>…</think> phase entirely on supported models (Qwen3 via MLX). Saves output tokens and prevents thinking text from leaking into JSON outputs."}
        </ParamHint>
      </FormGroup>

      <FormGroup>
        <Label>Temperature</Label>
        <SliderRow>
          <Slider
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={form.temperature}
            onChange={(e) => update('temperature', parseFloat(e.target.value))}
          />
          <SliderValue>{form.temperature.toFixed(2)}</SliderValue>
        </SliderRow>
        <Presets>
          {[0, 0.3, 0.5, 0.7, 1.0, 1.5].map((v) => (
            <PresetChip
              key={v}
              $active={form.temperature === v}
              onClick={() => update('temperature', v)}
            >
              {v}
            </PresetChip>
          ))}
        </Presets>
      </FormGroup>

      {/* ── Advanced Sampling (all providers) ────────────────────────── */}
      <FormGroup>
        <Label>Advanced Sampling (optional)</Label>
        <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <Label style={{ fontSize: '0.72rem' }}>
              top_p{form.top_p != null ? ` — ${form.top_p.toFixed(2)}` : ' — off'}
            </Label>
            <SliderRow>
              <Slider
                type="range" min={0} max={1} step={0.01}
                value={form.top_p ?? 1}
                onChange={(e) => update('top_p', parseFloat(e.target.value))}
                disabled={form.top_p == null}
                style={{ opacity: form.top_p == null ? 0.4 : 1 }}
              />
              <Toggle $active={form.top_p != null}
                onClick={() => update('top_p', form.top_p != null ? null : 0.9)}>
                <ToggleKnob $active={form.top_p != null} />
              </Toggle>
            </SliderRow>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <Label style={{ fontSize: '0.72rem' }}>
              min_p{form.min_p != null ? ` — ${form.min_p.toFixed(2)}` : ' — off'}
            </Label>
            <SliderRow>
              <Slider
                type="range" min={0} max={0.5} step={0.01}
                value={form.min_p ?? 0}
                onChange={(e) => update('min_p', parseFloat(e.target.value))}
                disabled={form.min_p == null}
                style={{ opacity: form.min_p == null ? 0.4 : 1 }}
              />
              <Toggle $active={form.min_p != null}
                onClick={() => update('min_p', form.min_p != null ? null : 0.05)}>
                <ToggleKnob $active={form.min_p != null} />
              </Toggle>
            </SliderRow>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <Label style={{ fontSize: '0.72rem' }}>
              top_k{form.top_k != null ? ` — ${form.top_k}` : ' — off'}
            </Label>
            <SliderRow>
              <Input
                type="number"
                placeholder="e.g. 50"
                value={form.top_k ?? ''}
                onChange={(e) => update('top_k', e.target.value ? parseInt(e.target.value) : null)}
                style={{ flex: 1 }}
              />
            </SliderRow>
          </div>
        </div>
        <ParamHint>
          Leave off to use the model default. top_p and min_p filter low-probability tokens; top_k limits the candidate pool.
          top_k and min_p work with vLLM-compatible endpoints; top_p is valid for all providers.
        </ParamHint>
      </FormGroup>

      {/* ── MLX-only advanced sections ─────────────────────────────────── */}
      {form.provider === 'mlx_local' && (
        <>
          {/* ── YaRN Context Expansion ── */}
          <FormGroup>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Label style={{ marginBottom: 0 }}>YaRN Context Expansion</Label>
              <ToggleRow>
                <ToggleLabel>{form.yarn_enabled ? 'On' : 'Off'}</ToggleLabel>
                <Toggle $active={form.yarn_enabled} onClick={() => update('yarn_enabled', !form.yarn_enabled)}>
                  <ToggleKnob $active={form.yarn_enabled} />
                </Toggle>
              </ToggleRow>
            </div>
            {form.yarn_enabled ? (
              <>
                <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                  <div style={{ flex: 1 }}>
                    <Label style={{ fontSize: '0.72rem' }}>Factor</Label>
                    <SliderRow>
                      <Slider type="range" min={1} max={8} step={0.5}
                        value={form.yarn_factor}
                        onChange={(e) => update('yarn_factor', parseFloat(e.target.value))} />
                      <SliderValue>{form.yarn_factor}×</SliderValue>
                    </SliderRow>
                    <Presets>
                      {[2, 4, 8].map(v => (
                        <PresetChip key={v} $active={form.yarn_factor === v} onClick={() => update('yarn_factor', v)}>{v}×</PresetChip>
                      ))}
                    </Presets>
                  </div>
                  <div style={{ flex: 1 }}>
                    <Label style={{ fontSize: '0.72rem' }}>Native context (tokens)</Label>
                    <Presets style={{ marginTop: 8 }}>
                      {[32768, 65536, 131072].map(v => (
                        <PresetChip key={v} $active={form.yarn_original_max_position_embeddings === v}
                          onClick={() => update('yarn_original_max_position_embeddings', v)}>
                          {(v / 1024).toFixed(0)}k
                        </PresetChip>
                      ))}
                    </Presets>
                  </div>
                </div>
                <ParamHint>
                  Extended context: <strong>{((form.yarn_original_max_position_embeddings * form.yarn_factor) / 1024).toFixed(0)}k tokens</strong>.
                  Injects <code>rope_scaling</code> into the model config before loading — no file edits needed.
                </ParamHint>
              </>
            ) : (
              <ParamHint>Enable to extend context beyond the model's native limit via rotary embedding interpolation.</ParamHint>
            )}
          </FormGroup>

          {/* ── Quantization / Conversion ── */}
          <FormGroup>
            <Label>Quantization (conversion reference) — optional</Label>
            <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
              <div style={{ flex: 1 }}>
                <Label style={{ fontSize: '0.72rem' }}>q-bits {form.q_bits == null && <span style={{ color: tokens.colors.text.muted }}>(not set)</span>}</Label>
                <Presets>
                  {[4, 8].map(v => (
                    <PresetChip key={v} $active={form.q_bits === v} onClick={() => update('q_bits', form.q_bits === v ? null : v)}>{v}-bit</PresetChip>
                  ))}
                </Presets>
              </div>
              <div style={{ flex: 1 }}>
                <Label style={{ fontSize: '0.72rem' }}>Group size {form.q_group_size == null && <span style={{ color: tokens.colors.text.muted }}>(not set)</span>}</Label>
                <Presets>
                  {[32, 64, 128].map(v => (
                    <PresetChip key={v} $active={form.q_group_size === v} onClick={() => update('q_group_size', form.q_group_size === v ? null : v)}>{v}</PresetChip>
                  ))}
                </Presets>
              </div>
            </div>
            {form.model_id && form.q_bits != null && form.q_group_size != null && (
              <div style={{
                marginTop: 10, padding: '8px 10px',
                background: 'rgba(0,0,0,0.25)', borderRadius: 6,
                fontFamily: 'monospace', fontSize: '0.7rem', color: '#a8b2c1',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                {`python3 -m mlx_lm.convert \\\n  --hf-path ${form.model_id} \\\n  --mlx-path ./models/${form.model_id.split('/').pop()}-${form.q_bits}bit \\\n  --quantize \\\n  --q-bits ${form.q_bits} \\\n  --q-group-size ${form.q_group_size}`}
              </div>
            )}
            <ParamHint>Optional — stored for reference only, does not affect inference. Set both values to generate the mlx_lm.convert command.</ParamHint>
          </FormGroup>

          {/* ── KV Cache ── */}
          <FormGroup>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Label style={{ marginBottom: 0 }}>KV Cache Quantization</Label>
              <ToggleRow>
                <ToggleLabel>{form.kv_bits != null ? 'On' : 'Off'}</ToggleLabel>
                <Toggle $active={form.kv_bits != null}
                  onClick={() => update('kv_bits', form.kv_bits != null ? null : 8)}>
                  <ToggleKnob $active={form.kv_bits != null} />
                </Toggle>
              </ToggleRow>
            </div>
            {form.kv_bits != null && (
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <div style={{ flex: 1 }}>
                  <Label style={{ fontSize: '0.72rem' }}>KV bits</Label>
                  <Presets>
                    {[4, 8].map(v => (
                      <PresetChip key={v} $active={form.kv_bits === v} onClick={() => update('kv_bits', v)}>{v}-bit</PresetChip>
                    ))}
                  </Presets>
                </div>
                <div style={{ flex: 1 }}>
                  <Label style={{ fontSize: '0.72rem' }}>KV group size</Label>
                  <Presets>
                    {[32, 64, 128].map(v => (
                      <PresetChip key={v} $active={form.kv_group_size === v} onClick={() => update('kv_group_size', v)}>{v}</PresetChip>
                    ))}
                  </Presets>
                </div>
              </div>
            )}
            <div style={{ marginTop: form.kv_bits != null ? 10 : 8 }}>
              <Label style={{ fontSize: '0.72rem' }}>Max KV size (tokens, blank = unlimited)</Label>
              <Input
                type="number"
                placeholder="e.g. 64000"
                value={form.max_kv_size ?? ''}
                onChange={(e) => update('max_kv_size', e.target.value ? parseInt(e.target.value) : null)}
              />
            </div>
            <ParamHint>
              Compresses attention states to reduce unified memory pressure. 8-bit has negligible accuracy impact.
              Max KV size caps the rolling context window to prevent kernel panics under long-context loads.
            </ParamHint>
          </FormGroup>
        </>
      )}

      {isEdit && (
        <FormGroup>
          <Label>Status</Label>
          <Select value={form.is_enabled ? 'enabled' : 'disabled'} onChange={(e) => update('is_enabled', e.target.value === 'enabled')}>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </Select>
        </FormGroup>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={!form.name.trim() || !form.model_id.trim() || loading}>
          {loading ? (isEdit ? 'Saving...' : 'Adding...') : (isEdit ? 'Save Changes' : 'Add Model')}
        </Button>
      </div>
    </Modal>
  );
}
