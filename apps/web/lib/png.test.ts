import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCardSvg } from '../app/workspace/share-card';
import { validFullModelExtended } from '@archwoven/model';
import { svgToPng } from './png';

const fromPublic = async (path: string) => new Uint8Array(readFileSync(join(__dirname, '../public', path)));

describe('svgToPng', () => {
  it('renders a share card to PNG with the bundled renderer and fonts, without a server', async () => {
    const svg = buildCardSvg(structuredClone(validFullModelExtended), 'view.architecture', 'route', 'actor.user', 'datastore.postgres');
    const blob = await svgToPng(svg, 1, fromPublic);
    expect(blob.type).toBe('image/png');
    expect([...new Uint8Array(await blob.arrayBuffer()).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('fails when a rendering asset is missing or empty, so callers can explain it', async () => {
    await expect(svgToPng('<svg xmlns="http://www.w3.org/2000/svg"/>', 1, async () => new Uint8Array())).rejects.toThrow(/empty/);
  });
});
