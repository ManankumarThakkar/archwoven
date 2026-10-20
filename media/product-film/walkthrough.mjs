// Deterministic motion illustration. All diagram claims come from recordings.json.
export const duration = 38;
export const chapters = [
  { start: 0, label: 'The result' }, { start: 3, label: 'An idea' },
  { start: 10, label: 'A repository' }, { start: 17, label: 'The evidence' },
  { start: 25, label: 'Your changes' }, { start: 33, label: 'Yours to keep' },
];
const C = { paper: '#f6f2e9', ink: '#18352e', green: '#1e705b', mint: '#a0deca', muted: '#566b5f', dark: '#102722', node: '#203f36', line: '#496c5d', white: '#eff7f1', amber: '#f0cb89' };
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = x => Math.min(1, Math.max(0, x));
const ease = x => 1 - Math.pow(1 - clamp(x), 3);
const mix = (a, b, t) => a + (b - a) * ease(t);
const appear = (t, delay = 0, speed = .65) => ease((t - delay) / speed);
const group = (body, a = 1, x = 0, y = 0) => `<g opacity="${a}" transform="translate(${x} ${y})">${body}</g>`;
function text(value, x, y, size = 32, color = C.ink, opts = '') {
  return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" ${opts}>${esc(value)}</text>`;
}
function lines(values, x, y, size = 32, color = C.ink, gap = 1.25, opts = '') {
  return values.map((v, i) => text(v, x, y + i * size * gap, size, color, opts)).join('');
}
function rect(x, y, w, h, fill, radius = 20, stroke = 'none', extra = '') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" ${extra}/>`;
}
function pill(value, x, y, w, color = C.mint, dark = true) {
  return rect(x, y, w, 42, dark ? '#274b3f' : '#e5ede3', 21) + text(value, x + 18, y + 28, 21, dark ? color : C.green, 'font-weight="600"');
}
function brand(x, y, scale = 1, color = C.ink) {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><svg y="-37" width="44" height="44" viewBox="4 4 32 32" fill="none"><path d="M7 32 18.2 8.7a2 2 0 0 1 3.6 0L33 32" stroke="${color}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.8 24H25a4 4 0 0 0 0-8h-5" stroke="#2caa8c" stroke-width="3.4" stroke-linecap="round"/></svg>${text('rchwoven', 42, 0, 46, color, 'font-weight="600" letter-spacing="-2.4"')}</g>`;
}
function icon(kind, x, y, color) {
  const paths = {
    actor: '<circle cx="14" cy="8" r="5"/><path d="M4 27v-3a10 10 0 0 1 20 0v3"/>',
    gateway: '<path d="m14 1 13 13-13 13L1 14Z M7 14h14 M14 7v14"/>',
    external: '<path d="M17 2h10v10 M27 2 12 17 M12 5H3v22h22v-9"/>',
    datastore: '<ellipse cx="14" cy="5" rx="12" ry="4"/><path d="M2 5v18c0 6 24 6 24 0V5 M2 14c0 6 24 6 24 0"/>',
    service: '<path d="M7 3H2v24h5 M21 3h5v24h-5 M10 18l8-8 M10 10h.1 M18 18h.1"/>',
  };
  return `<g transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[kind] || paths.service}</g>`;
}
function node(n, x, y, w = 300, h = 138, selected = false, label = n.label) {
  return `<g data-node="${esc(n.id)}">${rect(x, y, w, h, selected ? '#315b49' : C.node, 18, selected ? C.mint : '#547866', `stroke-width="${selected ? 2.8 : 1.4}"`)}${icon(n.kind, x + 23, y + 23, selected ? C.mint : '#91bca7')}${text(n.kind.toUpperCase(), x + 67, y + 46, 19, '#bad1c3', 'letter-spacing="1.6"')}${text(label, x + 23, y + 97, 32, C.white, 'font-weight="600" letter-spacing="-.8"')}</g>`;
}
function link(path, label, x, y, p = 1, highlight = false) {
  return `<g opacity="${p}"><path d="${path}" stroke="${highlight ? C.mint : '#82ac96'}" fill="none" stroke-width="${highlight ? 3 : 2}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1 - p}" marker-end="url(#arrow)"/>${text(label, x, y, 22, highlight ? C.mint : '#adc6b7', 'text-anchor="middle"')}</g>`;
}
function checkout(data, t, { compact = false, selected = -1 } = {}) {
  const positions = compact ? [[900, 453], [1350, 453], [1350, 700], [900, 700]] : [[220, 560], [615, 560], [1010, 560], [1405, 560]];
  let s = '';
  const paths = compact ? [
    ['M1200 522h150', 1275, 428], ['M1500 591v109', 1588, 655], ['M1350 769h-150', 1275, 681],
  ] : [['M520 629h95', 568, 535], ['M915 629h95', 963, 535], ['M1310 629h95', 1358, 535]];
  paths.forEach((p, i) => s += link(p[0], compact && i === 1 ? '' : data.description.edges[i].label, p[1], p[2], appear(t, .25 + i * .14), i === 1));
  data.description.nodes.forEach((n, i) => s += group(node(n, ...positions[i], 300, 138, selected === i), appear(t, i * .14), 0, mix(18, 0, (t - i * .14) / .7)));
  return s;
}
function repoPath(data, t, { renamed = false, focus = false } = {}) {
  const ids = ['app.main', 'api.router', 'api.routes.items', 'datastore.postgresql'];
  const labels = ['Includes router', 'Includes items', 'Database session'];
  const positions = focus ? [[185, 480], [600, 480]] : [[220, 555], [615, 555], [1010, 555], [1405, 555]];
  let s = '';
  positions.slice(1).forEach((p, i) => s += link(`M${positions[i][0] + 300} ${p[1] + 69}H${p[0]}`, labels[i], (positions[i][0] + 300 + p[0]) / 2, p[1] - 25, appear(t, .25 + i * .2), focus || i === 1));
  positions.forEach((p, i) => {
    const n = data.repository.nodes.find(n => n.id === ids[i]);
    s += group(node(n, ...p, 300, 138, focus || renamed && i === 2, renamed && i === 2 ? 'Items API' : n.label), appear(t, i * .1), 0, mix(14, 0, (t - i * .1) / .65));
  });
  return s;
}
function stage(title, mode, subtitle = '') {
  return rect(112, 342, 1696, 578, C.dark, 26) + text(title, 152, 398, 25, '#dcece0', 'font-weight="600"') + text(mode, 1768, 397, 21, '#a1bfae', 'text-anchor="end"') + (subtitle ? text(subtitle, 152, 878, 23, '#a1bfae') : '');
}
function header(title, subtitle, n) {
  return text(`0${n} / ${chapters[n - 1].label.toUpperCase()}`, 116, 147, 21, C.green, 'font-weight="600" letter-spacing="2"') + text(title, 112, 238, 77, C.ink, 'font-weight="600" letter-spacing="-3.5"') + text(subtitle, 115, 292, 29, C.muted);
}
function opening(data, t) {
  const s = header('Make the system make sense.', 'Architecture you can explore, question and make your own.', 1);
  const focus = 1 + .035 * ease(t / 3);
  const flow = clamp((t - .3) / 2.1);
  const dot = flow > 0 && flow < 1 ? `<circle cx="${mix(527, 1400, flow)}" cy="629" r="5" fill="${C.mint}"/>` : '';
  return s + stage('Checkout architecture', 'FROM A DESCRIPTION', '4 components · 3 connections · recorded model') + `<g transform="translate(960 629) scale(${focus}) translate(-960 -629)">${checkout(data, t + 2, { selected: 2 })}${dot}</g>`;
}
function idea(data, t) {
  const q = t > 4.8;
  let s = header('Give an idea its shape.', 'Start with a description. Keep its unanswered questions visible.', 2);
  s += rect(112, 342, 650, 578, '#e8ebdf', 26);
  s += text('YOUR DESCRIPTION', 153, 402, 22, C.green, 'font-weight="600" letter-spacing="1.8"');
  ['A checkout flow:', 'customers hit an API gateway', 'routed to an order service', 'which charges Stripe.'].forEach((line, i) => s += group(text(line, 153, 479 + i * 51.15, 33, C.ink), appear(t, i * .22)));
  s += pill('From your description', 153, 740, 274, C.mint, false);
  s += text('Recorded output · generation condensed', 153, 855, 22, C.muted);
  s += rect(800, 342, 1008, 578, C.dark, 26) + text('CHECKOUT FLOW', 842, 398, 22, C.mint, 'letter-spacing="1.7"');
  s += checkout(data, t, { compact: true });
  if (q) s += group(rect(839, 838, 920, 55, '#394838', 12) + text('Open question: how is payment confirmed?', 862, 874, 25, C.amber), appear(t, 4.8));
  return s;
}
function repository(data, t) {
  let s = header('Find the structure in your code.', 'A second starting point: a public GitHub repository.', 3);
  s += stage('fastapi/full-stack-fastapi-template', 'FROM A REPOSITORY', 'Selected architecture path · recorded analysis at b1125d8');
  s += group(pill('SOURCE-SUPPORTED', 154, 438, 288), appear(t, .15));
  s += repoPath(data, t);
  s += group(text('Code is read without executing the repository.', 960, 799, 29, '#bfdbca', 'text-anchor="middle"'), appear(t, 2));
  return s;
}
function evidence(data, t) {
  const e = data.repository.edges.find(e => e.id === 'e.app.router').evidence[0];
  let s = header('See what supports a connection.', 'Inspect the claim, its source and the limits of the analysis.', 4);
  s += rect(112, 342, 1696, 578, C.dark, 26);
  const move = ease(t / 1.15);
  s += text('FASTAPI · SELECTED RELATIONSHIP', 154, 404, 22, C.mint, 'letter-spacing="1.4"');
  s += group(repoPath(data, t + 1, { focus: true }), 1, mix(100, 0, move), mix(80, 0, move));
  s += group(rect(980, 379, 786, 496, '#f5f3ea', 20) + pill('Supported by source', 1017, 414, 268, C.mint, false) + text(e.path, 1017, 509, 31, C.ink, 'font-weight="600" letter-spacing="-.5"') + text(`LINE ${e.lines[0]}  /  COMMIT ${e.commit.slice(0, 7)}`, 1017, 553, 22, C.muted, 'letter-spacing="1"') + rect(1017, 586, 710, 140, '#e5e9de', 12) + lines(['app.include_router(', '    api_router,', '    prefix=settings.API_V1_STR)'], 1040, 622, 26, C.ink, 1.4, 'font-family="ui-monospace, monospace"'), appear(t, .35), mix(45, 0, (t - .35) / .8));
  s += group(lines(['Declared defaults are visible.', 'Environment overrides are not verified.'], 1017, 784, 25, C.green, 1.4), appear(t, 3.2));
  s += group(text('Evidence supports this code relationship.', 187, 725, 28, '#bfd7c7') + text('It does not verify runtime behaviour.', 187, 771, 25, '#9fbda9'), appear(t, 2));
  return s;
}
function edit(data, t) {
  const renamed = t >= 1.8 && t < 5.6;
  const undone = t >= 5.6;
  let s = header('Make the picture yours.', 'Rename a component. Undo the change. Keep the underlying evidence.', 5);
  s += stage('fastapi/full-stack-fastapi-template', 'DIAGRAM EDIT', 'Illustrated interaction · original source evidence retained');
  s += repoPath(data, t + 1, { renamed });
  const input = renamed ? 'Items API' : 'items-router';
  s += group(rect(871, 745, 502, 119, '#f1f0e6', 15) + text('DISPLAY NAME', 899, 781, 18, C.green, 'font-weight="600" letter-spacing="1.4"') + text(input, 899, 828, 32, C.ink, 'font-weight="600"') + text(undone ? '↶ Restored' : renamed ? '✓ Renamed' : 'Rename', 1345, 822, 23, C.green, 'text-anchor="end"'), appear(t, .15));
  return s;
}
function ending(data, t) {
  let s = `<path d="M-80 700C300 700 220 370 590 370H785C1040 370 905 774 1275 774H2020" fill="none" stroke="#c6d4bd" stroke-width="2" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1 - appear(t, 0, 1.8)}"/>`;
  s += group(brand(240, 460, 2.6) + lines(['Your next system,', 'made clearer.'], 240, 613, 76, C.ink, 1.12, 'font-weight="600" letter-spacing="-3"') + text('archwoven.dev', 243, 854, 34, C.green, 'font-weight="600"'), appear(t, .1));
  ['SVG', 'PNG', 'JSON'].forEach((format, i) => {
    s += group(rect(1230 + i * 32, 397 + i * 132, 338, 102, i === 1 ? C.dark : '#e4e9dc', 17, '#c3cebd') + text(format, 1259 + i * 32, 459 + i * 132, 36, i === 1 ? C.white : C.ink, 'font-weight="600"') + text('↓', 1529 + i * 32, 459 + i * 132, 36, i === 1 ? C.mint : C.green), appear(t, .45 + .17 * i), 0, mix(20, 0, (t - .45 - i * .17) / .7));
  });
  s += group(rect(240, 755, 393, 66, C.dark, 12) + text('Open the workspace', 267, 799, 27, C.white, 'font-weight="600"') + text('↗', 581, 800, 32, C.mint) + text('No account needed', 675, 799, 25, C.muted), appear(t, 1.1));
  return s;
}
export function renderFilm(data, time) {
  const t = Math.min(duration - .001, Math.max(0, Number(time) || 0));
  const index = chapters.findLastIndex(c => t >= c.start);
  const local = t - chapters[index].start;
  const body = [opening, idea, repository, evidence, edit, ending][index](data, local);
  const transition = index === 0 ? 1 : appear(local, 0, .35);
  const base = rect(0, 0, 1920, 1080, C.paper, 0) + `<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="m1 1 7 4-7 4" fill="none" stroke="#9ac8ad" stroke-width="1.3"/></marker></defs>`;
  let footer = '<path d="M112 973H1808" stroke="#ccd1c2"/>';
  chapters.forEach((c, i) => {
    const x = 112 + i * 282.7;
    footer += rect(x, 973, 264, 3, i <= index ? C.green : '#ccd1c2', 0) + text(c.label, x, 1016, 21, i === index ? C.green : '#5e7062', i === index ? 'font-weight="600"' : '');
  });
  footer += text('Motion illustration · recorded real-provider outputs', 1808, 1054, 18, C.muted, 'text-anchor="end"');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080" role="img" aria-label="${esc(chapters[index].label)}" style="font-family:Inter,Arial,sans-serif">${base}${brand(113, 79, .78)}${text('IDEAS → ARCHITECTURE ← CODE', 1808, 74, 19, C.muted, 'text-anchor="end" letter-spacing="1.6"')}${group(body, transition, 0, (1 - transition) * 10)}${footer}</svg>`;
}
