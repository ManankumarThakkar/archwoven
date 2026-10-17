'use client';
import { Handle, type Position } from '@xyflow/react';
import type { SystemModel } from '@archwoven/model';
import { systemNodeLayout } from '../../lib/graph-geometry';
import { PROVENANCE_STYLE } from '../../lib/provenance';

/** `inside`: the parent's label when this node is one of its inferred internals; `hasDetail`: this node has internals. */
export function SystemNode({ data }: { data: { node: SystemModel['nodes'][number]; sourcePosition: Position; targetPosition: Position; inside?: string; hasDetail?: boolean } }) {
  const { node, inside, hasDetail } = data, box = systemNodeLayout(node), style = PROVENANCE_STYLE[node.provenance];
  const name = inside ? `${node.label}, inside ${inside}` : hasDetail ? `${node.label}, has inferred internals` : node.label;
  return <div title={inside ? `${node.label} — inside ${inside} (inferred)` : node.label} style={{ width: box.width, height: box.height, padding: '10px 14px', borderRadius: 10, outline: `2px ${inside ? 'dashed' : 'solid'} ${style.border}`, outlineOffset: -2, background: style.bg, textAlign: 'center', boxSizing: 'border-box', color: '#e5e7eb' }}>
    <Handle type="target" position={data.targetPosition} />
    <div aria-label={name} style={{ fontSize: 13, lineHeight: '18px' }}>{box.lines.map((line, i) => <span key={i} style={{ display: 'block' }}>{line}</span>)}</div>
    <small style={{ display: 'block', color: style.border, fontSize: 10, lineHeight: '16px' }}>{style.badge}{hasDetail ? ' · detail' : ''}</small>
    <Handle type="source" position={data.sourcePosition} />
  </div>;
}
