'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SystemModel } from '@archwoven/model';
import { sequenceDiagram } from '../../lib/sequence';
import { PROVENANCE_STYLE } from '../../lib/provenance';

const focusHash = (id: string | null) => {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  for (const key of ['route', 'relation', 'lens', 'chapter']) hash.delete(key);
  if (id) hash.set('focus', id); else hash.delete('focus');
  const encoded = hash.toString();
  window.history.replaceState(null, '', encoded ? `#${encoded}` : window.location.pathname + window.location.search);
};

export function SequenceCanvas({ model, modelId, viewId, permalinkVersion = 0, onSelect, onDeselect }: {
  model: SystemModel; modelId: string; viewId: string; permalinkVersion?: number; onSelect: (id: string) => void; onDeselect: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(1);
  const [focused, setFocused] = useState<string | null>(null);
  const view = model.views.find(v => v.id === viewId);
  const seq = view?.sequence;
  const rendered = useMemo(() => {
    try { return { diagram: sequenceDiagram(model, viewId), error: null }; }
    catch (e) { return { diagram: null, error: e instanceof Error ? e.message : 'The sequence timeline could not be rendered.' }; }
  }, [model, viewId]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.hash.slice(1)).get('focus');
    const valid = id && seq?.participants.includes(id) && model.nodes.some(n => n.id === id) ? id : null;
    setFocused(valid); focusHash(valid);
    if (valid) onSelect(valid); else onDeselect();
    // Reconcile selection after model/view replacement or external hash navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, viewId, model.revision, permalinkVersion]);

  const select = (id: string) => { setFocused(id); focusHash(id); onSelect(id); };
  if (!rendered.diagram) return <div className="aw-canvas" style={{ padding: 24 }} role="alert">{rendered.error}</div>;
  const { svg, width } = rendered.diagram;
  const labelOf = (id: string) => model.nodes.find(n => n.id === id)?.label ?? id;
  const adjust = (delta: number) => setZoom(current => Math.min(2, Math.max(0.1, (current ?? (viewport.current?.clientWidth || width) / width) + delta)));
  return <div className="aw-canvas aw-sequence" style={{ width: '100%', height: '100%', minHeight: 0 }}>
    <div className="aw-canvas-toolbar" role="group" aria-label="Timeline controls" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" aria-label="Zoom out timeline" disabled={zoom !== null && zoom <= 0.1} onClick={() => adjust(-0.15)}>−</button>
      <output aria-label="Timeline zoom">{zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`}</output>
      <button type="button" aria-label="Zoom in timeline" disabled={zoom !== null && zoom >= 2} onClick={() => adjust(0.15)}>+</button>
      <button type="button" onClick={() => setZoom(null)}>Fit</button>
      <button type="button" onClick={() => setZoom(1)}>100%</button>
      <span style={{ fontSize: 12, color: '#a6b4cf' }}>↓ Time · solid call · dashed return · open async</span>
    </div>
    <div className="aw-sequence-participants" role="group" aria-label="Inspect participants">
      {seq!.participants.map(id => {
        const style = PROVENANCE_STYLE[model.nodes.find(n => n.id === id)!.provenance];
        return <button type="button" key={id} aria-label={`Inspect ${labelOf(id)}`} aria-pressed={focused === id} style={{ borderColor: style.border, background: style.bg }} onClick={() => select(id)}><small style={{ color: style.border }}>{style.badge}</small> · {labelOf(id)}</button>;
      })}
      {focused && <button type="button" onClick={() => { setFocused(null); focusHash(null); onDeselect(); }}>Clear selection</button>}
    </div>
    <div ref={viewport} className="aw-sequence-viewport" role="region" aria-label="Sequence timeline; scroll to explore" tabIndex={0}>
      <div className="aw-sequence-svg" style={{ width: zoom === null ? '100%' : width * zoom }} onClick={e => {
        const participant = (e.target as Element).closest('[data-participant]')?.getAttribute('data-participant');
        if (participant && seq!.participants.includes(participant)) select(participant);
      }} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
    <details className="aw-sequence-transcript">
      <summary>Read message timeline ({seq!.messages.length})</summary>
      <ol>{seq!.messages.map(msg => <li key={msg.seq}>{labelOf(msg.from)} → {labelOf(msg.to)}: {msg.label} <span style={{ color: '#a6b4cf' }}>({msg.kind}{msg.fragment ? `; ${msg.fragment.type}: messages ${msg.fragment.covers.join(', ')}` : ''})</span></li>)}</ol>
      {!seq!.messages.length && <p>No messages recorded in this sequence.</p>}
    </details>
  </div>;
}
