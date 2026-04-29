import { useMemo, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { tokens } from '../../theme/tokens';
import type { Chain, ChainEdge, ChainNode, ChainNodeRunStatus, EdgeAssertion } from '../../types';

/**
 * Native-SVG DAG canvas. Read+edit. Mouse interactions:
 * - drag a node body to reposition (saves on mouseup)
 * - click a node to open its config modal
 * - click an edge label/path to open the assertion editor
 * - in "connect mode", click a source node, then a target node, to create an edge
 */

const NODE_W = 200;
const NODE_H = 70;
const PADDING = 80;

const CanvasFrame = styled.div<{ $connectMode: boolean }>`
  /* flex: 1 1 0 (not 1 1 auto) so the canvas yields space when the runs
     drawer below it claims its min-height. The 480px floor used to win every
     time and pushed the drawer below the fold on most viewports. */
  flex: 1 1 0;
  min-height: 240px;
  width: 100%;
  background: ${tokens.colors.bg.primary};
  border: 1px solid
    ${({ $connectMode }) => ($connectMode ? tokens.colors.accent.secondary : tokens.colors.border.subtle)};
  border-radius: ${tokens.radii.sm};
  overflow: auto;
  position: relative;
  cursor: ${({ $connectMode }) => ($connectMode ? 'crosshair' : 'default')};
`;

const ConnectBanner = styled.div`
  position: sticky;
  top: 0;
  left: 0;
  z-index: 5;
  background: ${tokens.colors.accent.secondary};
  color: ${tokens.colors.bg.primary};
  font-family: ${tokens.fonts.accent};
  font-size: 0.75rem;
  font-weight: 600;
  padding: 6px 12px;
  text-align: center;
`;

const Empty = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 200px;
  color: ${tokens.colors.text.muted};
  font-size: 0.85rem;
`;

function assertionLabel(a: EdgeAssertion | null): string | undefined {
  if (!a) return undefined;
  const neg = a.negate ? 'NOT ' : '';
  return `${neg}${a.op} "${a.value}"`;
}

interface LaidNode extends ChainNode {
  x: number;
  y: number;
}

interface Layout {
  nodes: LaidNode[];
  edges: ChainEdge[];
  width: number;
  height: number;
}

/**
 * Lay out nodes in screen space.
 *
 * Rendering offset is **decoupled from current node positions** — it's
 * captured once when the chain first loads and stays stable across drags.
 * If we recomputed the offset from `min(position_x)` every render, dragging
 * the leftmost (or topmost) node would change the offset for every node,
 * making the "non-dragged" nodes appear to slide. The offset is owned by
 * the caller and passed in.
 */
function layout(chain: Chain, offset: { x: number; y: number }): Layout {
  if (chain.nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }
  const laidNodes = chain.nodes.map((n) => ({
    ...n,
    x: n.position_x + offset.x,
    y: n.position_y + offset.y,
  }));
  // SVG dimensions grow to fit current content but never shrink below a sane
  // minimum. Using the laid (offset-applied) coords means nodes dragged into
  // negative chain-space still influence the SVG height/width sensibly.
  const xs = laidNodes.map((n) => n.x);
  const ys = laidNodes.map((n) => n.y);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    nodes: laidNodes,
    edges: chain.edges,
    width: Math.max(NODE_W + PADDING * 2, maxX + NODE_W + PADDING),
    height: Math.max(NODE_H + PADDING * 2, maxY + NODE_H + PADDING),
  };
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dy = Math.max(40, Math.abs(y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}

interface DragState {
  nodeId: string;
  startMouseX: number;
  startMouseY: number;
  startNodeX: number;
  startNodeY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
}

interface Props {
  chain: Chain;
  connectMode: boolean;
  // Edge creation: caller manages the source-pick state so the toolbar can
  // reflect "click target node next".
  pendingSourceId: string | null;
  onSourcePick: (nodeId: string) => void;
  onTargetPick: (nodeId: string) => void;
  // Click handlers for opening modals. We split inspect vs edit so the parent
  // can use single-click for "show me what this node ran" and double-click for
  // "let me edit this node's config" — both useful while a run is selected.
  onNodeInspect: (node: ChainNode) => void;
  onNodeEdit: (node: ChainNode) => void;
  onEdgeClick: (edge: ChainEdge) => void;
  // Persisted on drag end.
  onNodePositionCommit: (nodeId: string, x: number, y: number) => void;
  // Optional run-state overlay: maps node_id -> status; when present we color
  // nodes based on run state and dim ones not yet executed.
  runStateByNodeId?: Record<string, ChainNodeRunStatus> | null;
}

const pulseKeyframes = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`;

const PulsingNodeRect = styled.rect`
  animation: ${pulseKeyframes} 1.2s ease-in-out infinite;
`;

function colorForStatus(status: ChainNodeRunStatus): { stroke: string; accent: string; dimmed: boolean } {
  switch (status) {
    case 'running':
      return { stroke: tokens.colors.accent.warning, accent: tokens.colors.accent.warning, dimmed: false };
    case 'completed':
      return { stroke: tokens.colors.accent.success, accent: tokens.colors.accent.success, dimmed: false };
    case 'failed':
      return { stroke: tokens.colors.accent.error, accent: tokens.colors.accent.error, dimmed: false };
    case 'skipped':
      return { stroke: tokens.colors.border.subtle, accent: tokens.colors.border.subtle, dimmed: true };
    case 'pending':
    default:
      return { stroke: tokens.colors.border.subtle, accent: tokens.colors.border.strong, dimmed: true };
  }
}

export function ChainCanvas({
  chain,
  connectMode,
  pendingSourceId,
  onSourcePick,
  onTargetPick,
  onNodeInspect,
  onNodeEdit,
  onEdgeClick,
  onNodePositionCommit,
  runStateByNodeId,
}: Props) {
  // Capture the rendering offset once per chain so dragging a single node
  // never shifts the others. Only changes when the user switches chains.
  const offset = useMemo(() => {
    if (chain.nodes.length === 0) return { x: PADDING, y: PADDING };
    const minX = Math.min(...chain.nodes.map((n) => n.position_x));
    const minY = Math.min(...chain.nodes.map((n) => n.position_y));
    return { x: -minX + PADDING, y: -minY + PADDING };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain.id]);

  const lay = useMemo(() => layout(chain, offset), [chain, offset]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Ref so mousedown/mousemove/mouseup can read each other's writes without
  // waiting on React's batched state. State is mirrored only for re-rendering.
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  if (lay.nodes.length === 0) {
    return (
      <CanvasFrame $connectMode={connectMode}>
        <Empty>No nodes yet — click "+ Node" in the toolbar.</Empty>
      </CanvasFrame>
    );
  }

  // Apply in-flight drag offsets to the laid-out nodes for live preview.
  const nodes = drag
    ? lay.nodes.map((n) =>
        n.id === drag.nodeId
          ? { ...n, x: drag.startNodeX + (drag.currentX - drag.startMouseX), y: drag.startNodeY + (drag.currentY - drag.startMouseY) }
          : n,
      )
    : lay.nodes;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const handleMouseDown = (e: React.MouseEvent, n: LaidNode) => {
    if (connectMode) return;
    e.stopPropagation();
    const next: DragState = {
      nodeId: n.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startNodeX: n.x,
      startNodeY: n.y,
      currentX: e.clientX,
      currentY: e.clientY,
      moved: false,
    };
    dragRef.current = next;
    setDrag(next);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const cur = dragRef.current;
    if (!cur) return;
    const dx = e.clientX - cur.startMouseX;
    const dy = e.clientY - cur.startMouseY;
    const next: DragState = {
      ...cur,
      currentX: e.clientX,
      currentY: e.clientY,
      moved: cur.moved || Math.hypot(dx, dy) > 4,
    };
    dragRef.current = next;
    setDrag(next);
  };

  const handleMouseUp = () => {
    const cur = dragRef.current;
    if (!cur) return;
    if (cur.moved) {
      const node = chain.nodes.find((n) => n.id === cur.nodeId);
      if (node) {
        const dx = cur.currentX - cur.startMouseX;
        const dy = cur.currentY - cur.startMouseY;
        onNodePositionCommit(cur.nodeId, node.position_x + dx, node.position_y + dy);
      }
    }
    dragRef.current = null;
    setDrag(null);
  };

  const handleNodeClick = (e: React.MouseEvent, n: LaidNode) => {
    e.stopPropagation();
    // mouseup completing a drag — don't treat as click. Check ref because the
    // state setter may not have propagated yet by the time click fires.
    if (dragRef.current?.moved) return;
    // Connect mode is the only single-click action. Otherwise single-click is
    // a no-op so dragging doesn't accidentally pop modals; the eye icon below
    // handles "inspect," and double-click handles "edit."
    if (connectMode) {
      if (!pendingSourceId) onSourcePick(n.id);
      else if (pendingSourceId !== n.id) onTargetPick(n.id);
    }
  };

  const handleNodeDoubleClick = (e: React.MouseEvent, n: LaidNode) => {
    e.stopPropagation();
    if (connectMode) return;
    onNodeEdit(n);
  };

  const handleEyeClick = (e: React.MouseEvent, n: LaidNode) => {
    // Stop the click bubbling so the parent group's click handler (and any
    // future single-click action) doesn't also fire.
    e.stopPropagation();
    onNodeInspect(n);
  };

  return (
    <CanvasFrame $connectMode={connectMode}>
      {connectMode && (
        <ConnectBanner>
          {pendingSourceId
            ? 'Click a target node to create the edge (Esc to cancel)'
            : 'Click a source node to start the edge (Esc to cancel)'}
        </ConnectBanner>
      )}
      <svg
        ref={svgRef}
        width={lay.width}
        height={lay.height}
        style={{ display: 'block' }}
        xmlns="http://www.w3.org/2000/svg"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <marker
            id="chain-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={tokens.colors.text.secondary} />
          </marker>
          <marker
            id="chain-arrow-conditional"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={tokens.colors.accent.primary} />
          </marker>
        </defs>

        {/* Edges */}
        {lay.edges.map((e) => {
          const src = nodeById.get(e.source_node_id);
          const tgt = nodeById.get(e.target_node_id);
          if (!src || !tgt) return null;
          const x1 = src.x + NODE_W / 2;
          const y1 = src.y + NODE_H;
          const x2 = tgt.x + NODE_W / 2;
          const y2 = tgt.y;
          const conditional = !!e.assertion;
          const stroke = conditional ? tokens.colors.accent.primary : tokens.colors.text.secondary;
          const labelText = assertionLabel(e.assertion);
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          return (
            <g
              key={e.id}
              style={{ cursor: 'pointer' }}
              onClick={(ev) => {
                ev.stopPropagation();
                onEdgeClick(e);
              }}
            >
              {/* Wider transparent hit-target */}
              <path
                d={bezierPath(x1, y1, x2, y2)}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
              />
              <path
                d={bezierPath(x1, y1, x2, y2)}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                strokeDasharray={conditional ? '6 4' : undefined}
                markerEnd={`url(#${conditional ? 'chain-arrow-conditional' : 'chain-arrow'})`}
                pointerEvents="none"
              />
              {labelText && (
                <g transform={`translate(${midX}, ${midY})`} pointerEvents="none">
                  <rect
                    x={-((labelText.length * 6) / 2 + 6)}
                    y={-9}
                    width={labelText.length * 6 + 12}
                    height={18}
                    rx={3}
                    fill={tokens.colors.bg.secondary}
                    stroke={tokens.colors.border.subtle}
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={11}
                    fill={tokens.colors.text.secondary}
                    fontFamily={tokens.fonts.mono}
                  >
                    {labelText}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const configured = !!n.prompt_version_id && !!n.model_config_id;
          const isRoot = !!n.input_text;
          const isPendingSource = pendingSourceId === n.id;
          const isDragging = drag?.nodeId === n.id;
          const runStatus = runStateByNodeId?.[n.id];
          const runColors = runStatus ? colorForStatus(runStatus) : null;

          const borderColor = isPendingSource
            ? tokens.colors.accent.secondary
            : runColors
              ? runColors.stroke
              : configured
                ? tokens.colors.accent.primary
                : tokens.colors.border.subtle;
          const accentColor = runColors
            ? runColors.accent
            : isRoot
              ? tokens.colors.accent.secondary
              : configured
                ? tokens.colors.accent.primary
                : tokens.colors.border.strong;
          const opacity = isDragging ? 0.85 : runColors?.dimmed ? 0.6 : 1;
          const RectComp = runStatus === 'running' ? PulsingNodeRect : 'rect';
          const subline = runStatus
            ? runStatus
            : configured
              ? `configured${isRoot ? ' • root' : ''}`
              : `unconfigured${isRoot ? ' • root' : ''}`;
          return (
            <g
              key={n.id}
              transform={`translate(${n.x}, ${n.y})`}
              style={{
                cursor: connectMode ? 'pointer' : isDragging ? 'grabbing' : 'grab',
                opacity,
              }}
              onMouseDown={(e) => handleMouseDown(e, n)}
              onClick={(e) => handleNodeClick(e, n)}
              onDoubleClick={(e) => handleNodeDoubleClick(e, n)}
            >
              <RectComp
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={tokens.colors.bg.secondary}
                stroke={borderColor}
                strokeWidth={isPendingSource ? 2 : 1}
              />
              <rect width={3} height={NODE_H} rx={1.5} fill={accentColor} />
              <text
                x={14}
                y={26}
                fill={tokens.colors.text.primary}
                fontSize={13}
                fontFamily={tokens.fonts.accent}
                fontWeight={600}
                pointerEvents="none"
              >
                {n.name}
              </text>
              <text
                x={14}
                y={48}
                fill={runColors ? runColors.accent : tokens.colors.text.muted}
                fontSize={11}
                fontFamily={tokens.fonts.accent}
                fontWeight={runStatus ? 600 : 400}
                pointerEvents="none"
              >
                {subline}
              </text>
              {runStatus && (
                /* Eye icon: opens the run inspector for this node. Only shown
                   when a run is loaded (otherwise there's nothing to inspect).
                   Single-click is reserved as no-op so dragging stays clean. */
                <g
                  transform={`translate(${NODE_W - 30}, 8)`}
                  style={{ cursor: 'pointer' }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleEyeClick(e, n)}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <title>View this node's run output</title>
                  <rect
                    width={22}
                    height={22}
                    rx={4}
                    fill={tokens.colors.bg.tertiary}
                    stroke={tokens.colors.border.subtle}
                  />
                  {/* Simple eye glyph: outer almond + pupil */}
                  <path
                    d="M 5 11 Q 11 5 17 11 Q 11 17 5 11 Z"
                    fill="none"
                    stroke={tokens.colors.text.primary}
                    strokeWidth={1.4}
                  />
                  <circle cx={11} cy={11} r={2} fill={tokens.colors.text.primary} />
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </CanvasFrame>
  );
}
