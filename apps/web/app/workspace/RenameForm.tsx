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
    <label style={{ fontSize: 12, color: '#a6b4cf' }}>Name
      <input aria-label="Element name" maxLength={500} value={name} disabled={busy} onChange={event => setName(event.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 8, border: '1px solid #334155', borderRadius: 6, background: '#0b1220', color: '#e5e7eb' }}/>
    </label>
    <button type="submit" disabled={busy || !value || value === label} style={{ padding: '6px 10px', border: '1px solid #334155', borderRadius: 6, background: '#111a2e', color: '#e5e7eb' }}>Save name</button>
  </form>;
}
