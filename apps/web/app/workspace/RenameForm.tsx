'use client';
import { useState } from 'react';
export function RenameForm({ id, label, busy, onRename }: {
    id: string;
    label: string;
    busy: boolean;
    onRename: (id: string, label: string) => void;
}) {
    const [name, setName] = useState(label), value = name.trim();
    return <form aria-label="Rename element" onSubmit={event => { event.preventDefault(); if (!busy && value && value !== label)
        onRename(id, value); }} style={{ display: 'grid', gap: 6 }}>
    <label style={{ fontSize: 12, color: 'var(--sh-muted)' }}>Name
      <input aria-label="Element name" maxLength={500} value={name} disabled={busy} onChange={event => setName(event.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 8, border: '1px solid var(--sh-line)', borderRadius: 6, background: 'var(--sh-field)', color: 'var(--sh-ink)' }}/>
    </label>
    <button type="submit" disabled={busy || !value || value === label} style={{ padding: '6px 10px', border: '1px solid var(--sh-line-strong)', borderRadius: 6, background: 'var(--sh-field)', color: 'var(--sh-green-ink)', fontWeight: 600, opacity: busy || !value || value === label ? 0.55 : 1 }}>Save name</button>
  </form>;
}
