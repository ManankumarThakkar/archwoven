// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductPreview } from './ProductPreview';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.stubGlobal('fetch', () => { throw new Error('A product preview must never request inference'); });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
const click = async (text: string) => { await act(() => button(text).click()); };

it('leaves the recorded preview still until requested and lets readers inspect each step', async () => {
  await act(() => root.render(<ProductPreview />));
  await act(() => vi.advanceTimersByTime(30_000));
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain('Describe');
  await click('Explore');
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain('Explore');
  expect(host.querySelector('[role="status"]')?.textContent).toContain('connection');
  await click('Keep');
  expect(host.querySelector('a[download]')?.getAttribute('href')).toBe('/examples/catalog-architecture.svg');
});

it('plays a finite walkthrough, pauses, and stops on the last step', async () => {
  await act(() => root.render(<ProductPreview />));
  await click('Play walkthrough');
  await act(() => vi.advanceTimersByTime(8_000));
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain('Explore');
  await click('Pause');
  await act(() => vi.advanceTimersByTime(16_000));
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain('Explore');
  await click('Resume');
  await act(() => vi.advanceTimersByTime(8_000));
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain('Keep');
  await act(() => vi.advanceTimersByTime(8_000));
  expect(button('Replay walkthrough')).toBeTruthy();
  await act(() => vi.advanceTimersByTime(30_000));
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain('Keep');
});

it('resumes the remaining time in a step and starts a full walkthrough after manual inspection', async () => {
  await act(() => root.render(<ProductPreview />));
  await click('Play walkthrough');
  await act(() => vi.advanceTimersByTime(5_000));
  await click('Pause');
  await act(() => vi.advanceTimersByTime(20_000));
  await click('Resume');
  await act(() => vi.advanceTimersByTime(2_999));
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain('Describe');
  await act(() => vi.advanceTimersByTime(1));
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain('Explore');
  await click('Explore');
  await click('Play walkthrough');
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain('Describe');
});

it('keeps server-only controls disabled while the recorded example stays downloadable', () => {
  host.innerHTML = renderToStaticMarkup(<ProductPreview />);
  expect([...host.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
  expect(host.querySelector('a[download]')?.getAttribute('href')).toBe('/examples/catalog-architecture.svg');
});
