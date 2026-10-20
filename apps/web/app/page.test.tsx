import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import Home from './page';

afterEach(() => vi.unstubAllGlobals());
it('serves a useful landing page without browser JavaScript or provider requests', () => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', () => { throw new Error('Landing content must not need an API request'); });
  const html = renderToStaticMarkup(<Home />);
  expect(html).toContain('<h1');
  expect(html).toContain('architecture diagrams');
  expect(html).toContain('href="/workspace"');
  expect(html).toContain('Open workspace');
  expect(html).toContain('Read the film summary');
  expect(html).toContain('Recorded examples');
  expect(html).toContain('Built by');
  expect(html).toContain('https://github.com/ManankumarThakkar/archwoven');
  expect(html).toContain('https://www.linkedin.com/in/mananthakkar20/');
});
