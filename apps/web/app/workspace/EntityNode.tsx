'use client';

import { Handle, type Position } from '@xyflow/react';
import type { SystemModel } from '@archwoven/model';
import { entityLayout } from '../../lib/entity';
import { PROVENANCE_STYLE } from '../../lib/provenance';

export function EntityNode({ data }: { data: { entity: SystemModel['nodes'][number]; sourcePosition: Position; targetPosition: Position } }) {
  const { entity } = data, box = entityLayout(entity), color = PROVENANCE_STYLE[entity.provenance];
  return <div className="aw-entity-node" style={{ width: box.width, height: box.height, color: '#e5e7eb', borderRadius: 10, outline: `2px solid ${color.border}`, outlineOffset: -2 }}>
    <Handle type="target" position={data.targetPosition} />
    <div style={{ height: box.headerHeight, padding: '10px 14px 8px', borderBottom: `1px solid ${color.border}`, boxSizing: 'border-box', textAlign: 'center' }}>
      <strong style={{ display: 'block', fontSize: 13, lineHeight: '18px', fontWeight: 600 }}>{box.label.map((line, i) => <span key={i} style={{ display: 'block' }}>{line}</span>)}</strong>
      <small style={{ color: color.border, fontSize: 11, lineHeight: '18px' }}>{color.badge}</small>
    </div>
    <div role="table" aria-label={`${entity.label} fields`} style={{ fontSize: 12, lineHeight: '18px', textAlign: 'left' }}>
      <div role="row" className="aw-entity-row" style={{ height: 24, color: '#94a3b8', fontSize: 10 }}>
        <span role="columnheader">Key</span><span role="columnheader">Field</span><span role="columnheader">Type</span>
      </div>
      {box.rows.map((row, i) => <div role="row" className="aw-entity-row" key={i} style={{ height: row.height, borderBottom: '1px solid #243249', paddingTop: 6, paddingBottom: 6 }}>
        <span role="cell" style={{ color: row.field.key ? color.border : '#64748b', fontSize: 11, fontWeight: 600 }}>{row.field.key?.toUpperCase() ?? '—'}</span>
        <span role="cell" aria-label={row.field.name} title={row.field.name}>{row.name.map((line, j) => <span key={j} style={{ display: 'block' }}>{line}</span>)}</span>
        <span role="cell" aria-label={row.field.type ?? 'unspecified'} title={row.field.type ?? 'unspecified'} style={{ color: '#a6b4cf' }}>{row.type.map((line, j) => <span key={j} style={{ display: 'block' }}>{line}</span>)}</span>
      </div>)}
      {!box.rows.length && <div style={{ padding: '8px 14px', color: '#94a3b8' }}>No fields provided</div>}
    </div>
    <Handle type="source" position={data.sourcePosition} />
  </div>;
}
