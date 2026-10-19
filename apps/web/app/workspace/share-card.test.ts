import { describe, expect, it } from 'vitest';
import { validFullModel, validFullModelExtended } from '@archwoven/model';
import { buildCardSvg } from './share-card';

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('buildCardSvg — privacy surface', () => {
  it('contains node labels but never evidence paths or commit SHAs', () => {
    const m = structuredClone(validFullModelExtended);
    m.nodes[0]!.evidence = [{ repo: 'foo/bar', commit: SHA, path: 'src/main/java/SecretLocation.java', lines: [1, 2] }];
    const svg = buildCardSvg(m, 'view.architecture', 'route', 'actor.user', 'datastore.postgres');
    expect(svg).toContain('API Gateway');
    expect(svg).toContain('1200');
    expect(svg).not.toContain('SecretLocation.java');
    expect(svg).not.toContain(SHA);
    expect(svg).not.toContain('foo/bar');
  });

  it('draws a reach card from one node', () => {
    expect(buildCardSvg(structuredClone(validFullModelExtended), 'view.architecture', 'reach', 'gateway.api')).toContain('API Gateway');
  });
});

describe('card content follows the requested view', () => {
  it('draws a route card only through connections that view shows', () => {
    const m = structuredClone(validFullModel);
    // A hidden shortcut (like an expanded component's internal link) outside every view.
    m.edges.push({ id: 'e.hidden', from: 'actor.user', to: 'datastore.postgres', type: 'sync', provenance: 'inferred', evidence: [] });
    const overview = buildCardSvg(m, 'view.architecture', 'route', 'actor.user', 'datastore.postgres');
    expect(overview).toContain('API Gateway');
    expect(overview).not.toMatch(/\+\d+ more hops/);
    const unscoped = buildCardSvg(m, 'missing-view', 'route', 'actor.user', 'datastore.postgres');
    expect(unscoped).not.toContain('API Gateway');
  });
});
