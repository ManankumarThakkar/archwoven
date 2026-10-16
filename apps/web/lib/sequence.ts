import type { SystemModel } from '@archwoven/model';
import { PROVENANCE_STYLE } from './provenance';

export const escapeXml = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Wrap without dropping text, including long identifiers and explicit newlines. */
function linesOf(text: string, limit: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + word.length + 1 > limit) { lines.push(line); line = ''; }
      let rest = word;
      while (rest.length > limit) { if (line) { lines.push(line); line = ''; } lines.push(rest.slice(0, limit)); rest = rest.slice(limit); }
      line += (line ? ' ' : '') + rest;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}
const textAt = (x: number, y: number, lines: string[], anchor = 'middle', color = '#e6edf7') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? 18 : 0}">${escapeXml(line)}</tspan>`).join('')}</text>`;

/** One pure, escaped timeline for the workspace and SVG/PNG export. */
export function sequenceDiagram(model: SystemModel, viewId: string): { svg: string; width: number; height: number } {
  const view = model.views.find(v => v.id === viewId);
  const seq = view?.sequence;
  if (view?.type !== 'sequence' || !seq) throw new Error('This sequence view has no message timeline. Refine it to add participants and ordered messages.');
  const ids = new Set(seq.participants);
  if (!ids.size || ids.size !== seq.participants.length || seq.participants.some(id => !view.nodes.includes(id) || !model.nodes.some(n => n.id === id))) throw new Error('The sequence timeline has invalid participants. Refine it before rendering.');
  for (const [i, msg] of seq.messages.entries()) {
    if (msg.seq !== i + 1 || !ids.has(msg.from) || !ids.has(msg.to)) throw new Error('The sequence timeline has invalid message order or participants.');
    if (msg.fragment && (!msg.fragment.covers.length || msg.fragment.covers.some(n => !seq.messages.some(m => m.seq === n)))) throw new Error('The sequence fragment references a missing message.');
  }
  const labelOf = (id: string) => model.nodes.find(n => n.id === id)!.label;
  const headers = seq.participants.map(id => linesOf(labelOf(id), 26));
  const col = 320, margin = 64, headerY = 28;
  const headerH = Math.max(48, ...headers.map(lines => lines.length * 18 + 44));
  const top = headerY + headerH + 48;
  const xOf = (id: string) => margin + seq.participants.indexOf(id) * col + col / 2;
  const fragments = [...new Map(seq.messages.flatMap(msg => {
    if (!msg.fragment) return [];
    const covers = [...new Set(msg.fragment.covers)].sort((a, b) => a - b);
    return [[JSON.stringify([msg.fragment.type, covers]), { type: msg.fragment.type, covers, first: covers[0]! }] as const];
  })).values()];
  const tabsPerRow = Math.max(1, Math.floor((margin * 2 + seq.participants.length * col - 40) / 56));
  const countAt = (n: number) => fragments.filter(fragment => fragment.first === n).length;
  let cursor = top;
  const rows = seq.messages.map(msg => {
    const self = msg.from === msg.to;
    const lines = linesOf(`${msg.seq}. ${msg.label}`, self ? 18 : 36);
    const padding = countAt(msg.seq) ? Math.ceil(countAt(msg.seq) / tabsPerRow) * 22 + 12 : 0;
    const row = { msg, lines, bandTop: cursor, top: cursor + padding, y: cursor + padding + lines.length * 18, bottom: cursor + padding + lines.length * 18 + (self ? 64 : 46) };
    cursor = row.bottom;
    return row;
  });
  const width = margin * 2 + seq.participants.length * col;
  const height = Math.max(cursor + 40, top + 100);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="sequence-title sequence-desc" font-family="Inter, sans-serif" font-size="13">`,
    `<title id="sequence-title">${escapeXml(model.title)} — sequence diagram</title><desc id="sequence-desc">${seq.participants.length} participants and ${seq.messages.length} messages, ordered from top to bottom. Solid arrows are calls, dashed arrows are returns, open solid arrows are asynchronous messages.</desc>`,
    '<defs><marker id="sequence-call" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#5eead4"/></marker><marker id="sequence-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10" fill="none" stroke="#5eead4" stroke-width="1.5"/></marker><marker id="sequence-return" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10" fill="none" stroke="#a6b4cf" stroke-width="1.5"/></marker></defs>',
    `<rect width="${width}" height="${height}" fill="#0d1526"/>`];
  for (const [i, id] of seq.participants.entries()) {
    const x = xOf(id);
    const provenance = PROVENANCE_STYLE[model.nodes.find(n => n.id === id)!.provenance];
    parts.push(`<g data-participant="${escapeXml(id)}"><title>${escapeXml(labelOf(id))}</title><rect x="${x - col / 2 + 16}" y="${headerY}" width="${col - 32}" height="${headerH}" rx="9" fill="${provenance.bg}" stroke="${provenance.border}"/>${textAt(x, headerY + 24, headers[i]!)}<text x="${x}" y="${headerY + headerH - 10}" text-anchor="middle" fill="${provenance.border}" font-size="11">${provenance.badge}</text></g>`,
      `<line data-lifeline="${escapeXml(id)}" x1="${x}" y1="${headerY + headerH}" x2="${x}" y2="${height - 24}" stroke="#52617e" stroke-dasharray="4 4"/>`);
  }
  const tabsAt = new Map<number, number>();
  for (const fragment of fragments) {
    const covered = rows.filter(row => fragment.covers.includes(row.msg.seq));
    const y = Math.min(...covered.map(row => row.bandTop)) - 6;
    const bottom = Math.max(...covered.map(row => row.bottom)) - 12;
    const slot = tabsAt.get(fragment.first) ?? 0;
    tabsAt.set(fragment.first, slot + 1);
    const tabX = 20 + (slot % tabsPerRow) * 56;
    const tabY = y + Math.floor(slot / tabsPerRow) * 22;
    parts.push(`<g data-fragment="${escapeXml(fragment.type)}"><rect x="20" y="${y}" width="${width - 40}" height="${bottom - y}" rx="6" fill="none" stroke="#a78bfa"/><rect data-fragment-tab="${escapeXml(fragment.type)}" x="${tabX}" y="${tabY}" width="48" height="20" rx="4" fill="#a78bfa"/><text x="${tabX + 24}" y="${tabY + 14}" text-anchor="middle" fill="#0d1526" font-size="11" font-weight="600">${escapeXml(fragment.type.toUpperCase())}</text></g>`);
  }
  for (const { msg, lines, y } of rows) {
    const x1 = xOf(msg.from), x2 = xOf(msg.to), self = x1 === x2;
    const color = msg.kind === 'return' ? '#a6b4cf' : '#5eead4';
    const marker = msg.kind === 'call' ? 'sequence-call' : msg.kind === 'return' ? 'sequence-return' : 'sequence-open';
    const attrs = `stroke="${color}" stroke-width="1.5" fill="none"${msg.kind === 'return' ? ' stroke-dasharray="6 4"' : ''} marker-end="url(#${marker})"`;
    parts.push(`<g data-message="${msg.seq}" data-kind="${escapeXml(msg.kind)}"><title>${escapeXml(`${msg.seq}. ${labelOf(msg.from)} → ${labelOf(msg.to)}: ${msg.label} (${msg.kind})`)}</title>`,
      self ? `<path data-self-call="true" d="M${x1},${y} h112 v28 h-112" ${attrs}/>` : `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" ${attrs}/>`,
      textAt(self ? x1 + 12 : (x1 + x2) / 2, y - lines.length * 18 + 3, lines, self ? 'start' : 'middle'), '</g>');
  }
  if (!rows.length) parts.push(textAt(width / 2, top + 24, ['No messages recorded in this sequence.']));
  parts.push('</svg>');
  return { svg: parts.join('\n'), width, height };
}
export const sequenceSvg = (model: SystemModel, viewId: string): string => sequenceDiagram(model, viewId).svg;
