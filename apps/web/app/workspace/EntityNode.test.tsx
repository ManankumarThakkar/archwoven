// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { Position } from '@xyflow/react';
import { EntityNode } from './EntityNode';
vi.mock('@xyflow/react', async importOriginal => ({ ...(await importOriginal<typeof import('@xyflow/react')>()), Handle: () => null }));
it('renders full entity fields with key/type columns and honest empty metadata', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const node = structuredClone(validFullModel.nodes.find(n => n.id === 'entity.order')!);
  try {
    await act(async () => root.render(<EntityNode data={{ entity: node, sourcePosition: Position.Bottom, targetPosition: Position.Top }} />));
    expect(host.querySelector('[role="table"]')?.textContent).toContain('user_id');
    expect(host.textContent).toContain('PK'); expect(host.textContent).toContain('FK'); expect(host.textContent).toContain('uuid');
    node.fields = [{ name: '<img src=x onerror=bad>', type: null, key: 'uk' }];
    await act(async () => root.render(<EntityNode data={{ entity: node, sourcePosition: Position.Right, targetPosition: Position.Left }} />));
    expect(host.querySelector('[aria-label="<img src=x onerror=bad>"]')).toBeTruthy(); expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('UK'); expect(host.textContent).toContain('unspecified');
    node.fields = [];
    await act(async () => root.render(<EntityNode data={{ entity: node, sourcePosition: Position.Right, targetPosition: Position.Left }} />));
    expect(host.textContent).toContain('No fields provided');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
