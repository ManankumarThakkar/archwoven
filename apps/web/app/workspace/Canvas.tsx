'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, ControlButton, MiniMap, Position, type Node, type Edge, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { internalsOf, isDetailView, isInternal, type SystemModel, type NodeKind } from '@archwoven/model';
import { layoutModel, type LayoutResult } from '../../lib/layout';
import type { Point } from '../../lib/direct-edit';
import { useGraphEditing, type GraphPlacement } from './useGraphEditing';
import { journey, reachability } from './graph-inspect';
import { motionMode } from './motion';
import { lensKindsInView, lensPasses, parseLens, serializeLens, toggleLens } from './lens';
import { pulseOrder } from './pulses';
import { NodeFinder } from './NodeFinder';
import { OutlineRail } from './OutlineRail';
import { SequenceCanvas } from './SequenceCanvas';
import { PROVENANCE_STYLE } from '../../lib/provenance';
import { EntityNode } from './EntityNode';
import { SystemNode } from './SystemNode';
import { RoutedEdge } from './RoutedEdge';
import { GRAPH_MARKER_DEFS, graphArrow } from '../../lib/graph-svg';
import { graphScene, warningSummary, isGroupDetail } from '../../lib/graph-geometry';
import { planCamera, type Box } from '../../lib/camera';
import { erMarkers, erLabel, ER_MARKER_DEFS } from '../../lib/entity';

const MOTION_KEY = 'archwoven-motion';

function BoundaryNode({ data }: { data: { label: string; lines: string[] } }) {
  return (
    <div style={{ width: '100%', height: '100%', border: '1.5px dashed #64748b', borderRadius: 14, pointerEvents: 'none' }}>
      <span title={data.label} style={{ position: 'absolute', top: 8, left: 12, fontSize: 11, lineHeight: '16px', color: '#94a3b8' }}>{data.lines.map((line, i) => <span key={i} style={{ display: 'block' }}>{line}</span>)}</span>
    </div>
  );
}
const nodeTypes = { boundary: BoundaryNode, entity: EntityNode, system: SystemNode };
const edgeTypes = { routed: RoutedEdge };

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

/** Below this zoom, node labels drop under about 8.5 px and stop being readable. */
const MIN_READABLE_ZOOM = 0.65;
const focusBounds = (nodes: Node[], ids: string[]): Box => {
  const boxes = nodes.filter(node => ids.includes(node.id)).map(node => ({ x: node.position.x, y: node.position.y, width: Number(node.style?.width ?? node.width ?? 0), height: Number(node.style?.height ?? node.height ?? 0) }));
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x: x - 40, y: y - 40, width: Math.max(...boxes.map(b => b.x + b.width)) - x + 80, height: Math.max(...boxes.map(b => b.y + b.height)) - y + 80 };
};

type CanvasProps = { model: SystemModel; modelId: string; viewId: string; permalinkVersion?: number; onSelect: (id: string) => void; onDeselect: () => void; busy?:boolean; onMove?:(positions:Record<string,Point>)=>Promise<boolean> };

export function Canvas(props: CanvasProps) {
  return props.model.views.find(v => v.id === props.viewId)?.type === 'sequence'
    ? <SequenceCanvas key={`${props.modelId}:${props.viewId}`} {...props} />
    : <GraphCanvas {...props} />;
}

function GraphCanvas({ model, modelId, viewId, permalinkVersion = 0, onSelect, onDeselect, busy=false, onMove }: CanvasProps) {
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareErr, setShareErr] = useState<string | null>(null);
  const [placed, setPlaced] = useState<GraphPlacement>({ key: '', nodes: [], edges: [], bounds: { x: 0, y: 0, width: 0, height: 0 } });
  const currentLayout=useRef<LayoutResult|null>(null);
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
  const pendingRouteRef = useRef<{ from: string; to: string } | null>(null);
  const previousViewRef = useRef(viewId);
  const fittedCameraRef = useRef<string | null>(null);
  const preserveCameraRef=useRef<string|null>(null);
  const userCameraRef = useRef(false);
  const flowAreaRef = useRef<HTMLDivElement>(null);
  /** True while an automatic fit shows only the start of a diagram too large to read whole. */
  const [partialView, setPartialView] = useState(false);
  const layoutKey = JSON.stringify([modelId, model.revision, viewId]);
  const editing=useGraphEditing({model,viewId,placed,setPlaced,layout:currentLayout,busy,onMove:onMove?async positions=>{
    const nextKey=JSON.stringify([modelId,model.revision+1,viewId]);preserveCameraRef.current=nextKey;
    try{const accepted=await onMove(positions);if(!accepted&&preserveCameraRef.current===nextKey)preserveCameraRef.current=null;return accepted;}
    catch(error){if(preserveCameraRef.current===nextKey)preserveCameraRef.current=null;throw error;}
  }:undefined});

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
    setLayoutError(null);
    layoutModel(model, viewId).then((r) => {
      if (!alive) return;
      currentLayout.current=r;
      const nodes: Node[] = r.nodes.map((n) => {
        const node = model.nodes.find((m) => m.id === n.id)!;
        const s = PROVENANCE_STYLE[node.provenance];
        const entity = node.kind === 'entity';
        const sourcePosition = view?.orientation === 'LR' ? Position.Right : Position.Bottom;
        const targetPosition = view?.orientation === 'LR' ? Position.Left : Position.Top;
        return {
          id: n.id,
          position: { x: n.x, y: n.y },
          type: entity ? 'entity' : 'system',
          sourcePosition, targetPosition,
          data: entity ? { entity: node, sourcePosition, targetPosition } : { node, sourcePosition, targetPosition, inside: isInternal(model, node.id) ? model.nodes.find((m) => m.id === node.group)?.label : undefined, hasDetail: internalsOf(model, node.id).length > 0 },
          style: entity
            ? { width: n.width, height: n.height, borderRadius: 10, background: '#0f172a' }
            : { width: n.width, height: n.height, borderRadius: 10, background: s.bg },
        };
      });
      const edges: Edge[] = (view?.edges ?? []).flatMap((id) => {
        const e = model.edges.find((m) => m.id === id);
        if (!e) return [];
        const markers = view?.type === 'er' ? erMarkers(e) : { end: graphArrow(e) };
        const route = r.edges.find(route => route.id === id);
        return [{ id, source: e.from, target: e.to, type: route ? 'routed' : undefined, data: route ? { route } : undefined, label: view?.type === 'er' ? erLabel(e) : e.label ?? '', markerStart: markers.start, markerEnd: markers.end, ariaLabel: view?.type === 'er' ? `${e.from} to ${e.to}: ${erLabel(e)}` : undefined, animated: e.type === 'async' && motion === 'motion', style: { stroke: PROVENANCE_STYLE[e.provenance].border, strokeDasharray: e.type === 'async' ? '6 4' : undefined } }];
      });
      const { boundaries, bounds, warnings, omittedGroups } = graphScene(model, r);
      const hulls: Node[] = boundaries.map(b => ({ id: `bnd:${b.id}`, type: 'boundary', position: { x: b.x, y: b.y }, data: { label: b.label, lines: b.lines }, style: { width: b.width, height: b.height }, draggable: false, selectable: false, zIndex: -1 }));
      setPlaced({ key: layoutKey, nodes: [...hulls, ...nodes], edges, bounds, warnings, omittedGroups });
    }).catch(() => { if (alive) setLayoutError('This view could not be laid out. Try another view or refine the diagram.'); });
    return () => { alive = false; };
  }, [model, viewId, motion, layoutKey]);

  // Restore on model replacement and external hash navigation. UI interactions
  // write with replaceState and keep their existing playback/camera state.
  useEffect(() => {
    const h = readHash();
    previousViewRef.current = viewId;
    stopTimer();
    setProbe(null);
    setProbeNoRoute(false);
    const focusedNode = model.nodes.find((n) => n.id === h.focus && view?.nodes.includes(n.id));
    const availableKinds = lensKindsInView(model, view?.nodes ?? []);
    const restoredLens = parseLens(h.lens).filter(kind => availableKinds.includes(kind));
    const nextLens = focusedNode && !lensPasses(focusedNode.kind, restoredLens) ? [] : restoredLens;
    const relation = h.relation && view?.edges.includes(h.relation) && model.edges.some(e => e.id === h.relation) ? h.relation : null;
    const chapter = model.guidedViews.findIndex(g => g.id === h.chapter && g.focus.some(id => view?.nodes.includes(id)));
    const endpoints = h.route?.split('~') ?? [];
    const path = endpoints.length === 2 && endpoints.every(id => view?.nodes.includes(id))
      ? journey(model, endpoints[0]!, endpoints[1]!, viewId) : null;
    const validRoute = path && path.length >= 2;
    setFocusId(focusedNode?.id ?? null);
    setRelationId(relation);
    setLens(nextLens);
    setChapterIdx(chapter);
    setProbeFrom(validRoute ? endpoints[0]! : '');
    setProbeTo(validRoute ? endpoints[1]! : '');
    if (relation) onSelect(relation);
    else if (focusedNode) onSelect(focusedNode.id);
    else onDeselect();
    writeHash({
      focus: focusedNode?.id ?? null,
      relation,
      lens: serializeLens(nextLens),
      chapter: chapter >= 0 ? model.guidedViews[chapter]!.id : null,
      route: validRoute ? `${endpoints[0]}~${endpoints[1]}` : null,
    });
    pendingRouteRef.current = validRoute ? { from: endpoints[0]!, to: endpoints[1]! } : null;
    // Explicit UI view switches reconcile below instead of replaying the link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, modelIdKey(model), permalinkVersion]);

  const reach = useMemo(() => (focusId ? reachability(model, focusId, viewId) : null), [model, focusId, viewId]);
  const kindOf = useMemo(() => new Map(model.nodes.map((n) => [n.id, n.kind])), [model]);
  const viewEdges = useMemo(() => (view?.edges ?? []).flatMap((id) => { const e = model.edges.find((m) => m.id === id); return e ? [e] : []; }), [model, view]);
  // flow tokens only when the motion governor allows it — never bypass
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

  const canvasSize = () => { const r = flowAreaRef.current?.getBoundingClientRect(); return { width: r?.width ?? 0, height: r?.height ?? 0 }; };
  /** Width the outline rail covers on the canvas's right edge, plus a small gap; 0 when it is hidden. */
  const outlineReserve = () => {
    const area = flowAreaRef.current?.getBoundingClientRect(), rail = flowAreaRef.current?.parentElement?.querySelector<HTMLElement>('.aw-outline-rail');
    if (!area || !rail || getComputedStyle(rail).display === 'none') return 0;
    const box = rail.getBoundingClientRect();
    if (!box.width || box.left < area.left) return 0; // not laid out yet, or not on the canvas's right side
    return Math.max(0, area.right - box.left + 8);
  };

  // Fit after the replacement layout reaches React Flow, never against the old
  // view's nodes. React Flow queues fitView until node measurement completes.
  // `auto` fits once per layout and chapter, `resize` refits instantly after the canvas
  // changes size, `whole` is the explicit Fit View. Each hands the camera back to auto fitting.
  const fitCamera = useCallback((mode: 'auto' | 'resize' | 'whole' = 'auto') => {
    if (!rfRef.current || placed.key !== layoutKey || !placed.nodes.length) return;
    const cameraKey = JSON.stringify([placed.key, chapter?.id ?? null]);
    if (mode === 'auto' && fittedCameraRef.current === cameraKey) return;
    if(mode==='auto'&&preserveCameraRef.current===layoutKey){fittedCameraRef.current=cameraKey;preserveCameraRef.current=null;return;}
    const ids = mode === 'whole' ? [] : chapter?.focus.filter((id) => placed.nodes.some((node) => node.id === id)) ?? [];
    fittedCameraRef.current = cameraKey;
    userCameraRef.current = false;
    const options = { duration: mode === 'resize' || motion === 'still' ? 0 : 600, minZoom: 0.05, maxZoom: 2, padding: 0.15 };
    const plan = planCamera(ids.length ? focusBounds(placed.nodes, ids) : placed.bounds, canvasSize(), {
      padding: 24, reserveRight: outlineReserve(), maxZoom: 2, minReadable: mode === 'whole' ? 0 : MIN_READABLE_ZOOM,
    });
    if (plan) {
      setPartialView(plan.partial);
      void rfRef.current.setViewport({ x: plan.x, y: plan.y, zoom: plan.zoom }, { duration: options.duration });
      return;
    }
    // No measurable canvas yet: let React Flow fit once it has measured the nodes.
    setPartialView(false);
    if (ids.length) void rfRef.current.fitView({ ...options, nodes: ids.map(id => ({ id })), padding: 0.25 });
    else void rfRef.current.fitBounds(placed.bounds, options);
  }, [placed, layoutKey, chapter, motion]);
  useEffect(() => { fitCamera(); }, [fitCamera]);

  // Resizing or rotating keeps the diagram in view unless the user has panned or zoomed
  // since the last fit; their camera then stays put and Fit View remains available.
  const fitCameraRef = useRef(fitCamera);
  fitCameraRef.current = fitCamera;
  useEffect(() => {
    const area = flowAreaRef.current;
    if (!area || typeof ResizeObserver === 'undefined') return;
    let last: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const size = `${Math.round(entry.contentRect.width)}x${Math.round(entry.contentRect.height)}`;
      if (size === last) return;
      const first = last === null;
      last = size;
      if (first) return; // the first report is the size the initial fit already used
      clearTimeout(timer);
      timer = setTimeout(() => { if (!userCameraRef.current) fitCameraRef.current('resize'); }, 100);
    });
    observer.observe(area);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, []);

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
    const path = probe?.path ?? (savedRoute?.[0] && savedRoute[1] ? journey(model, savedRoute[0], savedRoute[1], viewId) : null);
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

  const playProbe = (from: string, to: string, restoring = false) => {
    pendingRouteRef.current = null;
    stopTimer();
    const path = journey(model, from, to, viewId);
    if (!path || path.length < 2) { setProbe(null); setProbeNoRoute(true); writeHash({ route: null }); return; }
    setProbeNoRoute(false);
    if (!restoring) {
      setRelationId(null);
      onDeselect();
      writeHash({ route: `${from}~${to}`, relation: null });
    }
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

  // A destination layout may still be in flight when its permalink arrives.
  // Start playback only once that layout is visible, and only if UI actions
  // have not replaced the pending route in the meantime.
  useEffect(() => {
    const pending = pendingRouteRef.current;
    if (!pending || placed.key !== layoutKey || !placed.nodes.length) return;
    pendingRouteRef.current = null;
    if (readHash().route === `${pending.from}~${pending.to}`) playProbe(pending.from, pending.to, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, layoutKey, permalinkVersion, motion]);

  const detailFocus = view && isDetailView(view) ? view.focus : null;
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
    if (!cls && detailFocus === n.id) cls = 'aw-detail-focus';
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

  if (layoutError) return <div className="aw-canvas" role="alert" style={{ padding: 24 }}>{layoutError}</div>;
  const showMinimap = viewNodes.length > 12 || partialView;

  return (
    <div className="aw-canvas" style={{ width: '100%', height: '100%', position: 'relative', containerType: 'inline-size' }}>
      <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute' }}><defs dangerouslySetInnerHTML={{ __html: GRAPH_MARKER_DEFS + ER_MARKER_DEFS }} /></svg>
      {(partialView || !!placed.warnings?.length) && <div className={showMinimap ? 'aw-canvas-notes aw-canvas-notes-beside-minimap' : 'aw-canvas-notes'}>
        {partialView && <p className="aw-canvas-partial" role="status">Showing the start at a readable size. <button type="button" onClick={() => fitCamera('whole')}>Show all</button></p>}
        {!!placed.warnings?.length&&<div role="status" aria-label="Layout warnings" tabIndex={0} className="aw-canvas-warnings">
          {warningSummary({ warnings: placed.warnings, omittedGroups: placed.omittedGroups ?? [] }).map(line => <p key={line}>{line}</p>)}
          {placed.warnings.some(isGroupDetail) && <details><summary>Details</summary><ul>{placed.warnings.filter(isGroupDetail).map(line => <li key={line}>{line}</li>)}</ul></details>}
        </div>}
      </div>}
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
      <div className="aw-flow-area" ref={flowAreaRef}><ReactFlow
        {...editing}
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        colorMode="dark"
        minZoom={0.05}
        deleteKeyCode={null}
        nodesConnectable={false}
        edgesReconnectable={false}
        onInit={(inst) => { rfRef.current = inst as ReactFlowInstance<Node, Edge>; fitCamera(); }}
        onMoveStart={(event) => { if (event) { userCameraRef.current = true; setPartialView(false); } }}
        onNodeClick={(_, n) => { if (n.type === 'boundary') return; focusNode(n.id); }}
        onPaneClick={() => { setFocusId(null); setRelationId(null); writeHash({ focus: null, relation: null }); onDeselect(); }}
        onEdgeClick={(_, e) => { setRelationId(e.id); onSelect(e.id); writeHash({ relation: e.id }); }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} color="#1a2333" />
        <Controls showFitView={false}><ControlButton aria-label="Fit View" title="Fit View" onClick={() => fitCamera('whole')}>⛶</ControlButton></Controls>
        {showMinimap && <MiniMap pannable zoomable />}
      </ReactFlow></div>
      <OutlineRail model={model} viewNodes={viewNodes} activeId={focusId} onFocusNode={focusNode} />
      {finderOpen && <NodeFinder model={model} viewNodes={viewNodes} onPick={focusNode} onClose={() => setFinderOpen(false)} />}
    </div>
  );
}

function modelIdKey(model: SystemModel): string {
  return `${model.title}:${model.revision}:${model.views.map((v) => v.id).join(',')}`;
}
