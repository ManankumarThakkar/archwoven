// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RenameForm } from './RenameForm';
it('offers a keyboard form, trims names and blocks empty or busy saves', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
    const host = document.createElement('div'), root = createRoot(host), save = vi.fn();
    document.body.append(host);
    try {
        await act(async () => root.render(<RenameForm id="a" label="API" busy={false} onRename={save}/>));
        const input = host.querySelector('input')!;
        await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '  Renamed API  '); input.dispatchEvent(new Event('input', { bubbles: true })); });
        await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        expect(save).toHaveBeenCalledWith('a', 'Renamed API');
        expect(input.getAttribute('aria-label')).toBe('Element name');
        await act(async () => root.render(<RenameForm id="a" label="API" busy={true} onRename={save}/>));
        expect(host.querySelector('button')!.disabled).toBe(true);
    }
    finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
