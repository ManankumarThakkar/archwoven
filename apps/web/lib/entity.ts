import type { SystemModel, Edge } from '@archwoven/model';
import { wrapText, escapeXml } from './svg-text';
import { PROVENANCE_STYLE } from './provenance';

type Entity = SystemModel['nodes'][number];
/** Identical rows and box dimensions for React Flow, ELK and standalone SVG. */
export function entityLayout(node: Entity) {
  // Font-aware line breaks are shared by workspace, layout and export.
  const label = wrapText(node.label, 360 - 28, 13);
  const headerHeight = label.length * 18 + 36;
  const rows = (node.fields ?? []).map(field => {
    const name = wrapText(field.name, 160, 12), type = wrapText(field.type ?? 'unspecified', 124, 12);
    return { field, name, type, height: Math.max(name.length, type.length) * 18 + 12 };
  });
  return { width: 360, height: headerHeight + 24 + (rows.length ? rows.reduce((sum, row) => sum + row.height, 0) : 36), headerHeight, label, rows };
}

export const ER_MARKER_DEFS = Object.entries(PROVENANCE_STYLE).map(([kind, style]) =>
  `<marker id="er-one-${kind}" viewBox="0 -7 14 14" refX="12" refY="0" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M10,-6 V6" fill="none" stroke="${style.border}" stroke-width="1.5"/></marker>` +
  `<marker id="er-many-${kind}" viewBox="0 -7 14 14" refX="12" refY="0" markerWidth="16" markerHeight="16" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M12,-6 L0,0 L12,6 M0,0 L12,0" fill="none" stroke="${style.border}" stroke-width="1.5"/></marker>`).join('');

export function erMarkers(edge: Edge): { start?: string; end?: string } {
  if (!edge.cardinality) return {};
  const manyFrom = edge.cardinality === 'N:M';
  const manyTo = edge.cardinality !== '1:1';
  return { start: `er-${manyFrom ? 'many' : 'one'}-${edge.provenance}`, end: `er-${manyTo ? 'many' : 'one'}-${edge.provenance}` };
}
export const erLabel = (edge: Edge): string => [edge.label, edge.cardinality ?? 'cardinality unspecified'].filter(Boolean).join(' · ');

export function entitySvg(node: Entity, x: number, y: number): string {
  const box = entityLayout(node), color = PROVENANCE_STYLE[node.provenance];
  const text = (left: number, top: number, lines: string[], fill = '#e5e7eb', anchor = 'start', size = 12) => `<text x="${left}" y="${top}" text-anchor="${anchor}" font-size="${size}" fill="${fill}">${lines.map((line, i) => `<tspan x="${left}" dy="${i ? 18 : 0}">${escapeXml(line)}</tspan>`).join('')}</text>`;
  const parts = [`<g data-entity="${escapeXml(node.id)}"><rect x="${x}" y="${y}" width="${box.width}" height="${box.height}" rx="10" fill="#0f172a" stroke="${color.border}" stroke-width="2"/>`,
    text(x + box.width / 2, y + 22, box.label, '#e5e7eb', 'middle', 13),
    text(x + box.width / 2, y + box.headerHeight - 9, [color.badge], color.border, 'middle', 11),
    `<path d="M${x},${y + box.headerHeight} h${box.width}" stroke="${color.border}"/>`,
    text(x + 14, y + box.headerHeight + 16, ['Key'], '#94a3b8', 'start', 10), text(x + 54, y + box.headerHeight + 16, ['Field'], '#94a3b8', 'start', 10), text(x + 222, y + box.headerHeight + 16, ['Type'], '#94a3b8', 'start', 10)];
  let rowY = y + box.headerHeight + 24;
  if (!box.rows.length) parts.push(text(x + 14, rowY + 22, ['No fields provided'], '#94a3b8'));
  for (const row of box.rows) {
    parts.push(`<g data-field="${escapeXml(row.field.name)}"><title>${escapeXml(`${row.field.name} · ${row.field.type ?? 'unspecified'}${row.field.key ? ` · ${row.field.key.toUpperCase()}` : ''}`)}</title>`);
    parts.push(text(x + 14, rowY + 19, [row.field.key?.toUpperCase() ?? '—'], row.field.key ? color.border : '#64748b'), text(x + 54, rowY + 19, row.name), text(x + 222, rowY + 19, row.type, '#a6b4cf'));
    rowY += row.height;
    parts.push(`<path d="M${x + 12},${rowY} h${box.width - 24}" stroke="#243249"/>`);
    parts.push('</g>');
  }
  parts.push('</g>');
  return parts.join('\n');
}
