import { describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { buildSvg } from './export-svg';
import { nodeSize } from './layout';
import { entityLayout } from './entity';
import { textWidth } from './svg-text';

describe('ER product rendering', () => {
  it('keeps ordinary field names and types on one line when the bundled font fits', () => {
    const entity = structuredClone(validFullModel.nodes.find(n => n.id === 'entity.user')!);
    entity.fields = [{ name: 'display_name', type: 'VARCHAR(320)' }];
    const box = entityLayout(entity);
    expect(box.rows[0]!.name).toEqual(['display_name']);
    expect(box.rows[0]!.type).toEqual(['VARCHAR(320)']);
  });
  it('bounds wide-glyph lines within each field/type/header column', () => {
    const entity = structuredClone(validFullModel.nodes.find(n => n.id === 'entity.user')!);
    entity.label = 'W'.repeat(42); entity.fields = [{ name: 'W'.repeat(22), type: 'W'.repeat(16) }];
    const box = entityLayout(entity);
    // The shared advance estimate is also checked against actual resvg font
    // geometry in the rasterizer tests.
    expect(box.label.every(line => textWidth(line, 13) <= box.width - 28)).toBe(true);
    expect(box.rows.every(row => row.name.every(line => textWidth(line, 12) <= 160))).toBe(true);
    expect(box.rows.every(row => row.type.every(line => textWidth(line, 12) <= 124))).toBe(true);
  });
  it('exports every field, type, key and relationship cardinality', async () => {
    const m = structuredClone(validFullModel);
    m.nodes.find(n => n.id === 'entity.user')!.fields!.push({ name: 'email', type: 'varchar(320)', key: 'uk' });
    const svg = await buildSvg(m, 'view.er');
    expect(svg).toContain('varchar(320)');
    expect(svg).toContain('PK'); expect(svg).toContain('FK'); expect(svg).toContain('UK');
    expect(svg).toContain('1:N'); expect(svg).toContain('N:M');
    expect(svg).toContain('er-many'); expect(svg).toContain('er-one');
    expect(svg).not.toContain('marker-end="url(#arrow)"');
  });
  it('preserves long names/types without clipping rows and escapes untrusted text', async () => {
    const m = structuredClone(validFullModel); const entity = m.nodes.find(n => n.id === 'entity.user')!;
    const before = nodeSize(m, entity.id);
    entity.fields = [{ name: 'a_very_long_field_name_that_must_wrap_to_keep_the_whole_identifier', type: 'DECIMAL(precision_and_scale_with_a_long_annotation)', key: 'pk' }, { name: '<script>alert(1)</script>', type: '" onclick="bad' }];
    const after = nodeSize(m, entity.id);
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.width).toBeGreaterThanOrEqual(300);
    const svg = await buildSvg(m, 'view.er');
    expect(svg).toContain('<tspan'); expect(svg).toContain('&lt;script'); expect(svg).not.toContain('<script>');
    expect(svg.match(/<[^>]+>/g)!.every(tag => !/\son\w+=|href=/.test(tag))).toBe(true);
  });
  it('states missing fields/cardinality honestly instead of inventing metadata', async () => {
    const m = structuredClone(validFullModel); m.nodes.find(n => n.id === 'entity.user')!.fields = [];
    m.edges.find(e => e.id === 'er.user-order')!.cardinality = null;
    const svg = await buildSvg(m, 'view.er');
    expect(svg).toContain('No fields provided');
    expect(svg).toContain('cardinality unspecified');
  });
});
