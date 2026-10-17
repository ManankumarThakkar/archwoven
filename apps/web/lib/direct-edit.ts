import type { EditOp, SystemModel } from '@archwoven/model';
export const MAX_POSITION = 100000;
export type Point = {
    x: number;
    y: number;
};
export type DirectEdit = {
    type: 'rename';
    target: string;
    label: string;
} | {
    type: 'move';
    positions: Record<string, Point>;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
export const validPosition = (value: unknown): value is Point => object(value) && keys(value, ['x', 'y']) && typeof value.x === 'number' && typeof value.y === 'number' && Number.isFinite(value.x) && Number.isFinite(value.y) && Math.abs(value.x) <= MAX_POSITION && Math.abs(value.y) <= MAX_POSITION;
export function directEditOps(raw: unknown, model: SystemModel): EditOp[] | null {
    if (!object(raw) || !keys(raw, ['baseRevision', 'action']) || raw.baseRevision !== model.revision || !object(raw.action))
        return null;
    const action = raw.action;
    if (action.type === 'rename' && keys(action, ['type', 'target', 'label']) && typeof action.target === 'string' && typeof action.label === 'string') {
        const label = action.label.trim();
        if (!label || label.length > 500 || ![...model.nodes, ...model.edges].some(item => item.id === action.target))
            return null;
        return [{ op: 'update', target: action.target, patch: { label }, baseRevision: model.revision, summary: `Rename to ${label}` }];
    }
    if (action.type === 'move' && keys(action, ['type', 'positions']) && object(action.positions)) {
        const entries = Object.entries(action.positions);
        if (!entries.length || entries.length > 500 || entries.some(([id, point]) => !model.nodes.some(node => node.id === id) || !validPosition(point)))
            return null;
        return entries.map(([target, point]) => ({ op: 'move', target, patch: point as Point, baseRevision: model.revision, summary: 'Move node' }));
    }
    return null;
}
/** Read a bounded body rather than trusting Content-Length or buffering arbitrary input. */
export async function readDirectEdit(req: Request): Promise<unknown> {
    const reader = req.body?.getReader();
    if (!reader)
        throw new Error('Missing edit');
    const decoder = new TextDecoder();
    let text = '', size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > 65536) {
                await reader.cancel();
                throw new Error('Edit too large');
            }
            text += decoder.decode(value, { stream: true });
        }
        return JSON.parse(text + decoder.decode());
    }
    finally {
        reader.releaseLock();
    }
}
