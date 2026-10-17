import type { SystemModel, Edge, ViewType } from '@archwoven/model';
import { wrapText, textWidth } from './svg-text';
import { erLabel } from './entity';
import type { LayoutResult } from './layout';

export function systemNodeLayout(node: SystemModel['nodes'][number]) {
  const lines = wrapText(node.label, 242, 13);
  return { lines, width: Math.max(160, Math.ceil(Math.max(...lines.map(line => textWidth(line, 13))) + 28)), height: lines.length * 18 + 36 };
}
export function edgeCaption(edge: Edge, view: ViewType) {
  const text = view === 'er' ? erLabel(edge) : edge.label;
  if (!text) return null;
  const lines = wrapText(text, 180, 11);
  return { lines, width: Math.max(24, Math.ceil(Math.max(...lines.map(line => textWidth(line, 11))) + 16)), height: lines.length * 16 + 12 };
}
export const routePath = (points: { x: number; y: number }[]) => points.map((point, i) => `${i ? 'L' : 'M'}${point.x},${point.y}`).join(' ');

/** Include wrapped boundary headings and all routed captions in whole-view fits. */
export function graphScene(model: SystemModel, placed: LayoutResult) {
  const boundaries = model.boundaries.flatMap(boundary => {
    const members = placed.nodes.filter(node => boundary.wraps.includes(node.id));
    if (!members.length) return [];
    const x = Math.min(...members.map(node => node.x)) - 24;
    const width = Math.max(...members.map(node => node.x + node.width)) - x + 24;
    const lines = wrapText(boundary.label, width - 24, 11);
    const y = Math.min(...members.map(node => node.y)) - (lines.length * 16 + 28);
    const height = Math.max(...members.map(node => node.y + node.height)) - y + 24;
    return [{ ...boundary, x, y, width, height, lines }];
  });
  const boxes = [...placed.nodes, ...placed.edges.flatMap(edge => edge.label ? [edge.label] : []), ...boundaries];
  const points = placed.edges.flatMap(edge => edge.points);
  const base = placed.bounds ?? { x: 0, y: 0, width: placed.width, height: placed.height };
  const x = Math.min(base.x, ...boxes.map(box => box.x - 8), ...points.map(point => point.x - 8));
  const y = Math.min(base.y, ...boxes.map(box => box.y - 8), ...points.map(point => point.y - 8));
  const right = Math.max(base.x + base.width, ...boxes.map(box => box.x + box.width + 8), ...points.map(point => point.x + 8));
  const bottom = Math.max(base.y + base.height, ...boxes.map(box => box.y + box.height + 8), ...points.map(point => point.y + 8));
  return { boundaries, bounds: { x, y, width: right - x, height: bottom - y } };
}
