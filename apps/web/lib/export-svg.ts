import type { SystemModel } from '@archwoven/model';
import { layoutModel } from './layout';
import { sequenceSvg } from './sequence';
import { entitySvg, erMarkers, erLabel, ER_MARKER_DEFS } from './entity';
import { escapeXml } from './svg-text';
import { captionSvg, GRAPH_MARKER_DEFS, graphArrow, routedEdgeSvg, systemNodeSvg } from './graph-svg';
import { graphScene } from './graph-geometry';

/** Standalone, escaped SVG from the same node/edge scene as the workspace. */
export async function buildSvg(model: SystemModel, viewId: string): Promise<string> {
  const view = model.views.find(v => v.id === viewId);
  if (view?.type === 'sequence') return sequenceSvg(model, viewId);
  const placed = await layoutModel(model, viewId);
  const paths: string[] = [], captions: string[] = [];
  for (const route of placed.edges) {
    const edge = model.edges.find(edge => edge.id === route.id)!;
    paths.push(routedEdgeSvg(route, edge, view?.type === 'er' ? erMarkers(edge) : { end: graphArrow(edge) }));
    captions.push(captionSvg(route, view?.type === 'er' ? erLabel(edge) : edge.label ?? ''));
  }
  const { boundaries, bounds } = graphScene(model, placed);
  const hulls = boundaries.map(({ x, y, width, height, lines, label }) =>
    `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="none" stroke="#64748b" stroke-dasharray="6 4"/><title>${escapeXml(label)}</title><text x="${x + 12}" y="${y + 20}" font-size="11" fill="#94a3b8">${lines.map((line, i) => `<tspan x="${x + 12}" dy="${i ? 16 : 0}">${escapeXml(line)}</tspan>`).join('')}</text></g>`
  ).join('');
  const nodes = placed.nodes.map(n => {
    const node = model.nodes.find(node => node.id === n.id)!;
    return node.kind === 'entity' ? entitySvg(node, n.x, n.y) : systemNodeSvg(node, n.x, n.y);
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" font-family="Inter, sans-serif" role="img"><title>${escapeXml(model.title)}</title><defs>${GRAPH_MARKER_DEFS}${ER_MARKER_DEFS}</defs><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#070b14"/>${hulls}${paths.join('')}${nodes}${captions.join('')}</svg>`;
}
