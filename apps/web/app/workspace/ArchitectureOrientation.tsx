'use client';

import type { SystemModel, View } from '@archwoven/model';

export function ArchitectureOrientation({ model, view, busy, onChange }: {
  model: SystemModel;
  view: View;
  busy: boolean;
  onChange: (orientation: 'LR' | 'TB') => void;
}) {
  if (view.type !== 'architecture') return null;
  const direction = view.orientation ?? 'TB';
  const pinned = view.nodes.filter(id => Object.hasOwn(model.layout ?? {}, id));
  const shared = model.views.some(v => v.id !== view.id && v.type !== 'sequence' && v.nodes.some(id => pinned.includes(id)));
  return <div className="aw-orientation">
    <div role="group" aria-label="Architecture orientation" aria-describedby={pinned.length ? 'orientation-help' : undefined}>
      <button aria-label="Vertical architecture layout" aria-pressed={direction === 'TB'} disabled={busy || direction === 'TB'} onClick={() => onChange('TB')}>↓ Vertical</button>
      <button aria-label="Horizontal architecture layout" aria-pressed={direction === 'LR'} disabled={busy || direction === 'LR'} onClick={() => onChange('LR')}>→ Horizontal</button>
    </div>
    {pinned.length > 0 && <p id="orientation-help">Changing direction rearranges manually placed nodes{shared ? ', including shared nodes in other views' : ''}. Undo restores their positions.</p>}
  </div>;
}
