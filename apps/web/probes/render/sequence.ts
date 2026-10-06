import type { SystemModel, View } from '@archwoven/model';

const COLORS = {
  text: '#e6edf7',
  dim: '#8b98b8',
  accent: '#5eead4',
  line: '#3b4763',
  fragment: '#a78bfa',
  bg: '#0d1526',
};

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Pure model → SVG string for the sequence view (SPEC §1: custom SVG renderer).
 * No foreignObject, no remote refs — resvg-safe by construction.
 */
export function sequenceSvg(model: SystemModel, viewId: string): string {
  const view: View | undefined = model.views.find((v) => v.id === viewId);
  const seq = view?.sequence;
  if (!view || !seq) throw new Error(`view ${viewId} is not a sequence view`);

  const labelOf = (id: string) => model.nodes.find((n) => n.id === id)?.label ?? id;
  const colWidth = Math.max(
    160,
    ...seq.participants.map((p) => labelOf(p).length * 8.5 + 48),
  );
  const marginX = 40;
  const headerY = 24;
  const headerH = 34;
  const rowStep = 46;
  const top = headerY + headerH + 20;

  const xOf = (participant: string) =>
    marginX + seq.participants.indexOf(participant) * colWidth + colWidth / 2;

  const height = top + seq.messages.length * rowStep + 40;
  const width = marginX * 2 + seq.participants.length * colWidth;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, sans-serif" font-size="13">`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="${COLORS.bg}"/>`);

  // participant headers + lifelines
  for (const p of seq.participants) {
    const cx = xOf(p);
    parts.push(
      `<rect x="${cx - colWidth / 2 + 10}" y="${headerY}" width="${colWidth - 20}" height="${headerH}" rx="8" fill="#16213b" stroke="${COLORS.line}"/>`,
    );
    parts.push(
      `<text x="${cx}" y="${headerY + 22}" text-anchor="middle" fill="${COLORS.text}" font-weight="600">${escapeXml(labelOf(p))}</text>`,
    );
    parts.push(
      `<line x1="${cx}" y1="${headerY + headerH}" x2="${cx}" y2="${height - 24}" stroke="${COLORS.line}" stroke-dasharray="4 4"/>`,
    );
  }

  // fragment bands (drawn under messages)
  const yOfSeq = (s: number) => top + seq.messages.findIndex((m) => m.seq === s) * rowStep;
  for (const msg of seq.messages) {
    if (!msg.fragment) continue;
    const ys = msg.fragment.covers.map(yOfSeq).filter((y) => !Number.isNaN(y));
    if (ys.length === 0) continue;
    const minX = Math.min(...seq.participants.map(xOf)) - colWidth / 2 + 10;
    const maxX = Math.max(...seq.participants.map(xOf)) + colWidth / 2 - 10;
    const y0 = Math.min(...ys) - 18;
    const y1 = Math.max(...ys) + 24;
    parts.push(
      `<rect x="${minX}" y="${y0}" width="${maxX - minX}" height="${y1 - y0}" fill="none" stroke="${COLORS.fragment}" stroke-width="1.5" rx="6"/>`,
    );
    parts.push(
      `<rect x="${minX}" y="${y0}" width="34" height="18" fill="${COLORS.fragment}" rx="4"/>`,
      `<text x="${minX + 17}" y="${y0 + 13}" text-anchor="middle" fill="#0d1526" font-size="11" font-weight="600">${escapeXml(msg.fragment.type.toUpperCase())}</text>`,
    );
  }

  // messages
  for (const msg of seq.messages) {
    const y = yOfSeq(msg.seq);
    const x1 = xOf(msg.from);
    const x2 = xOf(msg.to);
    const dashed = msg.kind === 'return' || msg.kind === 'async';
    parts.push(
      `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${msg.kind === 'return' ? COLORS.dim : COLORS.accent}" stroke-width="1.5" ${dashed ? 'stroke-dasharray="6 4"' : ''} marker-end="url(#arrow)"/>`,
    );
    parts.push(
      `<text x="${(x1 + x2) / 2}" y="${y - 8}" text-anchor="middle" fill="${COLORS.text}">${escapeXml(`${msg.seq}. ${msg.label}`)}</text>`,
    );
  }

  parts.push(
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${COLORS.accent}"/></marker></defs>`,
  );
  parts.push('</svg>');
  return parts.join('\n');
}
