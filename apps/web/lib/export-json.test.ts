import { describe, expect, it } from 'vitest';
import { SystemModelSchema, validFullModel, validFullModelExtended, validateModel, type SystemModel } from '@archwoven/model';
import { modelJson, modelJsonFileName, sourceReferences } from './export-json';

const SHA = 'd66599cceb3a151f64d45eb1cc46afe59c386c1f';

/** Private repository map: source-referenced evidence on a node and an edge, manual layout, LR orientation. */
const repositoryModel = (): SystemModel => {
  const m = structuredClone(validFullModelExtended);
  m.privacy = { classification: 'private', boundary: 'local-only' };
  m.nodes[0]!.evidence = [{ repo: 'local/archwoven', commit: SHA, path: 'packages/jobs/src/queue.ts', lines: [1, 42], note: 'Sampled source module; deployed service boundaries are not established.' }];
  m.edges[0]!.evidence = [{ path: 'packages/jobs/src/queue.ts', lines: [3, 3], note: 'Static import; runtime invocation is not established.' }];
  m.layout = { [m.nodes[0]!.id]: { x: 120.5, y: -40 } };
  m.views[0]!.orientation = 'LR';
  return m;
};

const parse = (text: string): SystemModel => SystemModelSchema.parse(JSON.parse(text));

describe('full model JSON', () => {
  it.each([
    ['described model with note-only evidence', validFullModel],
    ['model with semantics, boundaries and guided views', validFullModelExtended],
    ['private repository map with manual layout', repositoryModel()],
  ])('round-trips the %s without loss and stays valid', (_name, model) => {
    const text = modelJson(model, 'full');
    expect(JSON.parse(text)).toEqual(model);
    expect(parse(text)).toEqual(model);
    expect(validateModel(JSON.parse(text)).ok).toBe(true);
  });

  it('keeps every source reference, layout coordinate and orientation', () => {
    const exported = parse(modelJson(repositoryModel(), 'full'));
    expect(exported.nodes[0]!.evidence[0]).toEqual({ repo: 'local/archwoven', commit: SHA, path: 'packages/jobs/src/queue.ts', lines: [1, 42], note: 'Sampled source module; deployed service boundaries are not established.' });
    expect(exported.layout).toEqual({ [exported.nodes[0]!.id]: { x: 120.5, y: -40 } });
    expect(exported.views[0]!.orientation).toBe('LR');
  });

  it('is readable text ending in a newline', () => {
    const text = modelJson(validFullModel, 'full');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.split('\n')[1]).toMatch(/^ {2}"schemaVersion": "1",$/);
  });
});

describe('model JSON without evidence', () => {
  it('empties every node and edge evidence list and changes nothing else', () => {
    const model = repositoryModel();
    const exported = parse(modelJson(model, 'no-evidence'));
    expect(exported.nodes.every((n) => n.evidence.length === 0)).toBe(true);
    expect(exported.edges.every((e) => e.evidence.length === 0)).toBe(true);
    const strip = (m: SystemModel) => ({ ...m, nodes: m.nodes.map(({ evidence: _e, ...n }) => n), edges: m.edges.map(({ evidence: _e, ...e }) => e) });
    expect(strip(exported)).toEqual(strip(model));
    expect(validateModel(JSON.parse(modelJson(model, 'no-evidence'))).ok).toBe(true);
  });

  it('leaves no repository, commit, path or line text in the file', () => {
    const text = modelJson(repositoryModel(), 'no-evidence');
    expect(text).not.toContain(SHA);
    expect(text).not.toContain('local/archwoven');
    expect(text).not.toContain('queue.ts');
    expect(text).not.toMatch(/"(repo|commit|path|lines)"/);
  });

  it('keeps provenance so source-supported items still say where they came from', () => {
    const model = repositoryModel();
    model.nodes[0]!.provenance = 'source-supported';
    expect(parse(modelJson(model, 'no-evidence')).nodes[0]!.provenance).toBe('source-supported');
  });

  it('does not modify the model shown in the workspace', () => {
    const model = repositoryModel();
    const before = structuredClone(model);
    modelJson(model, 'no-evidence');
    expect(model).toEqual(before);
  });
});

describe('source references', () => {
  it('reports none for note-only evidence, so the full file is already share-safe', () => {
    expect(sourceReferences(validFullModel)).toEqual({ present: false, repos: [] });
  });

  it('detects repository references and lists each repository once', () => {
    const model = repositoryModel();
    model.edges[1]!.evidence = [{ repo: 'local/archwoven', path: 'a.ts' }];
    expect(sourceReferences(model)).toEqual({ present: true, repos: ['local/archwoven'] });
  });

  it.each([
    ['commit', { commit: SHA }],
    ['path', { path: 'src/app.py' }],
    ['lines', { lines: [4, 9] }],
  ])('treats a lone %s as a source reference', (_field, evidence) => {
    const model = structuredClone(validFullModel);
    model.edges[0]!.evidence = [evidence];
    expect(sourceReferences(model)).toEqual({ present: true, repos: [] });
  });

  it('ignores null reference fields', () => {
    const model = structuredClone(validFullModel);
    model.nodes[0]!.evidence = [{ repo: null, commit: null, path: null, lines: null, note: 'stated by user' }];
    expect(sourceReferences(model).present).toBe(false);
  });
});

describe('model JSON file name', () => {
  const titled = (title: string, revision = 7): SystemModel => ({ ...validFullModel, title, revision });

  it.each([
    ['E-commerce Platform', 'archwoven-e-commerce-platform-r7.json'],
    ['  Café / Orders: v2!  ', 'archwoven-cafe-orders-v2-r7.json'],
    ['订单系统', 'archwoven-model-r7.json'],
    ['---', 'archwoven-model-r7.json'],
    ['../../etc/passwd', 'archwoven-etc-passwd-r7.json'],
  ])('slugs %j as %s', (title, expected) => {
    expect(modelJsonFileName(titled(title), 'full')).toBe(expected);
  });

  it('caps long titles at 60 characters without a trailing hyphen', () => {
    const name = modelJsonFileName(titled(`${'a'.repeat(59)} bcd`), 'full');
    expect(name).toBe(`archwoven-${'a'.repeat(59)}-r7.json`);
  });

  it('marks the evidence-free file and keeps the revision so downloads never collide', () => {
    expect(modelJsonFileName(titled('Orders', 12), 'no-evidence')).toBe('archwoven-orders-r12-no-evidence.json');
  });
});
