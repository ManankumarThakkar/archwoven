'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Position, type Node, type Edge, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { SystemModel, NodeKind } from '@archwoven/model';
import { layoutModel } from '../../lib/layout';
import { journey, reachability } from './graph-inspect';
import { motionMode } from './motion';
import { lensKindsInView, lensPasses, parseLens, serializeLens, toggleLens } from './lens';
import { pulseOrder } from './pulses';
import { NodeFinder } from './NodeFinder';
import { OutlineRail } from './OutlineRail';
import { SequenceCanvas } from './SequenceCanvas';
import { PROVENANCE_STYLE } from '../../lib/provenance';
import { EntityNode } from './EntityNode';
import { erMarkers, erLabel, ER_MARKER_DEFS } from '../../lib/entity';

const MOTION_KEY = 'archwoven-motion';

function BoundaryNode({ data }: { data: { label: string } }) {
  return (
    <div style={{ width: '100%', height: '100%', border: '1.5px dashed #64748b', borderRadius: 14, pointerEvents: 'none' }}>
      <span style={{ position: 'absolute', top: -9, left: 12, fontSize: 10, background: '#070b14', color: '#94a3b8', padding: '0 6px', borderRadius: 4 }}>{data.label}</span>
    </div>
  );
}
const nodeTypes = { boundary: BoundaryNode, entity: EntityNode };

const readHash = (): Record<string, string> =>
  Object.fromEntries(new URLSearchParams((typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '')));
const writeHash = (patch: Record<string, string | null>) => {
  if (typeof window === 'undefined') return;
  const h = readHash();
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete h[k]; else h[k] = v; }
  // keep #lens=service,queue readable (URLSearchParams would %2C the commas)
  const s = new URLSearchParams(h).toString().replace(/(^|&)lens=([^&]*)/, (_, prefix: string, value: string) => `${prefix}lens=${value.replace(/%2C/g, ',')}`);
  history.replaceState(null, '', s ? `#${s}` : window.location.pathname + window.location.search);
};

type CanvasProps = { model: SystemModel; modelId: string; viewId: string; onSelect: (id: string) => void; onDeselect: () => void };

export function Canvas(props: CanvasProps) {
  return props.model.views.find(v => v.id === props.viewId)?.type === 'sequence'
    ? <SequenceCanvas key={`${props.modelId}:${props.viewId}`} {...props} />
    : <GraphCanvas {...props} />;
}

function GraphCanvas({ model, modelId, viewId, onSelect, onDeselect }: CanvasProps) {
  const [shareBusy, setShareBusy] = useState(false);
  const [shareErr, setShareErr] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ key: string; nodes: Node[]; edges: Edge[] }>({ key: '', nodes: [], edges: [] });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [relationId, setRelationId] = useState<string | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  const [lens, setLens] = useState<NodeKind[]>([]);
  const [probe, setProbe] = useState<{ from: string; to: string; path: string[]; step: number } | null>(null);
  const [probeNoRoute, setProbeNoRoute] = useState(false);
  const [chapterIdx, setChapterIdx] = useState<number>(-1);
  const [probeFrom, setProbeFrom] = useState('');
  const [probeTo, setProbeTo] = useState('');
  const [motion, setMotion] = useState<'still' | 'motion'>('motion');
  const rfRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousViewRef = useRef(viewId);
  const fittedCameraRef = useRef<string | null>(null);
  const layoutKey = JSON.stringify([modelId, model.revision, viewId]);

  useEffect(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(MOTION_KEY) : null;
    const osReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setMotion(motionMode(stored, osReduced ?? false));
  }, []);

  // `/` opens the node finder — never while typing in another input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      setFinderOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const view = model.views.find((v) => v.id === viewId);

  useEffect(() => {
    let alive = true;
    layoutModel(model, viewId).then((r) => {
      if (!alive) return;
      const nodes: Node[] = r.nodes.map((n) => {
        const node = model.nodes.find((m) => m.id === n.id)!;
        const s = PROVENANCE_STYLE[node.provenance];
        const entity = view?.type === 'er' && node.kind === 'entity';
        const sourcePosition = view?.orientation === 'LR' ? Position.Right : Position.Bottom;
        const targetPosition = view?.orientation === 'LR' ? Position.Left : Position.Top;
        return {
          id: n.id,
          position: { x: n.x, y: n.y },
          type: entity ? 'entity' : undefined,
          sourcePosition, targetPosition,
          data: entity ? { entity: node, sourcePosition, targetPosition } : { label: `${s.badge} · ${node.label}` },
          style: entity
            ? { width: n.width, height: n.height, borderRadius: 10, background: '#0f172a' }
            : { width: n.width, height: n.height, border: `2px solid ${s.border}`, background: s.bg, color: '#e5e7eb', borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 13 },
        };
      });
      const edges: Edge[] = (view?.edges ?? []).flatMap((id) => {
        const e = model.edges.find((m) => m.id === id);
        if (!e) return [];
        const markers = view?.type === 'er' ? erMarkers(e) : {};
        return [{ id, source: e.from, target: e.to, label: view?.type === 'er' ? erLabel(e) : e.label ?? '', markerStart: markers.start, markerEnd: markers.end, ariaLabel: view?.type === 'er' ? `${e.from} to ${e.to}: ${erLabel(e)}` : undefined, animated: e.type === 'async' && motion === 'motion', style: { stroke: PROVENANCE_STYLE[e.provenance].border } }];
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
      setPlaced({ key: layoutKey, nodes: [...hulls, ...nodes], edges });
    });
    return () => { alive = false; };
  }, [model, viewId, motion, layoutKey]);

  // permalinks: read once on mount, write on every interaction
  useEffect(() => {
    const h = readHash();
    const focusedNode = model.nodes.find((n) => n.id === h.focus && view?.nodes.includes(n.id));
    const restoredLens = parseLens(h.lens);
    const clearLens = focusedNode !== undefined && !lensPasses(focusedNode.kind, restoredLens);
    if (focusedNode) { setFocusId(focusedNode.id); onSelect(focusedNode.id); }
    else if (h.focus) { setFocusId(null); writeHash({ focus: null }); onDeselect(); }
    if (h.route) {
      const [a, b] = h.route!.split('~');
      if (a && b) { setProbeFrom(a); setProbeTo(b); }
    }
    if (h.chapter) {
      const i = model.guidedViews.findIndex((g) => g.id === h.chapter);
      if (i >= 0) setChapterIdx(i);
    }
    setLens(clearLens ? [] : restoredLens);
    if (clearLens) writeHash({ lens: null });
    if (h.relation && view?.edges.includes(h.relation) && model.edges.some((e) => e.id === h.relation)) { setRelationId(h.relation!); onSelect(h.relation!); }
    else if (h.relation) { setRelationId(null); writeHash({ relation: null }); onDeselect(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelIdKey(model)]);

  const reach = useMemo(() => (focusId ? reachability(model, focusId) : null), [model, focusId]);
  const kindOf = useMemo(() => new Map(model.nodes.map((n) => [n.id, n.kind])), [model]);
  const viewEdges = useMemo(() => (view?.edges ?? []).flatMap((id) => { const e = model.edges.find((m) => m.id === id); return e ? [e] : []; }), [model, view]);
  // flow tokens only when the motion governor allows it (§6) — never bypass
  const pulseDelays = useMemo(() => (motion === 'motion' ? new Map(pulseOrder(viewEdges).map((id, i) => [id, -(i * 0.45)])) : new Map<string, number>()), [motion, viewEdges]);
  const viewKinds = useMemo(() => lensKindsInView(model, view?.nodes ?? []), [model, view]);

  const focusNode = (id: string) => {
    const kind = kindOf.get(id);
    const clearLens = kind !== undefined && !lensPasses(kind, lens);
    if (clearLens) setLens([]);
    stopTimer();
    setProbe(null);
    setProbeNoRoute(false);
    onSelect(id);
    setFocusId(id);
    setRelationId(null);
    writeHash({ focus: id, relation: null, route: null, ...(clearLens ? { lens: null } : {}) });
  };
  const setLensKinds = (k: NodeKind[]) => { setLens(k); writeHash({ lens: serializeLens(k) }); };
  const chapter = chapterIdx >= 0 ? model.guidedViews[chapterIdx] ?? null : null;

  // Fit after the replacement layout reaches React Flow, never against the old
  // view's nodes. React Flow queues fitView until node measurement completes.
  const fitCamera = useCallback(() => {
    if (!rfRef.current || placed.key !== layoutKey || !placed.nodes.length) return;
    const cameraKey = JSON.stringify([placed.key, chapter?.id ?? null]);
    if (fittedCameraRef.current === cameraKey) return;
    const ids = chapter?.focus.filter((id) => placed.nodes.some((node) => node.id === id)) ?? [];
    fittedCameraRef.current = cameraKey;
    void rfRef.current.fitView({
      duration: motion === 'still' ? 0 : 600,
      ...(ids.length ? { nodes: ids.map((id) => ({ id })), padding: 0.25 } : {}),
    });
  }, [placed, layoutKey, chapter, motion]);
  useEffect(() => { fitCamera(); }, [fitCamera]);

  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

  // An explicit view change keeps only interaction channels the new view can show.
  // Mount is deliberately excluded so a complete permalink can restore first.
  useEffect(() => {
    if (previousViewRef.current === viewId) return;
    previousViewRef.current = viewId;
    const nodeIds = new Set(view?.nodes ?? []);
    const edgeIds = new Set(view?.edges ?? []);
    const patch: Record<string, string | null> = {};
    const clearFocus = focusId !== null && !nodeIds.has(focusId);
    const clearRelation = relationId !== null && !edgeIds.has(relationId);
    if (clearFocus) { setFocusId(null); patch.focus = null; }
    if (clearRelation) { setRelationId(null); patch.relation = null; }
    if (relationId ? clearRelation : clearFocus) onDeselect();
    if (probeFrom && !nodeIds.has(probeFrom)) setProbeFrom('');
    if (probeTo && !nodeIds.has(probeTo)) setProbeTo('');
    const nextLens = lens.filter((kind) => viewKinds.includes(kind));
    if (nextLens.length !== lens.length) { setLens(nextLens); patch.lens = serializeLens(nextLens); }
    if (chapter && !chapter.focus.some((id) => nodeIds.has(id))) { setChapterIdx(-1); patch.chapter = null; }
    const savedRoute = readHash().route?.split('~');
    const path = probe?.path ?? (savedRoute?.[0] && savedRoute[1] ? journey(model, savedRoute[0], savedRoute[1]) : null);
    if (path && (!path.every((id) => nodeIds.has(id)) || path.slice(1).some((id, i) =>
      !viewEdges.some((edge) => edge.from === path[i] && edge.to === id)))) {
      stopTimer();
      setProbe(null);
      patch.route = null;
    }
    setProbeNoRoute(false);
    if (Object.keys(patch).length) writeHash(patch);
    // Reconcile only a view transition, using the interaction state at that time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId]);

  const playProbe = (from: string, to: string) => {
    stopTimer();
    const path = journey(model, from, to);
    if (!path || path.length < 2) { setProbe(null); setProbeNoRoute(true); writeHash({ route: null }); return; }
    setProbeNoRoute(false);
    setRelationId(null);
    onDeselect();
    writeHash({ route: `${from}~${to}`, relation: null });
    if (motion === 'still') { setProbe({ from, to, path, step: path.length - 1 }); return; }
    setProbe({ from, to, path, step: 0 });
    timerRef.current = setInterval(() => {
      setProbe((p) => (p && p.step + 1 < p.path.length ? { ...p, step: p.step + 1 } : p));
    }, 1100);
  };

  // playback completion stops the timer (kept out of the state updater — pure)
  useEffect(() => {
    if (probe && probe.step >= probe.path.length - 1) stopTimer();
  }, [probe]);

  // Still toggled MID-playback: stop the interval and jump to the full highlight.
  useEffect(() => {
    if (motion === 'still') { stopTimer(); setProbe((p) => (p ? { ...p, step: p.path.length - 1 } : p)); }
  }, [motion]);

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
    // semantic lens is a filter channel: non-matching kinds dim before any focus decoration
    const kind = kindOf.get(n.id);
    if (lens.length > 0 && kind && !lensPasses(kind, lens)) return { ...n, className: 'aw-dim' };
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
    if (relationId && e.id === relationId) cls = 'aw-edge-focus';
    // A lens dims relationships with a filtered endpoint, just as it dims nodes.
    if (lens.length > 0 && [e.source, e.target].some((id) => {
      const kind = kindOf.get(id);
      return kind !== undefined && !lensPasses(kind, lens);
    })) cls = 'aw-dim-edge';
    // Dimmed edges never animate. Pulses subsume React Flow's async dash so
    // one visible path never carries two dash animations.
    const dimmed = cls === 'aw-dim-edge';
    const pulse = !dimmed && pulseDelays.has(e.id);
    if (pulse) cls = `${cls} aw-pulse`.trim();
    const animated = e.animated === true && motion === 'motion' && !dimmed && !pulse;
    return { ...e, className: cls, animated, style: pulse ? { ...e.style, animationDelay: `${pulseDelays.get(e.id)}s` } : e.style };
  });

  const selectCls = { fontSize: 11, padding: '2px 6px', borderRadius: 6, border: '1px solid #1f2937', background: '#111a2e', color: '#cbd5e1' } as const;
  const btnCls = { fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid #334155', background: '#111a2e', color: '#e5e7eb', cursor: 'pointer' } as const;
  const viewNodes = view?.nodes ?? [];

  return (
    <div className="aw-canvas" style={{ width: '100%', height: '100%', position: 'relative' }}>
      {view?.type === 'er' && <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute' }}><defs dangerouslySetInnerHTML={{ __html: ER_MARKER_DEFS }} /></svg>}
      <div className="aw-canvas-toolbar" style={{ position: 'absolute', top: 36, left: 8, zIndex: 5, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
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
              if (!res.ok) {
                const j = (await res.json().catch(() => null)) as { message?: string } | null;
                setShareErr(j?.message ?? 'share failed — try again');
                return;
              }
              setShareErr(null);
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `archwoven-${probe ? 'route' : 'reach'}.png`; a.click();
              URL.revokeObjectURL(url);
            } finally { setShareBusy(false); }
          }}>⤓ share</button>
        )}
        {shareErr && <span style={{ fontSize: 11, color: '#fbbf24' }}>{shareErr}</span>}
        <div className="aw-canvas-tools" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={btnCls} aria-pressed={motion === 'still'} onClick={() => { const m = motion === 'still' ? 'motion' : 'still'; setMotion(m); localStorage.setItem(MOTION_KEY, m); }}>
            {motion === 'still' ? '◼ still' : '◉ motion'}
          </button>
          {viewKinds.length > 0 && (
            <>
              <span style={{ fontSize: 11, color: '#8b98b8' }}>lens</span>
              {viewKinds.map((k) => (
                <button key={k} aria-pressed={lens.includes(k)} onClick={() => setLensKinds(toggleLens(lens, k))}
                  style={{ ...btnCls, borderColor: lens.includes(k) ? '#5eead4' : '#334155', background: lens.includes(k) ? '#0f2e2b' : '#111a2e', color: lens.includes(k) ? '#5eead4' : '#e5e7eb' }}>{k}</button>
              ))}
            </>
          )}
          <button type="button" style={btnCls} onClick={() => setFinderOpen(true)}>Find node /</button>
          {view?.type === 'er' && <span style={{ fontSize: 11, color: '#a6b4cf' }}>PK primary · FK foreign · UK unique · 1 one · N/M many</span>}
        </div>
      </div>
      {chapter?.note && (
        <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 5, maxWidth: 420, fontSize: 11, color: '#cbd5e1', background: '#111a2ecc', border: '1px solid #c4b5fd44', borderRadius: 8, padding: '6px 10px' }}>
          <strong style={{ color: '#c4b5fd' }}>{chapter.label}</strong> — {chapter.note}
        </div>
      )}
      <div className="aw-flow-area"><ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        colorMode="dark"
        onInit={(inst) => { rfRef.current = inst as ReactFlowInstance<Node, Edge>; fitCamera(); }}
        onNodeClick={(_, n) => { if (n.type === 'boundary') return; focusNode(n.id); }}
        onPaneClick={() => { setFocusId(null); setRelationId(null); writeHash({ focus: null, relation: null }); onDeselect(); }}
        onEdgeClick={(_, e) => { setRelationId(e.id); onSelect(e.id); writeHash({ relation: e.id }); }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} color="#1a2333" />
        <Controls />
        {viewNodes.length > 12 && <MiniMap pannable zoomable />}
      </ReactFlow></div>
      <OutlineRail model={model} viewNodes={viewNodes} activeId={focusId} onFocusNode={focusNode} />
      {finderOpen && <NodeFinder model={model} viewNodes={viewNodes} onPick={focusNode} onClose={() => setFinderOpen(false)} />}
    </div>
  );
}

function modelIdKey(model: SystemModel): string {
  return `${model.title}:${model.revision}:${model.views.map((v) => v.id).join(',')}`;
}
