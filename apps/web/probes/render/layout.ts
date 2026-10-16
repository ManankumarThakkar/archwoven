import ELK from 'elkjs/lib/elk.bundled.js';
import type { LayoutOptions } from 'elkjs';
import type { SystemModel, View } from '@archwoven/model';
import { entityLayout } from '../../lib/entity';

const elk = new ELK();

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  width: number;
  height: number;
  nodes: PlacedNode[];
}

/** Node box sizing: ER entities size with their fields; everything else is label-based. */
export function nodeSize(model: SystemModel, nodeId: string): { width: number; height: number } {
  const node = model.nodes.find((n) => n.id === nodeId);
  const label = node?.label ?? nodeId;
  if (node?.kind === 'entity') {
    const { width, height } = entityLayout(node);
    return { width, height };
  }
  return { width: Math.max(150, label.length * 8.5 + 36), height: 46 };
}

const BASE_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': '48',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
  'elk.edgeRouting': 'SPLINES',
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

  const children = view.nodes.map((id) => {
    const { width, height } = nodeSize(model, id);
    return { id, width, height };
  });
  const edges = view.edges.map((id) => {
    const edge = model.edges.find((e) => e.id === id);
    if (!edge) throw new Error(`unknown edge in view ${viewId}: ${id}`);
    return { id, sources: [edge.from], targets: [edge.to] };
  });

  interface ElkResult {
    width?: number;
    height?: number;
    children?: { id: string; x?: number; y?: number; width?: number; height?: number }[];
  }
  const layout = (await elk.layout({
    id: viewId,
    layoutOptions: {
      ...BASE_OPTIONS,
      'elk.direction': view.orientation === 'LR' ? 'RIGHT' : 'DOWN',
      // Entity relationships carry both a name and multiplicity. Leave space
      // between the larger field tables so their captions remain readable.
      ...(view.type === 'er' ? { 'elk.layered.spacing.nodeNodeBetweenLayers': '180' } : {}),
    },
    children,
    edges,
  })) as ElkResult;

  const nodes: PlacedNode[] = (layout.children ?? []).map((c) => ({
    id: c.id,
    x: c.x ?? 0,
    y: c.y ?? 0,
    width: c.width ?? 150,
    height: c.height ?? 46,
  }));

  return { width: layout.width ?? 0, height: layout.height ?? 0, nodes };
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
