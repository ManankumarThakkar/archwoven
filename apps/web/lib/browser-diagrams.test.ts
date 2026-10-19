import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModel, type SystemModel } from '@archwoven/model';
import { deleteBrowserDiagram, latestBrowserDiagram, loadBrowserDiagram, MAX_BROWSER_DIAGRAMS, saveBrowserDiagram } from './browser-diagrams';

class MemoryStorage implements Storage {
  map = new Map<string, string>();
  quota = Infinity;
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.get(key) ?? null; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) {
    const used = [...this.map].reduce((sum, [k, v]) => sum + (k === key ? 0 : v.length), 0);
    if (used + value.length > this.quota) throw new DOMException('full', 'QuotaExceededError');
    this.map.set(key, value);
  }
}
const model = (title = 'Shop', revision = 1): SystemModel => ({ ...structuredClone(validFullModel) as SystemModel, title, revision, parentId: revision > 1 ? revision - 1 : null });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let storage: MemoryStorage;
let clock = 1_000;
const now = () => ++clock;

describe('diagrams kept in this browser', () => {
  beforeEach(() => { storage = new MemoryStorage(); clock = 1_000; });

  it('keeps the latest accepted revision of each diagram and reads it back validated', () => {
    expect(saveBrowserDiagram(id(1), model('Shop', 1), storage, now)).toBe('saved');
    expect(saveBrowserDiagram(id(1), model('Shop renamed', 2), storage, now)).toBe('saved');
    expect(loadBrowserDiagram(id(1), storage)).toEqual({ model: model('Shop renamed', 2) });
    expect(latestBrowserDiagram(storage)).toBe(id(1));
  });

  it(`keeps at most ${MAX_BROWSER_DIAGRAMS} diagrams, forgetting the least recently saved`, () => {
    for (let n = 1; n <= MAX_BROWSER_DIAGRAMS + 1; n++) saveBrowserDiagram(id(n), model(`Diagram ${n}`), storage, now);
    expect(loadBrowserDiagram(id(1), storage)).toBeNull();
    expect(loadBrowserDiagram(id(2), storage)).not.toBeNull();
    expect(latestBrowserDiagram(storage)).toBe(id(MAX_BROWSER_DIAGRAMS + 1));
  });

  it('discards a copy that cannot be read, including one saved by an incompatible version', () => {
    saveBrowserDiagram(id(1), model(), storage, now);
    const key = [...storage.map.keys()].find(k => k.includes(id(1)))!;
    storage.map.set(key, '{not json');
    expect(loadBrowserDiagram(id(1), storage)).toEqual({ problem: 'unreadable' });
    expect(storage.map.has(key)).toBe(false);
    saveBrowserDiagram(id(2), model(), storage, now);
    const second = [...storage.map.keys()].find(k => k.includes(id(2)))!;
    storage.map.set(second, JSON.stringify({ v: 1, model: { title: 'missing everything' } }));
    expect(loadBrowserDiagram(id(2), storage)).toEqual({ problem: 'unreadable' });
    storage.map.set(second, JSON.stringify({ v: 99, model: model() }));
    expect(loadBrowserDiagram(id(2), storage)).toEqual({ problem: 'unreadable' });
  });

  it('makes room by forgetting older diagrams when storage is full, and reports when it cannot', () => {
    const size = JSON.stringify(model()).length;
    storage.quota = size * 2.5;
    saveBrowserDiagram(id(1), model('One'), storage, now);
    saveBrowserDiagram(id(2), model('Two'), storage, now);
    expect(saveBrowserDiagram(id(3), model('Three'), storage, now)).toBe('saved');
    expect(loadBrowserDiagram(id(1), storage)).toBeNull();
    expect(loadBrowserDiagram(id(3), storage)).not.toBeNull();
    storage.quota = 10;
    expect(saveBrowserDiagram(id(4), model('Four'), storage, now)).toBe('full');
  });

  it('refuses diagrams too large to keep', () => {
    expect(saveBrowserDiagram(id(1), { ...model(), title: 'x'.repeat(600_000) }, storage, now)).toBe('too-large');
  });

  it('reports blocked storage instead of failing', () => {
    const blocked = new Proxy({}, { get() { throw new DOMException('denied', 'SecurityError'); } }) as Storage;
    expect(saveBrowserDiagram(id(1), model(), blocked, now)).toBe('unavailable');
    expect(loadBrowserDiagram(id(1), blocked)).toBeNull();
    expect(latestBrowserDiagram(blocked)).toBeNull();
    expect(() => deleteBrowserDiagram(id(1), blocked)).not.toThrow();
  });

  it('forgets a deleted diagram', () => {
    saveBrowserDiagram(id(1), model(), storage, now);
    deleteBrowserDiagram(id(1), storage);
    expect(loadBrowserDiagram(id(1), storage)).toBeNull();
    expect(latestBrowserDiagram(storage)).toBeNull();
  });
});
