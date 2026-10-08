import type { EditOp, SystemModel } from '@archwoven/model';

const short = (id: string) => id.split('.').pop() ?? id;

const isEdgePatch = (op: EditOp) => 'from' in op.patch && 'to' in op.patch;

function opSummary(op: EditOp): string {
  switch (op.op) {
    case 'add':
      return isEdgePatch(op)
        ? `+edge ${short(String(op.patch.from))}→${short(String(op.patch.to))}`
        : `+${String(op.patch.label ?? short(op.target))} ${String(op.patch.kind ?? '')}`.trim();
    case 'update':
      return `~${String(op.patch.label ?? short(op.target))}`;
    case 'remove':
      return `-${short(op.target)}`;
    case 'move':
      return `· move ${short(op.target)}`;
  }
}

/** "+Cache service, +edge orders→cache" — the change-summary strip text. */
export const summarizeOps = (ops: EditOp[]): string => ops.map(opSummary).join(', ');

const HISTORY_CAP = 25;

/** Undo stack of model snapshots; oldest dropped past the cap. */
export function pushHistory(stack: SystemModel[], model: SystemModel): SystemModel[] {
  return [...stack, model].slice(-HISTORY_CAP);
}

/** Pop the current state and return the previous snapshot (no-op at the floor). */
export function undo(stack: SystemModel[]): { model: SystemModel | null; stack: SystemModel[] } {
  if (stack.length <= 1) return { model: stack[stack.length - 1] ?? null, stack };
  return { model: stack[stack.length - 2] ?? null, stack: stack.slice(0, -1) };
}
