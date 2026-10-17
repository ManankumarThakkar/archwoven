import type { SystemModel, Edge } from '@archwoven/model';
import { PROVENANCE_STYLE } from './provenance';
import { escapeXml } from './svg-text';
import { systemNodeLayout, routePath } from './graph-geometry';
import type { RoutedEdge } from './layout';

export const GRAPH_MARKER_DEFS = Object.entries(PROVENANCE_STYLE).map(([kind, style]) => `<marker id="graph-arrow-${kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${style.border}"/></marker>`).join('');
export const graphArrow = (edge: Edge) => `graph-arrow-${edge.provenance}`;

export function systemNodeSvg(node: SystemModel['nodes'][number], x: number, y: number, context: { inside?: string; hasDetail?: boolean } = {}): string {
  const box = systemNodeLayout(node), style = PROVENANCE_STYLE[node.provenance], cx = x + box.width / 2;
  const title = context.inside ? `${node.label} — inside ${context.inside} (inferred)` : `${node.label} · ${node.provenance}`;
  return `<g data-node="${escapeXml(node.id)}"><title>${escapeXml(title)}</title><rect x="${x}" y="${y}" width="${box.width}" height="${box.height}" rx="10" fill="${style.bg}" stroke="${style.border}" stroke-width="2"${context.inside ? ' stroke-dasharray="6 4"' : ''}/><text x="${cx}" y="${y + 22}" font-size="13" text-anchor="middle" fill="#e5e7eb">${box.lines.map((line, i) => `<tspan x="${cx}" dy="${i ? 18 : 0}">${escapeXml(line)}</tspan>`).join('')}</text><text x="${cx}" y="${y + box.height - 10}" font-size="10" text-anchor="middle" fill="${style.border}">${style.badge}${context.hasDetail ? ' · detail' : ''}</text></g>`;
}
export function captionSvg(route: RoutedEdge, original: string): string {
  const box = route.label;
  if (!box) return '';
  return `<g data-edge-label="${escapeXml(route.id)}"><title>${escapeXml(original)}</title><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="5" fill="#0c1523" stroke="#26364c"/><text x="${box.x + 8}" y="${box.y + 17}" font-size="11" fill="#cbd5e1">${box.lines.map((line, i) => `<tspan x="${box.x + 8}" dy="${i ? 16 : 0}">${escapeXml(line)}</tspan>`).join('')}</text></g>`;
}
export function routedEdgeSvg(route: RoutedEdge, edge: Edge, markers: { start?: string; end?: string }): string {
  const style = PROVENANCE_STYLE[edge.provenance];
  return `<path data-edge="${escapeXml(edge.id)}" d="${routePath(route.points)}" fill="none" stroke="${style.border}" stroke-width="1.5"${edge.type === 'async' ? ' stroke-dasharray="6 4"' : ''}${markers.start ? ` marker-start="url(#${escapeXml(markers.start)})"` : ''}${markers.end ? ` marker-end="url(#${escapeXml(markers.end)})"` : ''}/>`;
}
