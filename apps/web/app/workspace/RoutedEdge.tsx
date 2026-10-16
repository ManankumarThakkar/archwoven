'use client';
import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import type { RoutedEdge as Route } from '../../lib/layout';
import { routePath } from '../../lib/graph-geometry';

type Routed = Edge<{ route: Route }, 'routed'>;
export function RoutedEdge({ id, data, markerStart, markerEnd, style }: Pick<EdgeProps<Routed>, 'id' | 'data' | 'markerStart' | 'markerEnd' | 'style'>) {
  const route = data?.route;
  if (!route) return null;
  const label = route.label;
  return <>
    <BaseEdge id={id} path={routePath(route.points)} markerStart={markerStart} markerEnd={markerEnd} style={style} />
    <path className="aw-flow-token" aria-hidden="true" d={routePath(route.points)} fill="none" stroke={style?.stroke} strokeWidth={3} style={{ animationDelay: style?.animationDelay }} />
    {label && <g data-edge-label={id} style={{ pointerEvents: 'all' }}>
      <title>{label.lines.join(' ')}</title>
      <rect x={label.x} y={label.y} width={label.width} height={label.height} rx={5} fill="#0c1523" stroke="#26364c" />
      <text x={label.x + 8} y={label.y + 17} fontSize={11} fill="#cbd5e1">{label.lines.map((line, i) => <tspan key={i} x={label.x + 8} dy={i ? 16 : 0}>{line}</tspan>)}</text>
    </g>}
  </>;
}
