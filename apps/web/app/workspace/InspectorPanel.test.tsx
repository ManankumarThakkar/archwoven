// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Inspector } from './InspectorPanel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });

describe('Inspector heading', () => {
  it('labels provenance with the same words as the canvas badges', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<Inspector payload={{ id: 'java.ownercontroller', kind: 'node', label: 'OwnerController', provenance: 'source-supported', evidence: [], gaps: [] }} />));
    const heading = host.querySelector('.aw-inspector-heading')!;
    expect(heading.querySelector('strong')?.textContent).toBe('OwnerController');
    expect(heading.querySelector('span')?.textContent).toBe('from source');
    act(() => root.unmount());
  });
});
