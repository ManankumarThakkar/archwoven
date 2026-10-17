import { internalsOf, isDetailView, isInternal, type SystemModel } from '@archwoven/model';
import { layoutModel } from './layout';
import { sequenceSvg } from './sequence';
import { entitySvg, erMarkers, erLabel, ER_MARKER_DEFS } from './entity';
import { escapeXml, wrapText } from './svg-text';
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
  const { boundaries, bounds: graphBounds } = graphScene(model, placed);
  let bounds = graphBounds, header = '', detailDescription = '';
  const focus = view && isDetailView(view) ? model.nodes.find(n => n.id === view.focus) : undefined;
  if (focus) {
    const expanded = internalsOf(model, focus.id).length > 0;
    const caption = expanded ? `Inside ${focus.label} (inferred) · and its direct connections`
      : `${focus.label} and its direct connections · arranged automatically${view?.edges.length ? '' : ' · no direct connections'}`;
    const width = Math.max(graphBounds.width, 320);
    const lines = wrapText(caption, width - 32, 13);
    const sourceCaption = expanded && model.nodes.some(n => n.provenance === 'source-supported')
      ? 'Internals are inferred, not found in source.' : '';
    const sourceLines = sourceCaption ? wrapText(sourceCaption, width - 32, 11) : [];
    detailDescription = [caption, sourceCaption].filter(Boolean).join(' ');
    const height = 32 + lines.length * 18 + sourceLines.length * 16;
    bounds = { ...graphBounds, y: graphBounds.y - height, width, height: graphBounds.height + height };
    const x = bounds.x + 16;
    const text = (rows: string[], y: number, size: number, lineHeight: number, fill: string) => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}">${rows.map((line, i) => `<tspan x="${x}" dy="${i ? lineHeight : 0}">${escapeXml(line)}</tspan>`).join('')}</text>`;
    header = `<g data-detail-caption="true">${text(lines, bounds.y + 24, 13, 18, '#e5e7eb')}${sourceLines.length ? text(sourceLines, bounds.y + 24 + lines.length * 18, 11, 16, '#94a3b8') : ''}</g>`;
  }
  const hulls = boundaries.map(({ x, y, width, height, lines, label }) =>
    `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="none" stroke="#64748b" stroke-dasharray="6 4"/><title>${escapeXml(label)}</title><text x="${x + 12}" y="${y + 20}" font-size="11" fill="#94a3b8">${lines.map((line, i) => `<tspan x="${x + 12}" dy="${i ? 16 : 0}">${escapeXml(line)}</tspan>`).join('')}</text></g>`
  ).join('');
  const nodes = placed.nodes.map(n => {
    const node = model.nodes.find(node => node.id === n.id)!;
    return node.kind === 'entity' ? entitySvg(node, n.x, n.y) : systemNodeSvg(node, n.x, n.y, {
      inside: isInternal(model, node.id) ? model.nodes.find(parent => parent.id === node.group)?.label : undefined,
      hasDetail: internalsOf(model, node.id).length > 0,
    });
  }).join('');
  const description = [detailDescription, ...(placed.warnings ?? [])].filter(Boolean).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" font-family="Inter, sans-serif" role="img"><title>${escapeXml(model.title)}</title>${description ? `<desc>${escapeXml(description)}</desc>` : ''}<defs>${GRAPH_MARKER_DEFS}${ER_MARKER_DEFS}</defs><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#070b14"/>${header}${hulls}${paths.join('')}${nodes}${captions.join('')}</svg>`;
}
