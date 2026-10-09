'use client';

import { useState } from 'react';
import type { ViewType } from '@archwoven/model';
import { EXAMPLES } from './examples';

const VIEWS: ViewType[] = ['architecture', 'sequence', 'er', 'component-detail'];
const tokenEstimate = (s: string) => Math.ceil(s.length / 4);
const PROMPT_TOKEN_LIMIT = 25_000;

export interface ControlPanelProps {
  running: boolean;
  remaining: number;
  onGenerate: (prompt: string, view: ViewType) => void;
}

export function ControlPanel({ running, remaining, onGenerate }: ControlPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [view, setView] = useState<ViewType>('architecture');
  const tokens = tokenEstimate(prompt);
  const overBudget = tokens > PROMPT_TOKEN_LIMIT;

  const applyExample = (p: string) => {
    // Scenario 1: never silently overwrite a prompt the user already typed.
    if (prompt.trim() && !window.confirm('Replace your current prompt with this example?')) return;
    setPrompt(p);
  };

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, width: 340, borderRight: '1px solid #1f2937' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {VIEWS.map((v) => (
          <button key={v} onClick={() => setView(v)} disabled={running}
            style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid ' + (v === view ? '#5eead4' : '#334155'), background: v === view ? '#0f2e2b' : 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>
            {v}
          </button>
        ))}
      </div>

      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={running} rows={6}
        placeholder="Describe a system or flow…"
        style={{ resize: 'vertical', padding: 10, borderRadius: 8, background: '#0b1220', color: '#e5e7eb', border: '1px solid #334155' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: overBudget ? '#f87171' : '#8b98b8' }}>
        <span>≈{tokens.toLocaleString()} tokens</span>
        <span>{remaining} credits left</span>
      </div>

      <div>
        <div style={{ fontSize: 12, color: '#8b98b8', marginBottom: 6 }}>Examples</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {EXAMPLES[view].map((ex) => (
            <button key={ex.label} onClick={() => applyExample(ex.prompt)} disabled={running}
              style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #1f2937', background: '#111a2e', color: '#cbd5e1', cursor: 'pointer' }}>
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      <button onClick={() => onGenerate(prompt, view)} disabled={running || !prompt.trim() || overBudget}
        style={{ padding: '10px 14px', borderRadius: 8, border: 'none', background: '#5eead4', color: '#04211f', fontWeight: 600, cursor: 'pointer', opacity: running || !prompt.trim() || overBudget ? 0.5 : 1 }}>
        {running ? 'Generating…' : 'Generate'}
      </button>
    </aside>
  );
}
