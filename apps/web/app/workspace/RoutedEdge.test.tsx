// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { RoutedEdge } from './RoutedEdge';
it('renders the supplied route and safe caption inside the selectable SVG edge', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<svg><RoutedEdge id="example" markerEnd="url(#graph-arrow-inferred)" data={{ route: { id: 'example', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], label: { x: 20, y: 5, width: 140, height: 44, lines: ['<script>bad</script>', 'Next line'] } } }} /></svg>));
    const path = host.querySelector('.react-flow__edge-path')!;
    expect(path.getAttribute('d')).toBe('M0,0 L100,0 L100,100');
    expect(path.getAttribute('marker-end')).toBe('url(#graph-arrow-inferred)');
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelectorAll('tspan')).toHaveLength(2);
    expect(host.querySelector('[data-edge-label]')?.textContent).toContain('<script>bad</script>');
    expect(host.querySelector('.react-flow__edge-interaction')).toBeTruthy();
    const token = host.querySelector('.aw-flow-token')!;
    expect(token).toBeTruthy();
    expect(token.getAttribute('d')).toBe(path.getAttribute('d'));
    expect(token.getAttribute('aria-hidden')).toBe('true');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
