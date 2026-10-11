import { describe, expect, it } from 'vitest';
import { validFullModel, type SystemModel } from '@archwoven/model';
import { buildSvg } from './export-svg';
import { buildCardSvg } from '../app/api/share-card/card';

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
