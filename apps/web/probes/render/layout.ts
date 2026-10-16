import ELK from 'elkjs/lib/elk.bundled.js';
import type { LayoutOptions, ElkNode, ElkExtendedEdge, ElkPoint } from 'elkjs';
import type { SystemModel, View } from '@archwoven/model';
import { entityLayout } from '../../lib/entity';
import { systemNodeLayout, edgeCaption } from '../../lib/graph-geometry';

const elk = new ELK();

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoutedEdge {
  id: string;
  points: ElkPoint[];
  label?: { x: number; y: number; width: number; height: number; lines: string[] };
}

export interface LayoutResult {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: RoutedEdge[];
}

/** Node box sizing: ER entities size with their fields; everything else is label-based. */
export function nodeSize(model: SystemModel, nodeId: string): { width: number; height: number } {
  const node = model.nodes.find((n) => n.id === nodeId);
  const label = node?.label ?? nodeId;
  if (node?.kind === 'entity') {
    const { width, height } = entityLayout(node);
    return { width, height };
  }
  const { width, height } = systemNodeLayout(node ?? { id: nodeId, kind: 'component', label, provenance: 'inferred', evidence: [] });
  return { width, height };
}

const BASE_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': '48',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.padding': '[top=40,left=40,bottom=40,right=40]',
  'elk.selfloopDistribution': 'NEAREST_SECTOR',
};

/**
 * Deterministic auto-layout of one view's subgraph via ELK (layered).
 * Same code path in browser (bundled, main thread) and Node (tests/export).
 */
export async function layoutModel(model: SystemModel, viewId: string): Promise<LayoutResult> {
  const view: View | undefined = model.views.find((v) => v.id === viewId);
  if (!view) throw new Error(`unknown view: ${viewId}`);

  const horizontal = view.orientation === 'LR';
  const nodeIndex = new Map(view.nodes.map((id, i) => [id, i]));
  const children: ElkNode[] = view.nodes.map((id, i) => {
    const { width, height } = nodeSize(model, id);
    return { id: `n-${i}`, width, height, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' }, ports: [
      { id: `p-${i}-out`, x: horizontal ? width : width / 2, y: horizontal ? height / 2 : height, width: 0, height: 0, layoutOptions: { 'elk.port.side': horizontal ? 'EAST' : 'SOUTH' } },
      { id: `p-${i}-in`, x: horizontal ? 0 : width / 2, y: horizontal ? height / 2 : 0, width: 0, height: 0, layoutOptions: { 'elk.port.side': horizontal ? 'WEST' : 'NORTH' } },
    ] };
  });
  const captions = new Map<string, ReturnType<typeof edgeCaption>>();
  const edges: ElkExtendedEdge[] = view.edges.map((id, i) => {
    const edge = model.edges.find(e => e.id === id);
    if (!edge) throw new Error(`unknown edge in view ${viewId}: ${id}`);
    const from = nodeIndex.get(edge.from), to = nodeIndex.get(edge.to);
    if (from === undefined || to === undefined) throw new Error(`edge ${id} has endpoints outside this view`);
    const caption = edgeCaption(edge, view.type); captions.set(id, caption);
    return { id: `e-${i}`, sources: [`p-${from}-out`], targets: [`p-${to}-in`], ...(caption ? { labels: [{ id: `label-${i}`, text: caption.lines.join('\n'), width: caption.width, height: caption.height, layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } }] } : {}) };
  });
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      ...BASE_OPTIONS,
      'elk.direction': horizontal ? 'RIGHT' : 'DOWN',
      'elk.spacing.edgeLabel': '12',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      ...(view.type === 'er' ? { 'elk.layered.spacing.nodeNodeBetweenLayers': '180' } : {}),
    },
    children, edges,
  };
  const layout = await elk.layout(graph);

  const nodes: PlacedNode[] = (layout.children ?? []).map((c) => ({
    id: view.nodes[Number(c.id.slice(2))]!,
    x: c.x ?? 0,
    y: c.y ?? 0,
    width: c.width ?? 150,
    height: c.height ?? 46,
  }));

  const routed: RoutedEdge[] = (layout.edges ?? []).map(edge => {
    const id = view.edges[Number(edge.id.slice(2))]!;
    const sections = edge.sections ?? [];
    if (sections.length !== 1) throw new Error(`edge ${id} has no continuous routed section`);
    const section = sections[0]!;
    const caption = captions.get(id), box = edge.labels?.[0];
    return { id, points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint], ...(caption && box ? { label: { x: box.x ?? 0, y: box.y ?? 0, ...caption } } : {}) };
  });
  return { width: layout.width ?? 0, height: layout.height ?? 0, nodes, edges: routed };
}

/** Axis-aligned overlap count — the readability check the memo cites. */
export function countOverlaps(nodes: PlacedNode[], pad = 8): number {
  let overlaps = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (
        a.x + a.width + pad > b.x &&
        b.x + b.width + pad > a.x &&
        a.y + a.height + pad > b.y &&
        b.y + b.height + pad > a.y
      ) {
        overlaps++;
      }
    }
  }
  return overlaps;
}
