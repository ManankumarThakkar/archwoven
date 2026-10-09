'use client';

import { useEffect, useState } from 'react';
import type { ViewType } from '@archwoven/model';
import { EXAMPLES, REPO_EXAMPLES } from './examples';
import { validateRepoUrlInput } from './repo-form';
import type { Mode } from './states';

const VIEWS: ViewType[] = ['architecture', 'sequence', 'er', 'component-detail'];
const tokenEstimate = (s: string) => Math.ceil(s.length / 4);
const PROMPT_TOKEN_LIMIT = 25_000;

export interface RepoForm {
  url: string;
  subdir?: string;
  ref?: string;
}

export interface ControlPanelProps {
  running: boolean;
  remaining: number;
  mode: Mode;
  prefill?: { prompt?: string; view?: ViewType; url?: string; subdir?: string; ref?: string };
  onMode: (mode: Mode) => void;
  onGenerate: (prompt: string, view: ViewType) => void;
  onGenerateRepo: (form: RepoForm) => void;
  onRepoExample: (url: string, ref: string) => void;
  onCancel: () => void;
}

export function ControlPanel({ running, remaining, mode, prefill, onMode, onGenerate, onGenerateRepo, onRepoExample, onCancel }: ControlPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [view, setView] = useState<ViewType>('architecture');
  const [url, setUrl] = useState('');
  const [subdir, setSubdir] = useState('');
  const [ref, setRef] = useState('');
  const tokens = tokenEstimate(prompt);
  const overBudget = tokens > PROMPT_TOKEN_LIMIT;
  const urlError = validateRepoUrlInput(url);

  // chip prefills land through the machine; mirror them into the fields (never auto-run)
  useEffect(() => {
    if (!prefill) return;
    if (prefill.prompt !== undefined) setPrompt(prefill.prompt);
    if (prefill.view !== undefined) setView(prefill.view);
    if (prefill.url !== undefined) setUrl(prefill.url);
    if (prefill.subdir !== undefined) setSubdir(prefill.subdir);
    if (prefill.ref !== undefined) setRef(prefill.ref);
  }, [prefill]);

  const applyExample = (p: string) => {
    // Scenario 1: never silently overwrite a prompt the user already typed.
    if (prompt.trim() && !window.confirm('Replace your current prompt with this example?')) return;
    setPrompt(p);
  };

  const applyRepoExample = (u: string, r: string) => {
    if (url.trim() && !window.confirm('Replace your current URL with this example?')) return;
    onRepoExample(u, r); // through the machine (REPO_SELECT) — prefills only, never auto-runs
  };

  const seg = (active: boolean) => ({
    flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid ' + (active ? '#5eead4' : '#334155'),
    background: active ? '#0f2e2b' : 'transparent', color: '#e5e7eb', cursor: 'pointer', fontSize: 13,
  } as const);
  const input = { width: '100%', boxSizing: 'border-box' as const, padding: 8, borderRadius: 8, background: '#0b1220', color: '#e5e7eb', border: '1px solid #334155' };

  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, width: 340, borderRight: '1px solid #1f2937' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onMode('describe')} disabled={running} style={seg(mode === 'describe')}>Describe</button>
        <button onClick={() => onMode('repo')} disabled={running} style={seg(mode === 'repo')}>Import repo</button>
      </div>

      {mode === 'describe' ? (
        <>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={running} rows={6}
            placeholder="Describe a system or flow…"
            style={{ resize: 'vertical', ...input }} />

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
        </>
      ) : (
        <>
          <input value={url} onChange={(e) => setUrl(e.target.value)} disabled={running} placeholder="https://github.com/owner/repo" style={input} />
          {url && urlError && <div style={{ fontSize: 12, color: '#f87171' }}>{urlError}</div>}
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={subdir} onChange={(e) => setSubdir(e.target.value)} disabled={running} placeholder="subdir (optional)" style={{ ...input, flex: 1 }} />
            <input value={ref} onChange={(e) => setRef(e.target.value)} disabled={running} placeholder="branch / commit (optional)" style={{ ...input, flex: 1 }} />
          </div>
          <div style={{ fontSize: 12, color: '#8b98b8' }}>Costs 2 credits ({remaining} left). Public repos only; the commit is pinned when the job starts.</div>

          <div>
            <div style={{ fontSize: 12, color: '#8b98b8', marginBottom: 6 }}>Examples</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {REPO_EXAMPLES.map((ex) => (
                <button key={ex.label} onClick={() => applyRepoExample(ex.url, ex.ref)} disabled={running}
                  style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #1f2937', background: '#111a2e', color: '#cbd5e1', cursor: 'pointer' }}>
                  {ex.label}
                </button>
              ))}
            </div>
          </div>

          {running ? (
            <button onClick={onCancel}
              style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #f87171', background: 'transparent', color: '#f87171', fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
          ) : (
            <button onClick={() => onGenerateRepo({ url: url.trim(), subdir: subdir.trim() || undefined, ref: ref.trim() || undefined })}
              disabled={!!urlError}
              style={{ padding: '10px 14px', borderRadius: 8, border: 'none', background: '#5eead4', color: '#04211f', fontWeight: 600, cursor: 'pointer', opacity: urlError ? 0.5 : 1 }}>
              Analyze repository
            </button>
          )}
        </>
      )}
    </aside>
  );
}
