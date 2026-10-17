'use client';

import { useState } from 'react';

/** Infers a component's internals. The hint survives failures; `cost` shows the hosted credit weight. */
export function ExpandInternals({ label, cost, busy, onExpand }: { label: string; cost: boolean; busy: boolean; onExpand: (hint: string) => Promise<boolean> }) {
  const [hint, setHint] = useState('');
  return (
    <form className="aw-expand" aria-label={`Expand ${label}`} onSubmit={async (e) => { e.preventDefault(); if (!busy && await onExpand(hint.trim())) setHint(''); }}>
      <input aria-label="Optional focus for the expansion" value={hint} maxLength={300} disabled={busy} placeholder="Optional focus, e.g. payment retries" onChange={(e) => setHint(e.target.value)} />
      <button type="submit" disabled={busy}>Expand internals{cost ? ' · 0.25 credit' : ''}</button>
    </form>
  );
}
