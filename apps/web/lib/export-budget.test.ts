import { expect, it, vi } from 'vitest';
const raster = vi.hoisted(() => ({ render: vi.fn(), free: vi.fn() }));
vi.mock('@resvg/resvg-wasm', () => ({ initWasm: async () => { }, Resvg: class {
        width = 100000;
        height = 100000;
        render = raster.render;
        free = raster.free;
    } }));
import { ensureResvg, renderPng } from '../probes/render/export';
it('rejects excessive raster allocation before rendering and frees its parsed scene', async () => {
    await ensureResvg(new Uint8Array());
    await expect(renderPng('<svg/>', [])).rejects.toThrow('too large');
    expect(raster.render).not.toHaveBeenCalled();
    expect(raster.free).toHaveBeenCalledOnce();
});
