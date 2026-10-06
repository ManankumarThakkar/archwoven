import { describe, expect, it } from 'vitest';
import { SystemModelSchema } from './schema';
import validFull from './fixtures/valid-full.json';
import validNulls from './fixtures/valid-null-optionals.json';

describe('SystemModelSchema', () => {
  it('parses the full valid fixture', () => {
    const r = SystemModelSchema.safeParse(validFull);
    expect(r.success).toBe(true);
  });

  it('accepts omitted optional fields and explicit nulls', () => {
    const r = SystemModelSchema.safeParse(validNulls);
    expect(r.success).toBe(true);
  });

  it('rejects unknown provenance, naming the field', () => {
    const bad = structuredClone(validFull);
    (bad.nodes[0] as { provenance: string }).provenance = 'guessed';
    const r = SystemModelSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes('provenance'))).toBe(true);
    }
  });

  it('rejects unknown node kind', () => {
    const bad = structuredClone(validFull);
    (bad.nodes[1] as { kind: string }).kind = 'blobstore';
    expect(SystemModelSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects schemaVersion other than "1"', () => {
    const bad = structuredClone(validFull);
    (bad as { schemaVersion: string }).schemaVersion = '2';
    expect(SystemModelSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown extra keys (strict)', () => {
    const bad = structuredClone(validFull);
    (bad.nodes[0] as unknown as Record<string, unknown>).hallucinated = true;
    expect(SystemModelSchema.safeParse(bad).success).toBe(false);
  });
});
