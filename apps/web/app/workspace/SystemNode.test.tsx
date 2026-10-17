// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Position } from '@xyflow/react';
import { SystemNode } from './SystemNode';
vi.mock('@xyflow/react', async importOriginal => ({ ...(await importOriginal<typeof import('@xyflow/react')>()), Handle: () => null }));

it('marks internals and expanded components without changing the label text', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const node = { id: 'svc.orders/intake', kind: 'component' as const, label: 'Order Intake', provenance: 'inferred' as const, evidence: [], group: 'svc.orders' };
  const base = { sourcePosition: Position.Bottom, targetPosition: Position.Top };
  try {
    await act(async () => root.render(<SystemNode data={{ node, ...base, inside: 'Order Service' }} />));
    const box = host.firstElementChild as HTMLElement;
    expect(box.getAttribute('title')).toBe('Order Intake — inside Order Service (inferred)');
    expect(box.style.outline).toContain('dashed');
    expect(host.querySelector('[aria-label="Order Intake, inside Order Service"]')).toBeTruthy();
    const parent = { id: 'svc.orders', kind: 'service' as const, label: 'Order Service', provenance: 'user-specified' as const, evidence: [] };
    await act(async () => root.render(<SystemNode data={{ node: parent, ...base, hasDetail: true }} />));
    expect(host.querySelector('small')!.textContent).toMatch(/· detail$/);
    expect(host.querySelector('[aria-label="Order Service, has inferred internals"]')).toBeTruthy();
    expect((host.firstElementChild as HTMLElement).style.outline).toContain('solid');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
