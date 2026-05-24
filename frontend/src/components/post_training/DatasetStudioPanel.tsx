/**
 * Dataset Studio — curation tools for SFT datasets (pt_datasets).
 *
 * Operates on Concept #3 (SFT Dataset) per CLAUDE.md. All transformations are
 * non-destructive: every action creates a NEW dataset rather than modifying the
 * source.
 *
 * Tabs:
 *   - Stats:   tokenize all items, show distribution + percentiles + outliers
 *   - Cleanup: regex-based input_text cleanup (built-in rules + custom ephemeral)
 *   - Merge:   N-way merge with configurable dedup
 *   - Filter:  drop items above a token-count threshold
 */
import { useState, useEffect, useMemo } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { postTrainingApi } from '../../api/postTraining';
import { modelsApi } from '../../api/models';
import type {
  CleanupPreview,
  CleanupRule,
  CustomRuleSpec,
  TokenStats,
} from '../../api/postTraining';
import type { Dataset, ModelConfig } from '../../types';

interface Props {
  projectId: string;
}

type SubTab = 'stats' | 'cleanup' | 'merge' | 'filter';

// ─── Styled Components ────────────────────────────────────────────────────────

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`;

const TopBar = styled.div`
  display: flex;
  gap: ${tokens.spacing.md};
  padding: ${tokens.spacing.md} ${tokens.spacing.lg};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
  align-items: center;
  background: ${tokens.colors.bg.secondary};
`;

const Label = styled.label`
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  font-weight: 500;
  color: ${tokens.colors.text.secondary};
  text-transform: uppercase;
  letter-spacing: 0.6px;
`;

const Select = styled.select`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  color: ${tokens.colors.text.primary};
  font-family: ${tokens.fonts.body};
  font-size: 0.875rem;
  padding: 6px 10px;
  outline: none;
  min-width: 240px;
  &:focus { border-color: ${tokens.colors.accent.primary}; }
`;

const Input = styled.input`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  color: ${tokens.colors.text.primary};
  font-family: ${tokens.fonts.body};
  font-size: 0.875rem;
  padding: 6px 10px;
  outline: none;
  &:focus { border-color: ${tokens.colors.accent.primary}; }
`;

const SubTabBar = styled.div`
  display: flex;
  gap: 2px;
  padding: 0 ${tokens.spacing.lg};
  background: ${tokens.colors.bg.primary};
  border-bottom: 1px solid ${tokens.colors.border.subtle};
`;

const SubTabButton = styled.button<{ $active: boolean }>`
  font-family: ${tokens.fonts.accent};
  font-size: 0.8rem;
  font-weight: 500;
  padding: 10px 18px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-bottom: 2px solid ${({ $active }) => ($active ? tokens.colors.accent.primary : 'transparent')};
  color: ${({ $active }) => ($active ? tokens.colors.accent.primary : tokens.colors.text.secondary)};
  transition: all 0.15s;
  &:hover { color: ${tokens.colors.text.primary}; }
`;

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${tokens.spacing.lg};
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${tokens.spacing.md};
  max-width: 1200px;
`;

const Card = styled.div`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: ${tokens.spacing.md};
`;

const CardTitle = styled.h3`
  font-family: ${tokens.fonts.accent};
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: ${tokens.colors.text.secondary};
  margin: 0 0 ${tokens.spacing.sm} 0;
`;

const Row = styled.div<{ $gap?: string; $wrap?: boolean }>`
  display: flex;
  gap: ${({ $gap }) => $gap ?? tokens.spacing.sm};
  align-items: center;
  flex-wrap: ${({ $wrap }) => ($wrap ? 'wrap' : 'nowrap')};
`;

const Stack = styled.div<{ $gap?: string }>`
  display: flex;
  flex-direction: column;
  gap: ${({ $gap }) => $gap ?? tokens.spacing.sm};
`;

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: ${tokens.spacing.sm};
`;

const StatCard = styled.div`
  background: ${tokens.colors.bg.secondary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  padding: ${tokens.spacing.sm} ${tokens.spacing.md};
  text-align: center;
`;

const StatValue = styled.div`
  font-family: ${tokens.fonts.mono};
  font-size: 1.4rem;
  font-weight: 600;
  color: ${tokens.colors.text.primary};
`;

const StatLabel = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.7rem;
  color: ${tokens.colors.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-top: 2px;
`;

const HistogramWrap = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 160px;
  padding: ${tokens.spacing.sm};
  background: ${tokens.colors.bg.secondary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
`;

const Bar = styled.div<{ $height: number }>`
  flex: 1;
  background: ${tokens.colors.accent.primary};
  opacity: 0.7;
  height: ${({ $height }) => $height}%;
  min-height: 2px;
  border-radius: 2px 2px 0 0;
  transition: opacity 0.15s;
  &:hover { opacity: 1.0; }
`;

const HistogramLegend = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 4px ${tokens.spacing.sm} 0;
  font-family: ${tokens.fonts.mono};
  font-size: 0.7rem;
  color: ${tokens.colors.text.muted};
`;

const CleanupRuleRow = styled.label`
  display: flex;
  align-items: flex-start;
  gap: ${tokens.spacing.sm};
  padding: 8px;
  border-radius: ${tokens.radii.sm};
  cursor: pointer;
  &:hover { background: ${tokens.colors.bg.secondary}; }
`;

const Checkbox = styled.input.attrs({ type: 'checkbox' })`
  margin-top: 3px;
  cursor: pointer;
  accent-color: ${tokens.colors.accent.primary};
`;

const RuleText = styled.div`
  flex: 1;
  font-family: ${tokens.fonts.body};
  font-size: 0.85rem;
  color: ${tokens.colors.text.primary};
`;

const RuleDesc = styled.div`
  font-size: 0.75rem;
  color: ${tokens.colors.text.muted};
  margin-top: 2px;
`;

const TierBadge = styled.span<{ $tier: number }>`
  display: inline-block;
  padding: 1px 6px;
  border-radius: 8px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.65rem;
  font-weight: 600;
  margin-right: 6px;
  background: ${({ $tier }) =>
    $tier <= 3 ? 'rgba(80, 200, 120, 0.16)' : 'rgba(255, 180, 60, 0.18)'};
  color: ${({ $tier }) => ($tier <= 3 ? '#5cd685' : '#ffb83c')};
`;

const Pattern = styled.code`
  display: block;
  font-family: ${tokens.fonts.mono};
  font-size: 0.72rem;
  color: ${tokens.colors.text.muted};
  background: ${tokens.colors.bg.primary};
  padding: 2px 4px;
  margin-top: 4px;
  border-radius: 3px;
  word-break: break-all;
`;

const Pre = styled.pre`
  font-family: ${tokens.fonts.mono};
  font-size: 0.75rem;
  background: ${tokens.colors.bg.secondary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
  padding: ${tokens.spacing.sm};
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${tokens.colors.text.primary};
  margin: 0;
`;

const DiffGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${tokens.spacing.sm};
`;

const DiffLabel = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: ${tokens.colors.text.muted};
  margin-bottom: 4px;
`;

const TableWrap = styled.div`
  overflow: auto;
  max-height: 320px;
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.sm};
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-family: ${tokens.fonts.body};
  font-size: 0.8rem;
  th, td {
    padding: 6px 10px;
    text-align: left;
    border-bottom: 1px solid ${tokens.colors.border.subtle};
  }
  th {
    font-family: ${tokens.fonts.accent};
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: ${tokens.colors.text.muted};
    background: ${tokens.colors.bg.secondary};
    position: sticky;
    top: 0;
  }
  td {
    color: ${tokens.colors.text.primary};
  }
`;

const SourceRow = styled.label`
  display: flex;
  align-items: center;
  gap: ${tokens.spacing.sm};
  padding: 8px;
  border-radius: ${tokens.radii.sm};
  cursor: pointer;
  &:hover { background: ${tokens.colors.bg.secondary}; }
`;

const HelpText = styled.div`
  font-family: ${tokens.fonts.body};
  font-size: 0.78rem;
  color: ${tokens.colors.text.muted};
  font-style: italic;
`;

const ErrorBox = styled.div`
  background: rgba(231, 76, 60, 0.1);
  border: 1px solid rgba(231, 76, 60, 0.4);
  color: #e74c3c;
  border-radius: ${tokens.radii.sm};
  padding: ${tokens.spacing.sm} ${tokens.spacing.md};
  font-size: 0.85rem;
`;

// ─── Component ────────────────────────────────────────────────────────────────

const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: 'stats', label: '📊 Stats' },
  { id: 'cleanup', label: '🧹 Cleanup' },
  { id: 'merge', label: '🔗 Merge' },
  { id: 'filter', label: '✂ Filter' },
];

export function DatasetStudioPanel({ projectId }: Props) {
  const [activeTab, setActiveTab] = useState<SubTab>('stats');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [sourceDatasetId, setSourceDatasetId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cleanup rules + state
  const [cleanupRules, setCleanupRules] = useState<CleanupRule[]>([]);
  const [enabledRuleIds, setEnabledRuleIds] = useState<Set<string>>(new Set());
  const [customRules, setCustomRules] = useState<CustomRuleSpec[]>([]);
  const [customPattern, setCustomPattern] = useState('');
  const [customReplacement, setCustomReplacement] = useState('');
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(null);
  const [cleanupNewName, setCleanupNewName] = useState('');

  // Merge state
  const [mergeSourceIds, setMergeSourceIds] = useState<string[]>([]);
  const [mergeNewName, setMergeNewName] = useState('');
  const [mergeDedup, setMergeDedup] = useState<'none' | 'exact' | 'input_only'>('none');

  // Stats state
  const [statsModelId, setStatsModelId] = useState<string>('');
  const [stats, setStats] = useState<TokenStats | null>(null);

  // Filter state
  const [filterModelId, setFilterModelId] = useState<string>('');
  const [filterThreshold, setFilterThreshold] = useState<number>(8192);
  const [filterMode, setFilterMode] = useState<'absolute' | 'percentile'>('absolute');
  const [filterPercentile, setFilterPercentile] = useState<number>(95);
  const [filterNewName, setFilterNewName] = useState('');

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function loadData() {
    try {
      const [ds, mods, rules] = await Promise.all([
        postTrainingApi.listDatasets(projectId),
        modelsApi.list(),
        postTrainingApi.listCleanupRules(projectId),
      ]);
      setDatasets(ds);
      setModels(mods.filter((m) => m.is_enabled));
      setCleanupRules(rules);
      // Initialize enabled rules with the defaults
      setEnabledRuleIds(new Set(rules.filter((r) => r.default_on).map((r) => r.id)));
    } catch (e) {
      setError(`Failed to load: ${(e as Error).message}`);
    }
  }

  const selectedDataset = useMemo(
    () => datasets.find((d) => d.id === sourceDatasetId) ?? null,
    [datasets, sourceDatasetId],
  );

  // Effective threshold for the Filter tab (resolves percentile → absolute)
  const effectiveFilterThreshold = useMemo(() => {
    if (filterMode === 'absolute') return filterThreshold;
    if (!stats || !stats.tokenizer_loaded) return 0;
    const key = `p${filterPercentile}` as keyof typeof stats.stats;
    return stats.stats[key] ?? 0;
  }, [filterMode, filterThreshold, filterPercentile, stats]);

  // Predict how many items would be dropped at the current threshold
  const dropPreview = useMemo(() => {
    if (!stats || !stats.tokenizer_loaded || effectiveFilterThreshold <= 0) {
      return null;
    }
    const dropped = stats.items.filter((i) => i.token_count > effectiveFilterThreshold).length;
    return { kept: stats.items.length - dropped, dropped, total: stats.items.length };
  }, [stats, effectiveFilterThreshold]);

  // ─── Tab Handlers ──────────────────────────────────────────────────────────

  function toggleRule(id: string) {
    setEnabledRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addCustomRule() {
    if (!customPattern.trim()) return;
    setCustomRules((prev) => [
      ...prev,
      { pattern: customPattern, replacement: customReplacement, name: 'custom', multiline: true },
    ]);
    setCustomPattern('');
    setCustomReplacement('');
  }

  function removeCustomRule(idx: number) {
    setCustomRules((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handlePreviewCleanup() {
    if (!sourceDatasetId) {
      setError('Select a source dataset first');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await postTrainingApi.previewCleanup(projectId, {
        source_dataset_id: sourceDatasetId,
        enabled_rule_ids: Array.from(enabledRuleIds),
        custom_rules: customRules,
        sample_size: 3,
      });
      setCleanupPreview(result);
    } catch (e) {
      setError(`Preview failed: ${(e as Error).message}`);
    }
    setLoading(false);
  }

  async function handleApplyCleanup() {
    if (!sourceDatasetId) {
      setError('Select a source dataset first');
      return;
    }
    if (!cleanupNewName.trim()) {
      setError('Provide a name for the new dataset');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await postTrainingApi.applyCleanup(projectId, {
        source_dataset_id: sourceDatasetId,
        enabled_rule_ids: Array.from(enabledRuleIds),
        custom_rules: customRules,
        new_name: cleanupNewName.trim(),
      });
      alert(
        `Created "${result.dataset.name}" with ${result.items} items.\n` +
        `Input text: ${result.input_chars_before.toLocaleString()} → ${result.input_chars_after.toLocaleString()} chars ` +
        `(${(((result.input_chars_before - result.input_chars_after) / Math.max(1, result.input_chars_before)) * 100).toFixed(1)}% reduction).`,
      );
      setCleanupNewName('');
      setCleanupPreview(null);
      await loadData();
    } catch (e) {
      setError(`Apply failed: ${(e as Error).message}`);
    }
    setLoading(false);
  }

  async function handleMerge() {
    if (mergeSourceIds.length < 1) {
      setError('Select at least one source dataset');
      return;
    }
    if (!mergeNewName.trim()) {
      setError('Provide a name for the new dataset');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await postTrainingApi.mergeDatasets(projectId, {
        source_dataset_ids: mergeSourceIds,
        new_name: mergeNewName.trim(),
        dedup_strategy: mergeDedup,
      });
      alert(`Created "${result.name}" with ${result.item_count} items.`);
      setMergeSourceIds([]);
      setMergeNewName('');
      await loadData();
    } catch (e) {
      setError(`Merge failed: ${(e as Error).message}`);
    }
    setLoading(false);
  }

  async function handleComputeStats() {
    if (!sourceDatasetId) {
      setError('Select a source dataset first');
      return;
    }
    if (!statsModelId.trim()) {
      setError('Enter a model ID (HuggingFace repo id)');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await postTrainingApi.tokenStats(projectId, {
        dataset_id: sourceDatasetId,
        model_id: statsModelId.trim(),
      });
      setStats(result);
      if (result.error) {
        setError(result.error);
      }
    } catch (e) {
      setError(`Token stats failed: ${(e as Error).message}`);
    }
    setLoading(false);
  }

  async function handleFilter() {
    if (!sourceDatasetId) {
      setError('Select a source dataset first');
      return;
    }
    if (!filterModelId.trim()) {
      setError('Enter a tokenizer model ID');
      return;
    }
    if (effectiveFilterThreshold <= 0) {
      setError('Threshold must be positive');
      return;
    }
    if (!filterNewName.trim()) {
      setError('Provide a name for the new dataset');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await postTrainingApi.filterByTokens(projectId, {
        source_dataset_id: sourceDatasetId,
        model_id: filterModelId.trim(),
        max_tokens: effectiveFilterThreshold,
        new_name: filterNewName.trim(),
      });
      alert(
        `Created "${result.dataset.name}".\n` +
        `Kept ${result.kept} of ${result.total} items (dropped ${result.dropped}).`,
      );
      setFilterNewName('');
      await loadData();
    } catch (e) {
      setError(`Filter failed: ${(e as Error).message}`);
    }
    setLoading(false);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <Page>
      <TopBar>
        <Label>Source Dataset</Label>
        <Select
          value={sourceDatasetId}
          onChange={(e) => {
            setSourceDatasetId(e.target.value);
            setCleanupPreview(null);
            setStats(null);
          }}
        >
          <option value="">— select dataset —</option>
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.item_count} items)
            </option>
          ))}
        </Select>
        {selectedDataset && (
          <Badge color="secondary">{selectedDataset.item_count} items</Badge>
        )}
      </TopBar>

      <SubTabBar>
        {SUB_TABS.map((t) => (
          <SubTabButton
            key={t.id}
            $active={activeTab === t.id}
            onClick={() => {
              setActiveTab(t.id);
              setError(null);
            }}
          >
            {t.label}
          </SubTabButton>
        ))}
      </SubTabBar>

      <Content>
        {error && <ErrorBox>{error}</ErrorBox>}

        {/* ─── STATS TAB ──────────────────────────────────────────────────── */}
        {activeTab === 'stats' && (
          <Section>
            <Card>
              <CardTitle>Tokenizer Settings</CardTitle>
              <Stack>
                <Row $wrap>
                  <Label>Model</Label>
                  <Select
                    value={statsModelId}
                    onChange={(e) => setStatsModelId(e.target.value)}
                  >
                    <option value="">— select model —</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.model_id}>
                        {m.name} ({m.model_id})
                      </option>
                    ))}
                  </Select>
                  <HelpText>or paste an HF repo id directly:</HelpText>
                  <Input
                    placeholder="Qwen/Qwen3-4B-FP8"
                    value={statsModelId}
                    onChange={(e) => setStatsModelId(e.target.value)}
                    style={{ minWidth: 280 }}
                  />
                  <Button onClick={handleComputeStats} disabled={loading || !sourceDatasetId}>
                    {loading ? 'Tokenizing…' : 'Compute Stats'}
                  </Button>
                </Row>
                <HelpText>
                  First run for a model downloads its tokenizer (~5-50MB). Subsequent runs use the cache.
                </HelpText>
              </Stack>
            </Card>

            {stats && stats.tokenizer_loaded && (
              <>
                <Card>
                  <CardTitle>Distribution</CardTitle>
                  <StatGrid>
                    <StatCard>
                      <StatValue>{stats.stats.min ?? '—'}</StatValue>
                      <StatLabel>Min</StatLabel>
                    </StatCard>
                    <StatCard>
                      <StatValue>{stats.stats.mean ?? '—'}</StatValue>
                      <StatLabel>Mean</StatLabel>
                    </StatCard>
                    <StatCard>
                      <StatValue>{stats.stats.p50 ?? '—'}</StatValue>
                      <StatLabel>P50</StatLabel>
                    </StatCard>
                    <StatCard>
                      <StatValue>{stats.stats.p75 ?? '—'}</StatValue>
                      <StatLabel>P75</StatLabel>
                    </StatCard>
                    <StatCard>
                      <StatValue>{stats.stats.p90 ?? '—'}</StatValue>
                      <StatLabel>P90</StatLabel>
                    </StatCard>
                    <StatCard>
                      <StatValue>{stats.stats.p95 ?? '—'}</StatValue>
                      <StatLabel>P95</StatLabel>
                    </StatCard>
                    <StatCard>
                      <StatValue>{stats.stats.p99 ?? '—'}</StatValue>
                      <StatLabel>P99</StatLabel>
                    </StatCard>
                    <StatCard>
                      <StatValue>{stats.stats.max ?? '—'}</StatValue>
                      <StatLabel>Max</StatLabel>
                    </StatCard>
                  </StatGrid>
                </Card>

                <Card>
                  <CardTitle>Histogram</CardTitle>
                  <HistogramWrap>
                    {stats.histogram.counts.map((c, i) => {
                      const max = Math.max(1, ...stats.histogram.counts);
                      return <Bar key={i} $height={(c / max) * 100} title={`${c} items`} />;
                    })}
                  </HistogramWrap>
                  <HistogramLegend>
                    <span>0</span>
                    <span>
                      {stats.histogram.bin_edges[stats.histogram.bin_edges.length - 1] ?? 0} tokens
                    </span>
                  </HistogramLegend>
                </Card>

                <Card>
                  <CardTitle>Top Outliers (longest items)</CardTitle>
                  <TableWrap>
                    <Table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Name</th>
                          <th>Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.items.slice(0, 20).map((item, i) => (
                          <tr key={item.id}>
                            <td>{i + 1}</td>
                            <td>{item.name ?? <i style={{ color: tokens.colors.text.muted }}>(unnamed)</i>}</td>
                            <td>
                              <span style={{ fontFamily: tokens.fonts.mono }}>
                                {item.token_count.toLocaleString()}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </TableWrap>
                </Card>
              </>
            )}
          </Section>
        )}

        {/* ─── CLEANUP TAB ────────────────────────────────────────────────── */}
        {activeTab === 'cleanup' && (
          <Section>
            <Card>
              <CardTitle>Built-in Rules</CardTitle>
              <Stack $gap="2px">
                {cleanupRules.map((r) => (
                  <CleanupRuleRow key={r.id}>
                    <Checkbox
                      checked={enabledRuleIds.has(r.id)}
                      onChange={() => toggleRule(r.id)}
                    />
                    <RuleText>
                      <TierBadge $tier={r.tier}>Tier {r.tier}</TierBadge>
                      <strong>{r.name}</strong>
                      <RuleDesc>{r.description}</RuleDesc>
                      {r.pattern && <Pattern>{r.pattern}</Pattern>}
                    </RuleText>
                  </CleanupRuleRow>
                ))}
              </Stack>
            </Card>

            <Card>
              <CardTitle>Custom Regex (session-only)</CardTitle>
              <Stack>
                <Row $wrap>
                  <Input
                    placeholder="Pattern (e.g. ^FAX FROM:.*$)"
                    value={customPattern}
                    onChange={(e) => setCustomPattern(e.target.value)}
                    style={{ flex: 1, minWidth: 280 }}
                  />
                  <Input
                    placeholder="Replacement (blank = remove)"
                    value={customReplacement}
                    onChange={(e) => setCustomReplacement(e.target.value)}
                    style={{ flex: 1, minWidth: 200 }}
                  />
                  <Button onClick={addCustomRule} disabled={!customPattern.trim()}>
                    + Add
                  </Button>
                </Row>
                <HelpText>Multiline flag is enabled by default (so `^` matches line starts).</HelpText>
                {customRules.length > 0 && (
                  <Stack $gap="2px">
                    {customRules.map((cr, i) => (
                      <Row key={i}>
                        <Pattern style={{ flex: 1, margin: 0 }}>{cr.pattern}</Pattern>
                        <span style={{ fontFamily: tokens.fonts.mono, fontSize: '0.75rem', color: tokens.colors.text.muted }}>
                          → {cr.replacement || '(empty)'}
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => removeCustomRule(i)}>
                          ✕
                        </Button>
                      </Row>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Card>

            <Card>
              <CardTitle>Preview & Apply</CardTitle>
              <Stack>
                <Row $wrap>
                  <Button onClick={handlePreviewCleanup} disabled={loading || !sourceDatasetId}>
                    {loading ? 'Working…' : '🔍 Preview on 3 samples'}
                  </Button>
                </Row>

                {cleanupPreview && (
                  <Stack>
                    <Row $gap={tokens.spacing.md}>
                      <Badge color="secondary">
                        {cleanupPreview.total_chars_before.toLocaleString()} →{' '}
                        {cleanupPreview.total_chars_after.toLocaleString()} chars
                      </Badge>
                      <Badge color={cleanupPreview.estimated_savings_pct > 5 ? 'success' : 'secondary'}>
                        {cleanupPreview.estimated_savings_pct.toFixed(1)}% reduction
                      </Badge>
                      <span style={{ fontSize: '0.8rem', color: tokens.colors.text.muted }}>
                        across {cleanupPreview.total_items} items
                      </span>
                    </Row>
                    {cleanupPreview.samples.map((s) => (
                      <Stack key={s.id}>
                        <div style={{ fontSize: '0.8rem', color: tokens.colors.text.secondary }}>
                          <strong>{s.name ?? '(unnamed)'}</strong> · {s.chars_before} → {s.chars_after} chars
                        </div>
                        <DiffGrid>
                          <div>
                            <DiffLabel>Before</DiffLabel>
                            <Pre>{s.before.slice(0, 4000)}{s.before.length > 4000 ? '…' : ''}</Pre>
                          </div>
                          <div>
                            <DiffLabel>After</DiffLabel>
                            <Pre>{s.after.slice(0, 4000)}{s.after.length > 4000 ? '…' : ''}</Pre>
                          </div>
                        </DiffGrid>
                      </Stack>
                    ))}
                  </Stack>
                )}

                <Row $wrap>
                  <Input
                    placeholder="New dataset name…"
                    value={cleanupNewName}
                    onChange={(e) => setCleanupNewName(e.target.value)}
                    style={{ flex: 1, minWidth: 240 }}
                  />
                  <Button
                    onClick={handleApplyCleanup}
                    disabled={loading || !sourceDatasetId || !cleanupNewName.trim()}
                  >
                    {loading ? 'Applying…' : '✓ Create New Dataset'}
                  </Button>
                </Row>
                <HelpText>
                  Cleanup is applied only to <strong>input_text</strong>. Instructions, outputs, and system messages are preserved as-is.
                </HelpText>
              </Stack>
            </Card>
          </Section>
        )}

        {/* ─── MERGE TAB ──────────────────────────────────────────────────── */}
        {activeTab === 'merge' && (
          <Section>
            <Card>
              <CardTitle>Source Datasets</CardTitle>
              <Stack $gap="2px">
                {datasets.map((d) => (
                  <SourceRow key={d.id}>
                    <Checkbox
                      checked={mergeSourceIds.includes(d.id)}
                      onChange={() => {
                        setMergeSourceIds((prev) =>
                          prev.includes(d.id) ? prev.filter((id) => id !== d.id) : [...prev, d.id],
                        );
                      }}
                    />
                    <span style={{ flex: 1 }}>{d.name}</span>
                    <Badge color="secondary">{d.item_count}</Badge>
                  </SourceRow>
                ))}
              </Stack>
              <HelpText style={{ marginTop: tokens.spacing.sm }}>
                Items are concatenated in the order you select datasets. With "input_only" dedup, later sources overwrite earlier ones.
              </HelpText>
            </Card>

            <Card>
              <CardTitle>Dedup Strategy</CardTitle>
              <Stack>
                <Select
                  value={mergeDedup}
                  onChange={(e) => setMergeDedup(e.target.value as typeof mergeDedup)}
                  style={{ maxWidth: 320 }}
                >
                  <option value="none">None — keep all items</option>
                  <option value="exact">Exact — drop items with same (instruction, input, output, system)</option>
                  <option value="input_only">Input-only — one item per (instruction, input); later wins</option>
                </Select>
              </Stack>
            </Card>

            <Card>
              <CardTitle>New Dataset</CardTitle>
              <Row $wrap>
                <Input
                  placeholder="New dataset name…"
                  value={mergeNewName}
                  onChange={(e) => setMergeNewName(e.target.value)}
                  style={{ flex: 1, minWidth: 240 }}
                />
                <Button
                  onClick={handleMerge}
                  disabled={loading || mergeSourceIds.length === 0 || !mergeNewName.trim()}
                >
                  {loading ? 'Merging…' : `🔗 Merge ${mergeSourceIds.length} dataset(s)`}
                </Button>
              </Row>
            </Card>
          </Section>
        )}

        {/* ─── FILTER TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'filter' && (
          <Section>
            <Card>
              <CardTitle>Tokenizer</CardTitle>
              <Row $wrap>
                <Select
                  value={filterModelId}
                  onChange={(e) => setFilterModelId(e.target.value)}
                >
                  <option value="">— select model —</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.model_id}>
                      {m.name} ({m.model_id})
                    </option>
                  ))}
                </Select>
                <HelpText>or HF repo id:</HelpText>
                <Input
                  placeholder="Qwen/Qwen3-4B-FP8"
                  value={filterModelId}
                  onChange={(e) => setFilterModelId(e.target.value)}
                  style={{ minWidth: 280 }}
                />
              </Row>
              <HelpText style={{ marginTop: tokens.spacing.sm }}>
                Run <strong>Stats</strong> first with this model to see the distribution and pick a sensible threshold.
              </HelpText>
            </Card>

            <Card>
              <CardTitle>Threshold</CardTitle>
              <Stack>
                <Row $wrap>
                  <Label>Mode</Label>
                  <Select
                    value={filterMode}
                    onChange={(e) => setFilterMode(e.target.value as typeof filterMode)}
                    style={{ minWidth: 180 }}
                  >
                    <option value="absolute">Absolute token count</option>
                    <option value="percentile">Percentile (needs Stats run)</option>
                  </Select>
                </Row>

                {filterMode === 'absolute' && (
                  <Row $wrap>
                    <Label>Max tokens</Label>
                    <Input
                      type="number"
                      min={1}
                      value={filterThreshold}
                      onChange={(e) => setFilterThreshold(parseInt(e.target.value, 10) || 0)}
                      style={{ width: 120 }}
                    />
                    <HelpText>items above this are dropped</HelpText>
                  </Row>
                )}

                {filterMode === 'percentile' && (
                  <Row $wrap>
                    <Label>Drop above</Label>
                    <Select
                      value={String(filterPercentile)}
                      onChange={(e) => setFilterPercentile(parseInt(e.target.value, 10))}
                      style={{ minWidth: 80 }}
                    >
                      <option value="50">P50</option>
                      <option value="75">P75</option>
                      <option value="90">P90</option>
                      <option value="95">P95</option>
                      <option value="99">P99</option>
                    </Select>
                    <HelpText>
                      {stats?.tokenizer_loaded && stats.stats[`p${filterPercentile}` as keyof typeof stats.stats]
                        ? `= ${stats.stats[`p${filterPercentile}` as keyof typeof stats.stats]} tokens`
                        : '(run Stats to compute)'}
                    </HelpText>
                  </Row>
                )}

                {dropPreview && (
                  <Badge color={dropPreview.dropped > 0 ? 'primary' : 'secondary'}>
                    Will drop {dropPreview.dropped} of {dropPreview.total} items
                    {' '}({((dropPreview.dropped / Math.max(1, dropPreview.total)) * 100).toFixed(1)}%)
                  </Badge>
                )}
              </Stack>
            </Card>

            <Card>
              <CardTitle>New Dataset</CardTitle>
              <Row $wrap>
                <Input
                  placeholder="New dataset name…"
                  value={filterNewName}
                  onChange={(e) => setFilterNewName(e.target.value)}
                  style={{ flex: 1, minWidth: 240 }}
                />
                <Button
                  onClick={handleFilter}
                  disabled={
                    loading || !sourceDatasetId || !filterModelId.trim() ||
                    effectiveFilterThreshold <= 0 || !filterNewName.trim()
                  }
                >
                  {loading ? 'Filtering…' : `✂ Filter to ≤ ${effectiveFilterThreshold || '?'} tokens`}
                </Button>
              </Row>
            </Card>
          </Section>
        )}
      </Content>
    </Page>
  );
}
