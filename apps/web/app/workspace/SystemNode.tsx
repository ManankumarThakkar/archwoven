'use client';
import { Handle, type Position } from '@xyflow/react';
import type { SystemModel } from '@archwoven/model';
import { systemNodeLayout } from '../../lib/graph-geometry';
import { PROVENANCE_STYLE } from '../../lib/provenance';

export function SystemNode({ data }: { data: { node: SystemModel['nodes'][number]; sourcePosition: Position; targetPosition: Position } }) {
  const { node } = data, box = systemNodeLayout(node), style = PROVENANCE_STYLE[node.provenance];
  return <div title={node.label} style={{ width: box.width, height: box.height, padding: '10px 14px', borderRadius: 10, outline: `2px solid ${style.border}`, outlineOffset: -2, background: style.bg, textAlign: 'center', boxSizing: 'border-box', color: '#e5e7eb' }}>
    <Handle type="target" position={data.targetPosition} />
    <div aria-label={node.label} style={{ fontSize: 13, lineHeight: '18px' }}>{box.lines.map((line, i) => <span key={i} style={{ display: 'block' }}>{line}</span>)}</div>
    <small style={{ display: 'block', color: style.border, fontSize: 10, lineHeight: '16px' }}>{style.badge}</small>
    <Handle type="source" position={data.sourcePosition} />
  </div>;
}
