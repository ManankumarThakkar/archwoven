'use client';

import type { InspectorPayload } from './inspector';

export function Inspector({ payload }: { payload: InspectorPayload | null }) {
  if (!payload) return <div style={{ padding: 16, color: '#8b98b8' }}>Select a node or edge to inspect its provenance.</div>;
  return (
    <aside style={{ padding: 16, width: 300, borderLeft: '1px solid #1f2937', display: 'flex', flexDirection: 'column', gap: 10, color: '#e5e7eb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: '1.05rem' }}>{payload.label}</strong>
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#5eead4', textTransform: 'uppercase' }}>{payload.provenance}</span>
      </div>
      {payload.kind === 'edge' && payload.endpoints && (
        <div style={{ fontSize: 13, color: '#93c5fd' }}>{payload.endpoints.from} → {payload.endpoints.to} · {payload.type}</div>
      )}
      {payload.role && <p style={{ fontSize: 13, color: '#8b98b8' }}>{payload.role}</p>}

      <div>
        <div style={{ fontSize: 12, color: '#8b98b8', marginBottom: 4 }}>Evidence</div>
        {payload.evidence.length === 0
          ? <div style={{ fontSize: 12, color: '#64748b' }}>No source evidence — {payload.provenance}.</div>
          : <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
              {payload.evidence.map((e, i) => (
                <li key={i}>{e.href ? <a href={e.href} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{e.label}</a> : e.label}</li>
              ))}
            </ul>}
      </div>

      {payload.gaps.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 4 }}>Open questions</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#fbbf24' }}>
            {payload.gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
      )}
    </aside>
  );
}
