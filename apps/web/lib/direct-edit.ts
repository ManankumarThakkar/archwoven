import { applyEditOps, closeDetailView, openDetailView, orientArchitecture, type EditOp, type SystemModel } from '@archwoven/model';
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
} | {
    type: 'orient';
    viewId: string;
    orientation: 'LR' | 'TB';
} | {
    type: 'detail';
    target: string;
} | {
    type: 'close-detail';
    viewId: string;
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
export function orientationEdit(raw: unknown, model: SystemModel): Extract<DirectEdit, { type: 'orient' }> | null {
    if (!object(raw) || !keys(raw, ['baseRevision', 'action']) || raw.baseRevision !== model.revision || !object(raw.action)) return null;
    const action = raw.action;
    if (action.type !== 'orient' || !keys(action, ['type', 'viewId', 'orientation']) || typeof action.viewId !== 'string' || (action.orientation !== 'LR' && action.orientation !== 'TB')) return null;
    return { type: 'orient', viewId: action.viewId, orientation: action.orientation };
}

export function detailEdit(raw: unknown, model: SystemModel): Extract<DirectEdit, { type: 'detail' | 'close-detail' }> | null {
    if (!object(raw) || !keys(raw, ['baseRevision', 'action']) || raw.baseRevision !== model.revision || !object(raw.action)) return null;
    const action = raw.action;
    if (action.type === 'detail' && keys(action, ['type', 'target']) && typeof action.target === 'string') return { type: 'detail', target: action.target };
    if (action.type === 'close-detail' && keys(action, ['type', 'viewId']) && typeof action.viewId === 'string') return { type: 'close-detail', viewId: action.viewId };
    return null;
}

export const INVALID_EDIT_COPY = 'Invalid edit. Choose an existing element, a name of 1–500 characters, node positions within ±100000, a horizontal/vertical architecture direction, or a component detail view.';
/** Apply one direct edit (no AI) to the latest saved revision; the body must name that revision. */
export function applyDirectEdit(raw: unknown, latest: SystemModel): { ok: true; model: SystemModel } | { ok: false; errors: string[]; invalid?: true } {
    const orientation = orientationEdit(raw, latest);
    const detail = orientation ? null : detailEdit(raw, latest);
    const ops = orientation || detail ? null : directEditOps(raw, latest);
    if (!ops && !orientation && !detail) return { ok: false, errors: [INVALID_EDIT_COPY], invalid: true };
    return orientation ? orientArchitecture(latest, orientation.viewId, orientation.orientation)
        : detail ? (detail.type === 'detail' ? openDetailView(latest, detail.target) : closeDetailView(latest, detail.viewId))
        : applyEditOps(latest, ops!);
}

/** Read a bounded body rather than trusting Content-Length or buffering arbitrary input. */
export class RequestTooLarge extends Error {}

export async function readDirectEdit(req: Request, maxBytes = 65536): Promise<unknown> {
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
            if (size > maxBytes) {
                await reader.cancel();
                throw new RequestTooLarge('Edit too large');
            }
            text += decoder.decode(value, { stream: true });
        }
        return JSON.parse(text + decoder.decode());
    }
    finally {
        reader.releaseLock();
    }
}
