'use client';

import { useRef } from 'react';
import type { SystemModel } from '@archwoven/model';

/** Outline rail (archify node-outline.js port): current-view nodes in schema order.
 *  Click focuses (same path as a node click); ArrowUp/Down move focus within the rail.
 *  Hidden on phone layouts and when the actual canvas is too narrow. */
export function OutlineRail({ model, viewNodes, activeId, onFocusNode }: {
  model: SystemModel;
  viewNodes: string[];
  activeId: string | null;
  onFocusNode: (id: string) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const items = viewNodes.map((id) => ({ id, label: model.nodes.find((n) => n.id === id)?.label ?? id }));

  const move = (from: number, delta: number) => {
    const next = Math.min(Math.max(from + delta, 0), items.length - 1);
    refs.current[next]?.focus();
  };

  return (
    <nav className="aw-outline-rail" aria-label="Outline">
      <div className="aw-outline-title">Outline</div>
      {items.map((it, i) => (
        <button
          key={it.id}
          ref={(el) => { refs.current[i] = el; }}
          className={'aw-outline-item' + (it.id === activeId ? ' aw-outline-active' : '')}
          onClick={() => onFocusNode(it.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
          }}
        >
          {it.label}
        </button>
      ))}
      {items.length === 0 && <div className="aw-outline-empty">no nodes in this view</div>}
    </nav>
  );
}
