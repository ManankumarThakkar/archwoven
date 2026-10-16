import type { SystemModel } from '@archwoven/model';
import { layoutModel, nodeSize } from './layout';
import { sequenceSvg } from './sequence';
import { entitySvg, erMarkers, erLabel, ER_MARKER_DEFS } from './entity';

/**
 * Render a view's subgraph to a standalone SVG string from ELK positions.
 * Self-contained (system font stack, no external refs) so it downloads and
 * renders anywhere; renderPng() rasterizes it when fonts are supplied.
 */
export async function buildSvg(model: SystemModel, viewId: string): Promise<string> {
  const view = model.views.find((v) => v.id === viewId);
  if (view?.type === 'sequence') return sequenceSvg(model, viewId);
  const placed = await layoutModel(model, viewId);
  const pos = new Map(placed.nodes.map((n) => [n.id, n]));

  const edges = (view?.edges ?? []).flatMap((id) => {
    const e = model.edges.find((m) => m.id === id);
    const a = pos.get(e?.from ?? '');
    const b = pos.get(e?.to ?? '');
    if (!e || !a || !b) return [];
    const ax = a.x + a.width / 2, ay = a.y + a.height / 2, bx = b.x + b.width / 2, by = b.y + b.height / 2;
    // ER multiplicity belongs at the box boundary rather than under the entity.
    const atBorder = (box: typeof a, dx: number, dy: number) => {
      const scale = 1 / Math.max(Math.abs(dx) / (box.width / 2), Math.abs(dy) / (box.height / 2), 0.001);
      return { x: box.x + box.width / 2 + dx * scale, y: box.y + box.height / 2 + dy * scale };
    };
    const start = view?.type === 'er' ? atBorder(a, bx - ax, by - ay) : { x: ax, y: ay };
    const end = view?.type === 'er' ? atBorder(b, ax - bx, ay - by) : { x: bx, y: by };
    const { x: x1, y: y1 } = start, { x: x2, y: y2 } = end;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const markers = view?.type === 'er' ? erMarkers(e) : {};
    const markerAttrs = view?.type === 'er' ? `${markers.start ? ` marker-start="url(#${markers.start})"` : ''}${markers.end ? ` marker-end="url(#${markers.end})"` : ''}` : ' marker-end="url(#arrow)"';
    const label = view?.type === 'er' ? erLabel(e) : e.label;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="1.5"${markerAttrs}/>` +
      (label ? `<text x="${mx}" y="${my - 4}" font-size="11" fill="#94a3b8" text-anchor="middle">${esc(label)}</text>` : '');
  }).join('\n  ');

  const nodes = placed.nodes.map((n) => {
    const node = model.nodes.find((m) => m.id === n.id)!;
    if (view?.type === 'er' && node.kind === 'entity') return entitySvg(node, n.x, n.y);
    const color = node.provenance === 'proposed' ? '#c4b5fd' : node.provenance === 'source-supported' ? '#93c5fd' : node.provenance === 'inferred' ? '#fbbf24' : '#5eead4';
    return `<g><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10" fill="#0f172a" stroke="${color}" stroke-width="2"/>` +
      `<text x="${n.x + n.width / 2}" y="${n.y + n.height / 2 + 4}" font-size="13" fill="#e5e7eb" text-anchor="middle">${esc(node.label)}</text></g>`;
  }).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${placed.width}" height="${placed.height}" viewBox="0 0 ${placed.width} ${placed.height}" font-family="Inter, system-ui, sans-serif"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/></marker>${view?.type === 'er' ? ER_MARKER_DEFS : ''}</defs><rect width="100%" height="100%" fill="#070b14"/>${edges}${nodes}</svg>`;
}

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
