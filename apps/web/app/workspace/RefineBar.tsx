'use client';

import { useId, useState } from 'react';

export type ExportKind = 'svg' | 'png' | 'json' | 'json-no-evidence';

export function RefineBar({
  busy, summary, canUndo, onRefine, onUndo, onExport, sources,
}: {
  busy: boolean;
  summary: string;
  canUndo: boolean;
  onRefine: (instruction: string) => void;
  onUndo: () => void;
  onExport: (kind: ExportKind) => void;
  /** Source references in the model's evidence; null when evidence carries none. */
  sources: { private: boolean; repos: string[] } | null;
}) {
  const [instruction, setInstruction] = useState('');
  const noteId = useId();
  const exportButton = { padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' } as const;
  return (
    <div className="aw-refine-bar" aria-label="Refine and export">
      <input aria-label="Refinement instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={busy}
        placeholder="Refine: add a cache, split orders, remove the queue…"
        onKeyDown={(e) => { if (e.key === 'Enter' && instruction.trim() && !busy) { onRefine(instruction.trim()); setInstruction(''); } }}
        style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: '#0b1220', color: '#e5e7eb', border: '1px solid #334155' }} />
      <button onClick={() => { if (instruction.trim()) { onRefine(instruction.trim()); setInstruction(''); } }} disabled={busy || !instruction.trim()}
        style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#5eead4', color: '#04211f', fontWeight: 600, cursor: 'pointer', opacity: busy || !instruction.trim() ? 0.5 : 1 }}>Refine</button>
      {summary && <span style={{ fontSize: 12, color: '#93c5fd', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={summary}>{summary}</span>}
      <button onClick={onUndo} disabled={busy || !canUndo} title="Undo last change"
        style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: canUndo ? 'pointer' : 'default', opacity: canUndo ? 1 : 0.4 }}>↶ Undo</button>
      <button disabled={busy} onClick={() => onExport('svg')} style={exportButton}>SVG</button>
      <button disabled={busy} onClick={() => onExport('png')} style={exportButton}>PNG</button>
      <button disabled={busy} onClick={() => onExport('json')} title="Download the saved model as JSON" aria-describedby={sources ? noteId : undefined} style={exportButton}>JSON</button>
      {sources && <button disabled={busy} onClick={() => onExport('json-no-evidence')} title="Download the model JSON without evidence records" aria-describedby={noteId} style={exportButton}>JSON (no evidence)</button>}
      {sources && <p id={noteId} role="note" style={{ flexBasis: '100%', margin: 0, fontSize: 12, color: '#94a3b8' }}>
        {sources.private && <>Full JSON includes repository, commit and file references{sources.repos.length ? ` (${sources.repos.join(', ')})` : ''}. </>}
        No-evidence JSON removes evidence records; names and IDs may still mention files.
      </p>}
    </div>
  );
}
