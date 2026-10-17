import { describe, expect, it } from 'vitest';
import { openDetailView, validFullModel, type SystemModel } from '@archwoven/model';
import { buildSvg } from './export-svg';
import { buildCardSvg } from '../app/api/share-card/card';
import { expandedDetailModel } from '../probes/render/detail-fixture';

const evil = (n: string): string =>
  n === 'actor.user'
    ? '<script>alert(1)</script>'
    : n === 'gateway.api'
      ? '" onerror="fetch(\'//evil.example\')'
      : n === 'svc.orders'
        ? 'javascript:alert(1)'
        : `<img src=x onerror=alert(1)> xlink:href="http://evil.example"`;

const maliciousModel = (): SystemModel => {
  const m = structuredClone(validFullModel) as SystemModel;
  for (const node of m.nodes) node.label = evil(node.id);
  for (const edge of m.edges) edge.label = evil(edge.from ?? edge.id);
  return m;
};

// Executable POSITIONS must be unreachable; inert escaped text inside <text>
// nodes is the expected, harmless outcome (§11: no execution, no remote fetch).
const assertSafe = (svg: string): void => {
  expect(svg).not.toMatch(/<script/i);
  expect(svg).not.toMatch(/<iframe|<img|<image|<foreignObject/i);
  const tags = svg.match(/<[^>]*>/g) ?? [];
  expect(tags.every((t) => !/\son\w+\s*=/i.test(t))).toBe(true); // no event-handler attribute
  expect(tags.every((t) => !/href\s*=/i.test(t))).toBe(true); // no href attribute at all
  expect((svg.match(/url\([^)]*\)/g) ?? []).every((u) => u.startsWith('url(#'))).toBe(true); // fragments only
  // the labels survive as escaped inert text
  expect(svg).toContain('&lt;script&gt;');
  expect(svg).toContain('javascript:alert(1)');
};

describe('scenario 11: malicious labels cannot execute in exports', () => {
  it('buildSvg escapes the full battery', async () => {
    const svg = await buildSvg(maliciousModel(), validFullModel.views[0]!.id);
    assertSafe(svg);
  });

  it('buildCardSvg escapes the full battery (route card)', async () => {
    const m = maliciousModel();
    const svg = buildCardSvg(m, m.views[0]!.id, 'reach', m.nodes[0]!.id);
    assertSafe(svg);
  });

  it('buildCardSvg escapes the full battery (journey card)', () => {
    const m = maliciousModel();
    const svg = buildCardSvg(m, m.views[0]!.id, 'route', m.nodes[0]!.id, m.nodes[2]!.id);
    assertSafe(svg);
  });
});

describe('component detail export context', () => {
  it('marks internal nodes as dashed and names their parent without marking ordinary inferred nodes', async () => {
    const model = expandedDetailModel();
    const svg = await buildSvg(model, 'detail:svc.orders');
    const internal = svg.match(/<g data-node="svc.orders\/intake">[\s\S]*?<\/g>/)![0];
    expect(internal).toMatch(/<rect[^>]+stroke-dasharray="6 4"/);
    expect(internal).toContain('inside Order Service (inferred)');
    const neighbour = svg.match(/<g data-node="gateway.api">[\s\S]*?<\/g>/)![0];
    expect(neighbour).not.toContain('stroke-dasharray');
    const overview = await buildSvg(model, 'view.architecture');
    const parent = overview.match(/<g data-node="svc.orders">[\s\S]*?<\/g>/)![0];
    expect(parent).toContain('· detail');
    expect(parent).not.toContain('stroke-dasharray');
    expect(overview).not.toContain('data-detail-caption');
  });

  it('includes visible inferred context and the source disclaimer only for repository models', async () => {
    const model = expandedDetailModel();
    const caption = (svg: string) => (svg.match(/<g data-detail-caption="true">[\s\S]*?<\/g>/)?.[0] ?? '')
      .replace(/<\/tspan>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const description = caption(await buildSvg(model, 'detail:svc.orders'));
    expect(description).toContain('Inside Order Service (inferred)');
    expect(description).toContain('and its direct connections');
    expect(description).not.toContain('not found in source');
    model.nodes.find(n => n.id === 'gateway.api')!.provenance = 'source-supported';
    expect(caption(await buildSvg(model, 'detail:svc.orders'))).toContain('Internals are inferred, not found in source.');
  });

  it('keeps unexpanded detail views contextual without claiming their nodes are inferred internals', async () => {
    const result = openDetailView(structuredClone(validFullModel), 'svc.orders');
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const svg = await buildSvg(result.model, 'detail:svc.orders');
    const caption = svg.match(/<g data-detail-caption="true">[\s\S]*?<\/g>/)?.[0] ?? '';
    expect(caption).toContain('Order Service and its direct connections');
    expect(caption).not.toContain('(inferred)');
    expect(caption).not.toContain('not found in source');
  });

  it('escapes parent labels in captions and internal-node titles', async () => {
    const model = expandedDetailModel();
    model.nodes.find(n => n.id === 'svc.orders')!.label = '<script>"bad"</script> & parent';
    const svg = await buildSvg(model, 'detail:svc.orders');
    expect(svg).toContain('&lt;script&gt;&quot;bad&quot;&lt;/script&gt; &amp; parent');
    expect(svg).not.toMatch(/<script/i);
    expect(svg.match(/<g data-node="svc.orders\/intake">[\s\S]*?<\/g>/)?.[0]).toContain('inside &lt;script&gt;');
  });

  it('makes the parent and inference disclaimer available in the SVG accessible description', async () => {
    const model = expandedDetailModel();
    model.nodes.find(n => n.id === 'gateway.api')!.provenance = 'source-supported';
    const svg = await buildSvg(model, 'detail:svc.orders');
    const description = svg.match(/<desc>([\s\S]*?)<\/desc>/)?.[1] ?? '';
    expect(description).toContain('Inside Order Service (inferred)');
    expect(description).toContain('not found in source');
  });

  it('does not label a generated component view as a managed drill-down', async () => {
    const model = structuredClone(validFullModel);
    model.views.push({ id: 'view.component', type: 'component-detail', focus: 'svc.orders', nodes: ['svc.orders'], edges: [] });
    const svg = await buildSvg(model, 'view.component');
    expect(svg).not.toContain('data-detail-caption');
    expect(svg).not.toContain('Inside Order Service');
  });
});


describe('truthful boundary exports', () => {
  it('omits a misleading enclosure and visibly discloses membership below a negative-position graph', async () => {
    const model = structuredClone(validFullModel), view = model.views.find(v => v.type === 'architecture')!;
    view.nodes = ['actor.user', 'gateway.api', 'svc.orders']; view.edges = [];
    model.layout = { 'actor.user': { x: -800, y: -500 }, 'gateway.api': { x: -200, y: -500 }, 'svc.orders': { x: -500, y: -500 } };
    model.boundaries = [{ id: 'b.core', label: 'Core <platform> & services', wraps: ['actor.user', 'gateway.api'] }];
    const before = structuredClone(model), svg = await buildSvg(model, view.id);
    expect(svg).not.toContain('stroke="#64748b" stroke-dasharray="6 4"');
    const description = svg.match(/<desc>([\s\S]*?)<\/desc>/)?.[1] ?? '';
    expect(description).toMatch(/Core &lt;platform&gt; &amp; services.*b\.core.*enclosure omitted/);
    expect(description).toContain('Members in this view:');
    const footer = svg.match(/<g data-layout-warnings="true">[\s\S]*?<\/g>/)?.[0] ?? '';
    expect(footer).toContain('enclosure omitted');
    expect(footer).toContain('Members in this view:');
    expect(svg).not.toContain('<platform>');
    const ys = [...footer.matchAll(/<text[^>]* y="([^"]+)"/g)].map(m => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThan(-400);
    const [x, y, width, height] = svg.match(/viewBox="([^"]+)"/)![1]!.split(' ').map(Number) as [number, number, number, number];
    expect(x).toBeLessThan(-800); expect(y).toBeLessThan(-500);
    expect(Math.max(...ys)).toBeLessThan(y + height);
    expect(width).toBeGreaterThan(0);
    expect(model).toEqual(before);
  });

  it('retains truthful boundary enclosures without adding a warning footer', async () => {
    const model = structuredClone(validFullModel), view = model.views.find(v => v.type === 'architecture')!;
    view.nodes = ['actor.user', 'gateway.api']; view.edges = [];
    model.layout = { 'actor.user': { x: 0, y: 0 }, 'gateway.api': { x: 400, y: 0 } };
    model.boundaries = [{ id: 'b.core', label: 'Core services', wraps: view.nodes }];
    const svg = await buildSvg(model, view.id);
    expect(svg).toContain('stroke="#64748b" stroke-dasharray="6 4"');
    expect(svg).not.toContain('data-layout-warnings');
  });
});
