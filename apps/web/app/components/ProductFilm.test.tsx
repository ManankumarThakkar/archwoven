// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductFilm } from './ProductFilm';

let host: HTMLDivElement, root: Root;
let reduce = false, blocked = false, hidden = false;
let paused: WeakMap<HTMLMediaElement, boolean>;
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  reduce = false; blocked = false; hidden = false; paused = new WeakMap();
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (this: HTMLMediaElement) { return paused.get(this) ?? true; });
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('matchMedia', () => ({ matches: reduce, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    if (blocked) return Promise.reject(new DOMException('Autoplay denied', 'NotAllowedError'));
    paused.set(this, false); this.dispatchEvent(new Event('play')); return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { if (!this.paused) { paused.set(this, true); this.dispatchEvent(new Event('pause')); } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim().endsWith(name))!;
const click = async (name: string) => { await act(() => button(name).click()); };

it('provides a useful still and descriptive alternative before JavaScript runs', () => {
  host.innerHTML = renderToStaticMarkup(<ProductFilm />);
  expect(host.querySelector('video')?.hasAttribute('src')).toBe(false);
  expect(host.querySelector('video')?.getAttribute('poster')).toBeTruthy();
  expect(host.querySelector('details')?.textContent).toContain('Kafka');
  expect([...host.querySelectorAll('button')].every(b => b.disabled)).toBe(true);
});
it('honours reduced motion until the visitor explicitly plays, then restart plays from zero', async () => {
  reduce = true;
  await act(async () => { root.render(<ProductFilm />); });
  expect(host.querySelector('video')?.hasAttribute('src')).toBe(false);
  await click('Play');
  expect(host.querySelector('video')?.getAttribute('src')).toContain('.mp4');
  expect(button('Pause')).toBeTruthy();
  host.querySelector('video')!.currentTime = 17;
  await click('Pause'); await click('Restart');
  expect(host.querySelector('video')!.currentTime).toBe(0);
  expect(button('Pause')).toBeTruthy();
});
it('does not override a manual pause when the tab becomes visible again', async () => {
  await act(async () => { root.render(<ProductFilm />); });
  await click('Pause');
  await act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  await act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  expect(button('Play')).toBeTruthy();
});
it('recovers from blocked autoplay and keeps the alternative available after media failure', async () => {
  blocked = true;
  await act(async () => { root.render(<ProductFilm />); });
  expect(button('Play')).toBeTruthy();
  blocked = false; await click('Play');
  expect(button('Pause')).toBeTruthy();
  await act(() => host.querySelector('video')!.dispatchEvent(new Event('error')));
  expect(host.querySelector('[role="status"]')?.textContent).toContain('summary');
  expect(host.querySelector('details')?.textContent).toContain('FastAPI');
});

it('preserves a native player pause when viewport or visibility changes later', async () => {
  await act(async () => { root.render(<ProductFilm />); });
  await act(() => host.querySelector('video')!.pause());
  await act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  await act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  expect(button('Play')).toBeTruthy();
  // A later native Play action should restore the visitor's playback intent.
  await act(async () => { await host.querySelector('video')!.play(); });
  expect(button('Pause')).toBeTruthy();
});
