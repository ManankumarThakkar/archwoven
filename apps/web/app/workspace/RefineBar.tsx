'use client';

import { useState } from 'react';

export function RefineBar({
  busy, summary, canUndo, onRefine, onUndo, onExport,
}: {
  busy: boolean;
  summary: string;
  canUndo: boolean;
  onRefine: (instruction: string) => void;
  onUndo: () => void;
  onExport: (kind: 'svg' | 'png') => void;
}) {
  const [instruction, setInstruction] = useState('');
  return (
    <div className="aw-refine-bar" aria-label="Refine and export">
      <input aria-label="Refinement instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={busy}
        placeholder="Refine: add a cache, split orders, remove the queue…"
        onKeyDown={(e) => { if (e.key === 'Enter' && instruction.trim() && !busy) { onRefine(instruction.trim()); setInstruction(''); } }}
        style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: '#0b1220', color: '#e5e7eb', border: '1px solid #334155' }} />
      <button onClick={() => { if (instruction.trim()) { onRefine(instruction.trim()); setInstruction(''); } }} disabled={busy || !instruction.trim()}
        style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#5eead4', color: '#04211f', fontWeight: 600, cursor: 'pointer', opacity: busy || !instruction.trim() ? 0.5 : 1 }}>Refine</button>
      {summary && <span style={{ fontSize: 12, color: '#93c5fd', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={summary}>{summary}</span>}
      <button onClick={onUndo} disabled={!canUndo} title="Undo last change"
        style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: canUndo ? 'pointer' : 'default', opacity: canUndo ? 1 : 0.4 }}>↶ Undo</button>
      <button onClick={() => onExport('svg')} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>SVG</button>
      <button onClick={() => onExport('png')} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>PNG</button>
    </div>
  );
}
