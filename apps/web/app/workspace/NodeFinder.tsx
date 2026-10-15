'use client';

import { useEffect, useRef, useState } from 'react';
import type { SystemModel } from '@archwoven/model';
import { findNodes } from './finder';

/** `/` search palette over the current view (archify node-finder.js port).
 *  Filtering is pure (finder.ts); this holds only the open/query/index state. */
export function NodeFinder({ model, viewNodes, onPick, onClose }: {
  model: SystemModel;
  viewNodes: string[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = findNodes(model, viewNodes, query);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [query]);

  const pick = (id: string | undefined) => { if (id) { onPick(id); onClose(); } };

  return (
    <div
      className="aw-finder"
      role="dialog"
      aria-label="Node finder"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(hits.length - 1, 0))); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); pick(hits[active]?.id); }
      }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find node…"
        aria-label="Find node"
      />
      <ul role="listbox" aria-label="Matching nodes">
        {hits.map((h, i) => (
          <li key={h.id} role="option" aria-selected={i === active}>
            <button className={'aw-finder-item' + (i === active ? ' aw-finder-active' : '')} onClick={() => pick(h.id)}>
              {h.label} <span className="aw-finder-id">{h.id}</span>
            </button>
          </li>
        ))}
        {hits.length === 0 && <li className="aw-finder-empty">no node matches “{query.trim()}”</li>}
      </ul>
    </div>
  );
}
