/**
 * Minimal pure-SVG line chart for training metrics.  No chart library
 * dependency — renders train_loss and val_loss side-by-side over steps.
 */
import { useMemo } from 'react';
import styled from 'styled-components';
import { tokens } from '../../theme/tokens';

interface MetricPoint {
  name: string;
  step: number;
  value: number;
}

const Container = styled.div`
  background: ${tokens.colors.bg.tertiary};
  border: 1px solid ${tokens.colors.border.subtle};
  border-radius: ${tokens.radii.md};
  padding: ${tokens.spacing.md};
`;

const Title = styled.div`
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${tokens.colors.text.muted};
  margin-bottom: 8px;
`;

const Empty = styled.div`
  color: ${tokens.colors.text.muted};
  font-size: 0.85rem;
  text-align: center;
  padding: ${tokens.spacing.md};
`;

const Legend = styled.div`
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-family: ${tokens.fonts.mono};
  font-size: 0.7rem;
  color: ${tokens.colors.text.secondary};
`;

const LegendDot = styled.span<{ $color: string }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $color }) => $color};
  margin-right: 6px;
  vertical-align: middle;
`;

function parseMetrics(metricsJson: string | null): MetricPoint[] {
  if (!metricsJson) return [];
  try {
    const parsed = JSON.parse(metricsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m): m is MetricPoint =>
        typeof m === 'object' && m !== null
        && typeof m.name === 'string'
        && typeof m.step === 'number'
        && typeof m.value === 'number'
        && isFinite(m.value)
      );
  } catch {
    return [];
  }
}

export function LossChart({ metricsJson }: { metricsJson: string | null }) {
  const points = useMemo(() => parseMetrics(metricsJson), [metricsJson]);

  const trainPoints = useMemo(
    () => points.filter((p) => p.name === 'train_loss').sort((a, b) => a.step - b.step),
    [points],
  );
  const valPoints = useMemo(
    () => points.filter((p) => p.name === 'val_loss').sort((a, b) => a.step - b.step),
    [points],
  );

  if (trainPoints.length === 0 && valPoints.length === 0) {
    return (
      <Container>
        <Title>Training metrics</Title>
        <Empty>No metrics yet — they will appear once the training loop emits its first loss line.</Empty>
      </Container>
    );
  }

  const all = [...trainPoints, ...valPoints];
  const minStep = Math.min(...all.map((p) => p.step));
  const maxStep = Math.max(...all.map((p) => p.step));
  const minVal = Math.min(...all.map((p) => p.value));
  const maxVal = Math.max(...all.map((p) => p.value));

  const width = 560;
  const height = 180;
  const padL = 50;
  const padR = 12;
  const padT = 10;
  const padB = 30;

  const xRange = Math.max(1, maxStep - minStep);
  const yRange = Math.max(1e-9, maxVal - minVal);

  const xOf = (step: number) => padL + ((step - minStep) / xRange) * (width - padL - padR);
  const yOf = (val: number) => padT + (1 - (val - minVal) / yRange) * (height - padT - padB);

  const makePath = (pts: MetricPoint[]) =>
    pts.length === 0
      ? ''
      : `M ${pts.map((p) => `${xOf(p.step).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(' L ')}`;

  const trainColor = tokens.colors.accent.primary;
  const valColor = tokens.colors.accent.warning;

  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => minVal + (yRange * i / yTicks));

  return (
    <Container>
      <Title>Training metrics ({trainPoints.length} train • {valPoints.length} val)</Title>
      <svg width={width} height={height} style={{ maxWidth: '100%' }}>
        {/* y-grid */}
        {yTickValues.map((v, i) => (
          <g key={i}>
            <line
              x1={padL} y1={yOf(v)} x2={width - padR} y2={yOf(v)}
              stroke={tokens.colors.border.subtle}
              strokeWidth={i === 0 || i === yTicks ? 1 : 0.5}
              strokeDasharray={i === 0 || i === yTicks ? undefined : '2,3'}
            />
            <text
              x={padL - 4} y={yOf(v) + 3}
              textAnchor="end"
              fontSize="9"
              fontFamily={tokens.fonts.mono}
              fill={tokens.colors.text.muted}
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}

        {/* x-axis labels */}
        <text
          x={padL} y={height - 10}
          fontSize="9"
          fontFamily={tokens.fonts.mono}
          fill={tokens.colors.text.muted}
        >
          step {minStep}
        </text>
        <text
          x={width - padR} y={height - 10}
          textAnchor="end"
          fontSize="9"
          fontFamily={tokens.fonts.mono}
          fill={tokens.colors.text.muted}
        >
          step {maxStep}
        </text>

        {/* train loss line */}
        {trainPoints.length > 0 && (
          <path d={makePath(trainPoints)} fill="none" stroke={trainColor} strokeWidth={1.5} />
        )}

        {/* val loss line */}
        {valPoints.length > 0 && (
          <path d={makePath(valPoints)} fill="none" stroke={valColor} strokeWidth={1.5} strokeDasharray="3,3" />
        )}
      </svg>
      <Legend>
        <span><LegendDot $color={trainColor} />train_loss</span>
        {valPoints.length > 0 && <span><LegendDot $color={valColor} />val_loss</span>}
      </Legend>
    </Container>
  );
}
