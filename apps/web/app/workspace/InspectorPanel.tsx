'use client';

import { MAX_DETAIL_VIEWS } from '@archwoven/model';
import type { InspectorPayload } from './inspector';
import type { Passport } from './passport';
import { RenameForm } from './RenameForm';
import { PROVENANCE_STYLE } from '../../lib/provenance';

export function Inspector({ payload, gaps, passport, busy=false, onRename, detail }: { payload: InspectorPayload | null; gaps?: string[]; passport?: Passport | null; busy?:boolean; onRename?:(id:string,label:string)=>void; detail?: { onOpen: () => void; limitReached: boolean } | null }) {
  if (!payload) {
    if (gaps && gaps.length > 0) {
      return (
        <aside style={{ padding: 16, width: 300, borderLeft: '1px solid #1f2937', color: '#e5e7eb' }}>
          <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 6 }}>Gaps ({gaps.length}) — what this diagram could not prove</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#fbbf24' }}>
            {gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
          <div style={{ marginTop: 10, fontSize: 12, color: '#8b98b8' }}>Select a node or edge to inspect its provenance.</div>
        </aside>
      );
    }
    return <div style={{ padding: 16, color: '#8b98b8' }}>Select a node or edge to inspect its provenance.</div>;
  }
  return (
    <aside style={{ padding: 16, width: 300, borderLeft: '1px solid #1f2937', display: 'flex', flexDirection: 'column', gap: 10, color: '#e5e7eb' }}>
      {/* Badge below the title, so names get the full panel width and break only between words. */}
      <div className="aw-inspector-heading" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        <strong style={{ fontSize: '1.05rem', overflowWrap: 'break-word', maxWidth: '100%' }}>{payload.label}</strong>
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#5eead4', textTransform: 'uppercase' }}>{PROVENANCE_STYLE[payload.provenance].badge}</span>
      </div>
      {payload.kind === 'edge' && payload.endpoints && (
        <div style={{ fontSize: 13, color: '#93c5fd' }}>{payload.endpoints.from} → {payload.endpoints.to} · {payload.type}</div>
      )}
      {payload.kind === 'edge' && passport && (
        <div style={{ border: '1px solid #5eead444', background: '#0f2e2b66', borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: '#5eead4', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Relationship passport</div>
          <div style={{ fontSize: 13, color: '#e5e7eb' }}>{passport.fromLabel} → {passport.toLabel}</div>
          <div style={{ fontSize: 12, color: '#93c5fd' }}>{passport.edgeLabel} · {passport.edgeKind}</div>
          <div style={{ fontSize: 11, color: '#8b98b8' }}>{passport.provenance} · {passport.evidenceCount} evidence {passport.evidenceCount === 1 ? 'item' : 'items'}</div>
        </div>
      )}
      {payload.role && <p style={{ fontSize: 13, color: '#8b98b8' }}>{payload.role}</p>}
      {detail && <div>
        <button onClick={detail.onOpen} disabled={busy || detail.limitReached} style={{ minHeight: 44, padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>Open detail</button>
        {detail.limitReached && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#94a3b8' }}>Close a detail view to open another (limit {MAX_DETAIL_VIEWS}).</p>}
      </div>}
      {onRename && <RenameForm key={`${payload.id}:${payload.label}`} id={payload.id} label={payload.label} busy={busy} onRename={onRename}/>}
      {payload.fields && <div style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
        <strong>Fields</strong>
        {payload.fields.length ? <ul style={{ paddingLeft: 16 }}>{payload.fields.map((field, i) => <li key={i}><span style={{ color: '#5eead4' }}>{field.key?.toUpperCase() ?? '—'}</span> {field.name} · <span style={{ color: '#a6b4cf' }}>{field.type ?? 'unspecified'}</span></li>)}</ul> : <p>No fields provided</p>}
      </div>}
      {payload.cardinality !== undefined && <div style={{ fontSize: 12, color: '#a6b4cf' }}>Cardinality: {payload.cardinality ?? 'unspecified'}</div>}

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
