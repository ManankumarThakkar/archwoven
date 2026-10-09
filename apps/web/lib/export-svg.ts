import type { SystemModel } from '@archwoven/model';
import { layoutModel, nodeSize } from './layout';

/**
 * Render a view's subgraph to a standalone SVG string from ELK positions.
 * Self-contained (system font stack, no external refs) so it downloads and
 * renders anywhere; renderPng() rasterizes it when fonts are supplied.
 */
export async function buildSvg(model: SystemModel, viewId: string): Promise<string> {
  const placed = await layoutModel(model, viewId);
  const view = model.views.find((v) => v.id === viewId);
  const pos = new Map(placed.nodes.map((n) => [n.id, n]));

  const edges = (view?.edges ?? []).flatMap((id) => {
    const e = model.edges.find((m) => m.id === id);
    const a = pos.get(e?.from ?? '');
    const b = pos.get(e?.to ?? '');
    if (!e || !a || !b) return [];
    const x1 = a.x + a.width / 2, y1 = a.y + a.height / 2, x2 = b.x + b.width / 2, y2 = b.y + b.height / 2;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow)"/>` +
      (e.label ? `<text x="${mx}" y="${my - 4}" font-size="11" fill="#94a3b8" text-anchor="middle">${esc(e.label)}</text>` : '');
  }).join('\n  ');

  const nodes = placed.nodes.map((n) => {
    const node = model.nodes.find((m) => m.id === n.id)!;
    const color = node.provenance === 'proposed' ? '#c4b5fd' : node.provenance === 'source-supported' ? '#93c5fd' : node.provenance === 'inferred' ? '#fbbf24' : '#5eead4';
    return `<g><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10" fill="#0f172a" stroke="${color}" stroke-width="2"/>` +
      `<text x="${n.x + n.width / 2}" y="${n.y + n.height / 2 + 4}" font-size="13" fill="#e5e7eb" text-anchor="middle">${esc(node.label)}</text></g>`;
  }).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${placed.width}" height="${placed.height}" viewBox="0 0 ${placed.width} ${placed.height}" font-family="Inter, system-ui, sans-serif"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/></marker></defs><rect width="100%" height="100%" fill="#070b14"/>${edges}${nodes}</svg>`;
}

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
