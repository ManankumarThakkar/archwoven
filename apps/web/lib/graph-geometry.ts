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
  const omittedGroups: string[] = [];
  const labels = new Map(model.nodes.map(node => [node.id, node.label]));
  const names = (nodes: { id: string }[], limit = Infinity) => {
    const all = nodes.map(node => labels.get(node.id) ?? node.id);
    return all.length > limit ? `${all.slice(0, limit).join(', ')} and ${all.length - limit} more` : all.join(', ');
  };
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
      warnings.push(`Group "${boundary.label}" is not drawn as a box because it would also cover ${names(conflicts, 3)}. Members shown: ${names(members)}.`);
      omittedGroups.push(boundary.label);
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
  return { boundaries, warnings: [...new Set(warnings)], omittedGroups, bounds: { x, y, width: right - x, height: bottom - y } };
}

/** One short line for omitted groups, plus any other layout warnings unchanged. The
 *  per-group detail stays in `warnings` for the canvas details and the SVG description. */
export function warningSummary({ warnings, omittedGroups }: { warnings: string[]; omittedGroups: string[] }): string[] {
  const groups = omittedGroups.length === 0 ? [] : [omittedGroups.length === 1
    ? `1 group is not drawn as a box, to avoid covering other components: ${omittedGroups[0]}.`
    : `${omittedGroups.length} groups are not drawn as boxes, to avoid covering other components: ${omittedGroups.join(', ')}.`];
  return [...groups, ...warnings.filter(warning => !isGroupDetail(warning))];
}

/** Whether a warning is the per-group detail behind the one-line group summary. */
export const isGroupDetail = (warning: string) => warning.startsWith('Group "') && warning.includes('" is not drawn as a box because');
