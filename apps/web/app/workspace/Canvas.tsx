'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { SystemModel, Provenance } from '@archwoven/model';
import { layoutModel } from '../../lib/layout';
import { journey, reachability } from './graph-inspect';
import { motionMode } from './motion';

// proposed/inferred are visually distinct from user-specified/source-supported (scenario 6).
const PROVENANCE_STYLE: Record<Provenance, { border: string; bg: string; badge: string }> = {
  'user-specified': { border: '#5eead4', bg: '#0f2e2b', badge: 'you' },
  'source-supported': { border: '#93c5fd', bg: '#10233f', badge: 'code' },
  inferred: { border: '#fbbf24', bg: '#3a2e10', badge: 'inferred' },
  proposed: { border: '#c4b5fd', bg: '#2a2440', badge: 'proposed' },
};

const MOTION_KEY = 'archwoven-motion';

function BoundaryNode({ data }: { data: { label: string } }) {
  return (
    <div style={{ width: '100%', height: '100%', border: '1.5px dashed #64748b', borderRadius: 14, pointerEvents: 'none' }}>
      <span style={{ position: 'absolute', top: -9, left: 12, fontSize: 10, background: '#070b14', color: '#94a3b8', padding: '0 6px', borderRadius: 4 }}>{data.label}</span>
    </div>
  );
}
const nodeTypes = { boundary: BoundaryNode };

const readHash = (): Record<string, string> =>
  Object.fromEntries(new URLSearchParams((typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '')));
const writeHash = (patch: Record<string, string | null>) => {
  if (typeof window === 'undefined') return;
  const h = readHash();
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete h[k]; else h[k] = v; }
  const s = new URLSearchParams(h).toString();
  history.replaceState(null, '', s ? `#${s}` : window.location.pathname + window.location.search);
};

export function Canvas({ model, modelId, viewId, onSelect }: { model: SystemModel; modelId: string; viewId: string; onSelect: (id: string) => void }) {
  const [shareBusy, setShareBusy] = useState(false);
  const [placed, setPlaced] = useState<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ from: string; to: string; path: string[]; step: number } | null>(null);
  const [probeNoRoute, setProbeNoRoute] = useState(false);
  const [chapterIdx, setChapterIdx] = useState<number>(-1);
  const [probeFrom, setProbeFrom] = useState('');
  const [probeTo, setProbeTo] = useState('');
  const [motion, setMotion] = useState<'still' | 'motion'>('motion');
  const rfRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(MOTION_KEY) : null;
    const osReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setMotion(motionMode(stored, osReduced ?? false));
  }, []);

  const view = model.views.find((v) => v.id === viewId);

  useEffect(() => {
    let alive = true;
    layoutModel(model, viewId).then((r) => {
      if (!alive) return;
      const nodes: Node[] = r.nodes.map((n) => {
        const node = model.nodes.find((m) => m.id === n.id)!;
        const s = PROVENANCE_STYLE[node.provenance];
        return {
          id: n.id,
          position: { x: n.x, y: n.y },
          data: { label: `${s.badge} · ${node.label}` },
          style: { width: n.width, height: n.height, border: `2px solid ${s.border}`, background: s.bg, color: '#e5e7eb', borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 13 },
        };
      });
      const edges: Edge[] = (view?.edges ?? []).flatMap((id) => {
        const e = model.edges.find((m) => m.id === id);
        if (!e) return [];
        return [{ id, source: e.from, target: e.to, label: e.label ?? '', animated: e.type === 'async' && motion === 'motion', style: { stroke: PROVENANCE_STYLE[e.provenance].border } }];
      });
      // boundary hulls over the members actually placed in this view (partial views hull what's there)
      const byId = new Map(r.nodes.map((n) => [n.id, n]));
      const hulls: Node[] = model.boundaries.flatMap((b) => {
        const members = b.wraps.map((id) => byId.get(id)).filter(Boolean);
        if (members.length === 0) return [];
        const xs = members.map((m) => m!.x), ys = members.map((m) => m!.y);
        const x2 = members.map((m) => m!.x + m!.width), y2 = members.map((m) => m!.y + m!.height);
        const min = { x: Math.min(...xs) - 24, y: Math.min(...ys) - 32 };
        const w = Math.max(...x2) - Math.min(...xs) + 48, h = Math.max(...y2) - Math.min(...ys) + 56;
        if (!Number.isFinite(min.x) || !Number.isFinite(w) || w <= 0 || h <= 0) return [];
        return [{ id: `bnd:${b.id}`, type: 'boundary', position: min, data: { label: b.label }, style: { width: w, height: h }, draggable: false, selectable: false, zIndex: -1 }];
      });
      setPlaced({ nodes: [...hulls, ...nodes], edges });
    });
    return () => { alive = false; };
  }, [model, viewId, motion]);

  // permalinks: read once on mount, write on every interaction
  useEffect(() => {
    const h = readHash();
    if (h.focus && model.nodes.some((n) => n.id === h.focus)) setFocusId(h.focus!);
    if (h.route) {
      const [a, b] = h.route!.split('~');
      if (a && b) { setProbeFrom(a); setProbeTo(b); }
    }
    if (h.chapter) {
      const i = model.guidedViews.findIndex((g) => g.id === h.chapter);
      if (i >= 0) setChapterIdx(i);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelIdKey(model)]);

  const reach = useMemo(() => (focusId ? reachability(model, focusId) : null), [model, focusId]);
  const chapter = chapterIdx >= 0 ? model.guidedViews[chapterIdx] ?? null : null;

  // chapter camera: fit the focus subset (instant in Still mode)
  useEffect(() => {
    if (!chapter || !rfRef.current) return;
    const ids = chapter.focus.filter((id) => view?.nodes.includes(id));
    if (ids.length) rfRef.current.fitView({ nodes: ids.map((id) => ({ id })), duration: motion === 'still' ? 0 : 600, padding: 0.25 });
  }, [chapter, motion, view]);

  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

  const playProbe = (from: string, to: string) => {
    stopTimer();
    const path = journey(model, from, to);
    if (!path || path.length < 2) { setProbe(null); setProbeNoRoute(true); writeHash({ route: null }); return; }
    setProbeNoRoute(false);
    if (motion === 'still') { setProbe({ from, to, path, step: path.length - 1 }); writeHash({ route: `${from}~${to}` }); return; }
    setProbe({ from, to, path, step: 0 });
    writeHash({ route: `${from}~${to}` });
    timerRef.current = setInterval(() => {
      setProbe((p) => {
        if (!p) return p;
        if (p.step + 1 >= p.path.length) { stopTimer(); return p; }
        return { ...p, step: p.step + 1 };
      });
    }, 1100);
  };

  useEffect(() => () => stopTimer(), []);

  // hash-selected route replays when the layout is ready
  useEffect(() => {
    const h = readHash();
    if (h.route && placed.nodes.length) {
      const [a, b] = h.route!.split('~');
      if (a && b && !probe) playProbe(a, b);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, motion]);

  const decorate = (n: Node): Node => {
    if (n.type === 'boundary') return n;
    let cls = '';
    if (probe) {
      const i = probe.path.indexOf(n.id);
      cls = i < 0 ? 'aw-dim' : i < probe.step ? 'aw-route-past' : i === probe.step ? 'aw-route-current' : 'aw-route-future';
    } else if (focusId) {
      if (n.id === focusId) cls = 'aw-route-current';
      else if (reach && (reach.forward.has(n.id) || reach.backward.has(n.id))) cls = 'aw-reach';
      else cls = 'aw-dim';
    } else if (chapter) {
      cls = chapter.focus.includes(n.id) ? 'aw-chapter-focus' : 'aw-dim';
    }
    return cls ? { ...n, className: cls } : n;
  };

  const nodes = placed.nodes.map(decorate);
  const edges = placed.edges.map((e) => {
    let cls = '';
    if (probe) {
      const i = probe.path.indexOf(e.source), j = probe.path.indexOf(e.target);
      cls = i >= 0 && j === i + 1 ? 'aw-edge-focus' : 'aw-dim-edge';
    } else if (focusId) cls = e.source === focusId || e.target === focusId ? 'aw-edge-focus' : 'aw-dim-edge';
    const animated = e.animated === true && motion === 'motion';
    return { ...e, className: cls, animated };
  });

  const selectCls = { fontSize: 11, padding: '2px 6px', borderRadius: 6, border: '1px solid #1f2937', background: '#111a2e', color: '#cbd5e1' } as const;
  const btnCls = { fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid #334155', background: '#111a2e', color: '#e5e7eb', cursor: 'pointer' } as const;
  const viewNodes = view?.nodes ?? [];

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 36, left: 8, zIndex: 5, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select aria-label="route from" value={probeFrom} onChange={(e) => setProbeFrom(e.target.value)} style={selectCls} disabled={!!probe}>
          <option value="">from…</option>{viewNodes.map((id) => <option key={id} value={id}>{model.nodes.find((n) => n.id === id)?.label ?? id}</option>)}
        </select>
        <select aria-label="route to" value={probeTo} onChange={(e) => setProbeTo(e.target.value)} style={selectCls} disabled={!!probe}>
          <option value="">to…</option>{viewNodes.map((id) => <option key={id} value={id}>{model.nodes.find((n) => n.id === id)?.label ?? id}</option>)}
        </select>
        <button style={btnCls} disabled={!probeFrom || !probeTo || !!probe} onClick={() => playProbe(probeFrom, probeTo)}>▶ probe</button>
        {probe && <button style={btnCls} onClick={() => { stopTimer(); setProbe(null); writeHash({ route: null }); }}>clear</button>}
        {probeNoRoute && <span style={{ fontSize: 11, color: '#fbbf24' }}>no route between those</span>}
        {model.guidedViews.length > 0 && (
          <>
            <select aria-label="chapter" value={chapterIdx} onChange={(e) => { const i = Number(e.target.value); setChapterIdx(i); writeHash({ chapter: i >= 0 ? model.guidedViews[i]!.id : null }); }} style={selectCls}>
              <option value={-1}>chapters…</option>{model.guidedViews.map((g, i) => <option key={g.id} value={i}>{g.label}</option>)}
            </select>
            {chapter && <button style={btnCls} onClick={() => { const i = (chapterIdx + 1) % model.guidedViews.length; setChapterIdx(i); writeHash({ chapter: model.guidedViews[i]!.id }); }}>next ▸</button>}
          </>
        )}
        {(probe || focusId) && (
          <button style={btnCls} disabled={shareBusy} onClick={async () => {
            setShareBusy(true);
            try {
              const body = probe
                ? { modelId, kind: 'route', from: probe.from, to: probe.to, viewId }
                : { modelId, kind: 'reach', from: focusId, viewId };
              const res = await fetch('/api/share-card', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
              if (!res.ok) return;
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `archwoven-${probe ? 'route' : 'reach'}.png`; a.click();
              URL.revokeObjectURL(url);
            } finally { setShareBusy(false); }
          }}>⤓ share</button>
        )}
        <button style={btnCls} aria-pressed={motion === 'still'} onClick={() => { const m = motion === 'still' ? 'motion' : 'still'; setMotion(m); localStorage.setItem(MOTION_KEY, m); }}>
          {motion === 'still' ? '◼ still' : '◉ motion'}
        </button>
      </div>
      {chapter?.note && (
        <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 5, maxWidth: 420, fontSize: 11, color: '#cbd5e1', background: '#111a2ecc', border: '1px solid #c4b5fd44', borderRadius: 8, padding: '6px 10px' }}>
          <strong style={{ color: '#c4b5fd' }}>{chapter.label}</strong> — {chapter.note}
        </div>
      )}
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        fitView fitViewOptions={{ duration: motion === 'still' ? 0 : 600 }}
        onInit={(inst) => { rfRef.current = inst as ReactFlowInstance<Node, Edge>; }}
        onNodeClick={(_, n) => { if (n.type === 'boundary') return; onSelect(n.id); setFocusId(n.id); writeHash({ focus: n.id }); }}
        onPaneClick={() => { setFocusId(null); writeHash({ focus: null }); }}
        onEdgeClick={(_, e) => onSelect(e.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} color="#1a2333" />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}

function modelIdKey(model: SystemModel): string {
  return `${model.title}:${model.revision}:${model.views.map((v) => v.id).join(',')}`;
}
