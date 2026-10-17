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

/** Shared truthful enclosures, layout warnings, and whole-view fit geometry. */
export function graphScene(model: SystemModel, placed: LayoutResult) {
  const warnings = [...(placed.warnings ?? [])];
  const labels = new Map(model.nodes.map(node => [node.id, node.label]));
  const describe = (node: { id: string }) => `${labels.get(node.id) ?? node.id} (${node.id})`;
  const boundaries = model.boundaries.flatMap(boundary => {
    const membership = new Set(boundary.wraps);
    const members = placed.nodes.filter(node => membership.has(node.id));
    if (!members.length) return [];
    const x = Math.min(...members.map(node => node.x)) - 24;
    const width = Math.max(...members.map(node => node.x + node.width)) - x + 24;
    const lines = wrapText(boundary.label, width - 24, 11);
    const y = Math.min(...members.map(node => node.y)) - (lines.length * 16 + 28);
    const height = Math.max(...members.map(node => node.y + node.height)) - y + 24;
    // Hulls are derived after placement, so even their heading/padding may cover outsiders.
    const conflicts = placed.nodes.filter(node => !membership.has(node.id)
      && x < node.x + node.width && x + width > node.x
      && y < node.y + node.height && y + height > node.y);
    if (conflicts.length) {
      warnings.push(`Boundary "${boundary.label}" (${boundary.id}) enclosure omitted because its box would overlap nonmember nodes: ${conflicts.map(describe).join(', ')}. Members in this view: ${members.map(describe).join(', ')}.`);
      return [];
    }
    return [{ ...boundary, x, y, width, height, lines }];
  });
  const boxes = [...placed.nodes, ...placed.edges.flatMap(edge => edge.label ? [edge.label] : []), ...boundaries];
  const points = placed.edges.flatMap(edge => edge.points);
  const base = placed.bounds ?? { x: 0, y: 0, width: placed.width, height: placed.height };
  const x = Math.min(base.x, ...boxes.map(box => box.x - 8), ...points.map(point => point.x - 8));
  const y = Math.min(base.y, ...boxes.map(box => box.y - 8), ...points.map(point => point.y - 8));
  const right = Math.max(base.x + base.width, ...boxes.map(box => box.x + box.width + 8), ...points.map(point => point.x + 8));
  const bottom = Math.max(base.y + base.height, ...boxes.map(box => box.y + box.height + 8), ...points.map(point => point.y + 8));
  return { boundaries, warnings: [...new Set(warnings)], bounds: { x, y, width: right - x, height: bottom - y } };
}
