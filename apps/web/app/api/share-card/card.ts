import type { SystemModel } from '@archwoven/model';
import { journey, reachability } from '../../workspace/graph-inspect';

/**
 * 1200×630 share card SVG (route/reach). TEXT SURFACE RULE:
 * only model titles + node labels appear here — never evidence paths, commits,
 * or repo names. Text is escaped; the SVG is rendered to PNG server-side.
 */
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NODE_W = 170;
const NODE_H = 54;

const box = (x: number, y: number, label: string, hot: boolean): string => `
  <rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="${hot ? '#0f2e2b' : '#10233f'}" stroke="${hot ? '#5eead4' : '#93c5fd'}" stroke-width="${hot ? 3 : 1.5}"/>
  <text x="${x + NODE_W / 2}" y="${y + NODE_H / 2 + 5}" text-anchor="middle" font-family="Inter" font-size="17" fill="#e5e7eb">${esc(label)}</text>`;

const arrow = (x1: number, y: number, x2: number): string =>
  `<line x1="${x1}" y1="${y}" x2="${x2 - 10}" y2="${y}" stroke="#5eead4" stroke-width="2.5" marker-end="url(#aw-arrow)"/>`;

export function buildCardSvg(model: SystemModel, viewId: string, kind: 'route' | 'reach', from: string, to?: string): string {
  const label = (id: string): string => model.nodes.find((n) => n.id === id)?.label ?? id;
  const parts: string[] = [];

  if (kind === 'route') {
    const path = journey(model, from, to ?? from, viewId) ?? [from];
    const shown = path.slice(0, 6);
    const gap = (1200 - 80 - NODE_W) / Math.max(1, shown.length - 1);
    shown.forEach((id, i) => {
      const x = 40 + i * gap;
      parts.push(box(x, 288, label(id), i === 0 || i === shown.length - 1));
      if (i + 1 < shown.length) parts.push(arrow(x + NODE_W, 315, x + gap));
    });
    if (path.length > 6) parts.push(`<text x="1160" y="380" text-anchor="end" font-family="Inter" font-size="14" fill="#8b98b8">+${path.length - 6} more hops</text>`);
  } else {
    const { forward, backward } = reachability(model, from, viewId);
    parts.push(box(515, 288, label(from), true));
    const bwd = [...backward.keys()].reverse().slice(-4);
    const fwd = [...forward.keys()].slice(0, 4);
    bwd.forEach((id, i) => parts.push(box(40 + i * (NODE_W + 18), 150, label(id), false)));
    fwd.forEach((id, i) => parts.push(box(40 + i * (NODE_W + 18), 430, label(id), false)));
    if (backward.size > 4) parts.push(`<text x="1160" y="180" text-anchor="end" font-family="Inter" font-size="14" fill="#8b98b8">+${backward.size - 4} upstream</text>`);
    if (forward.size > 4) parts.push(`<text x="1160" y="460" text-anchor="end" font-family="Inter" font-size="14" fill="#8b98b8">+${forward.size - 4} downstream</text>`);
    parts.push(`<line x1="600" y1="204" x2="600" y2="286" stroke="#93c5fd" stroke-width="2" marker-end="url(#aw-arrow)"/>`);
    parts.push(`<line x1="600" y1="344" x2="600" y2="426" stroke="#93c5fd" stroke-width="2" marker-end="url(#aw-arrow)"/>`);
  }

  const badge = kind === 'route' ? 'ROUTE' : 'REACHABILITY';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><marker id="aw-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#5eead4"/></marker></defs>
  <rect width="1200" height="630" fill="#070b14"/>
  <text x="40" y="64" font-family="Inter" font-size="30" font-weight="600" fill="#e5e7eb">${esc(model.title)}</text>
  <text x="1160" y="64" text-anchor="end" font-family="Inter" font-size="16" fill="#5eead4">${badge}</text>
  ${parts.join('\n  ')}
  <text x="40" y="596" font-family="Inter" font-size="15" fill="#8b98b8">Archwoven · ${esc(model.privacy.classification)} · ${esc(model.privacy.boundary)}</text>
</svg>`;
}
