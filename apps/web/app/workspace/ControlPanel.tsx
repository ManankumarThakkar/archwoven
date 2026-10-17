'use client';

import { useEffect, useState } from 'react';
import type { ViewType } from '@archwoven/model';
import { EXAMPLES, REPO_EXAMPLES } from './examples';
import { validateRepoUrlInput } from './repo-form';
import { acceptableLocalPath, LOCAL_PATH_HINT } from '../../lib/local-path';
import type { Mode } from './states';

const VIEWS: ViewType[] = ['architecture', 'sequence', 'er', 'component-detail'];
const VIEW_LABELS: Record<ViewType, string> = {
  architecture: 'Architecture',
  sequence: 'Sequence',
  er: 'ER · data model',
  'component-detail': 'Component detail',
};
// Helpful placeholder per type (reference UX): the example matches what you're about to draw.
const PLACEHOLDERS: Record<ViewType, string> = {
  architecture: 'e.g. A real-time chat app with message history, user authentication, and push notifications…',
  sequence: 'e.g. User login with OAuth and JWT; or place order → payment → inventory check…',
  er: 'e.g. E-commerce database with orders, products, users, and payments…',
  'component-detail': 'e.g. Inside the API gateway: routing, rate limiting, auth, logging…',
};
const tokenEstimate = (s: string) => Math.ceil(s.length / 4);
const PROMPT_TOKEN_LIMIT = 25_000;

export interface RepoForm {
  url?: string;
  /** Local deployments only: a git clone on the machine running Archwoven. */
  localPath?: string;
  subdir?: string;
  ref?: string;
}

export interface ControlPanelProps {
  running: boolean;
  locked?: boolean;
  /** null in local deployments, which have no credits. */
  remaining: number | null;
  deploy: 'hosted' | 'local';
  mode: Mode;
  prefill?: { prompt?: string; view?: ViewType; url?: string; subdir?: string; ref?: string };
  onMode: (mode: Mode) => void;
  onGenerate: (prompt: string, view: ViewType) => void;
  onGenerateRepo: (form: RepoForm) => void;
  onRepoExample: (url: string, ref: string) => void;
  onCancel: () => void;
}

export function ControlPanel({ running, locked=false, remaining, deploy, mode, prefill, onMode, onGenerate, onGenerateRepo, onRepoExample, onCancel }: ControlPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [view, setView] = useState<ViewType>('architecture');
  const [url, setUrl] = useState('');
  const [subdir, setSubdir] = useState('');
  const [ref, setRef] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [sourceChoice, setSourceChoice] = useState<'local' | 'github' | null>(null);
  // Local deployments default to private clones; hosted deployments only import public GitHub repositories.
  const source = deploy === 'local' ? sourceChoice ?? 'local' : 'github';
  const pathError = localPath.trim() && !acceptableLocalPath(localPath) ? LOCAL_PATH_HINT : null;
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
    flex: 1, padding: '10px 8px', borderRadius: 8, border: '1px solid ' + (active ? '#5eead4' : '#334155'),
    background: active ? '#0f2e2b' : 'transparent', color: '#e5e7eb', cursor: 'pointer', fontSize: 13,
  } as const);
  const input = { width: '100%', boxSizing: 'border-box' as const, padding: 8, borderRadius: 8, background: '#0b1220', color: '#e5e7eb', border: '1px solid #334155' };

  return (
    <aside className="aw-create-panel" aria-label="Create a diagram">
      <fieldset disabled={locked} style={{display:'contents'}}>
      <div className="aw-panel-intro">
        <span className="aw-eyebrow">YOUR NEXT SYSTEM, MAPPED</span>
        <h1>Make the complex<br /> <span>clear.</span></h1>
        <p>Start with an idea or a repository. Explore how the pieces connect.</p>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button aria-pressed={mode === 'describe'} onClick={() => onMode('describe')} disabled={running} style={seg(mode === 'describe')}>Describe a system</button>
        <button aria-pressed={mode === 'repo'} onClick={() => onMode('repo')} disabled={running} style={seg(mode === 'repo')}>Import repository</button>
      </div>

      {mode === 'describe' ? (
        <>
          <div>
            <div style={{ fontSize: 12, color: '#8b98b8', marginBottom: 6 }}>Diagram type</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {VIEWS.map((v) => (
                <button key={v} aria-pressed={view === v} onClick={() => setView(v)} disabled={running}
                  style={{ ...seg(view === v), fontSize: 12 }}>
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
          </div>

          <label className="aw-field-label" htmlFor="system-description">Describe your system</label>
          <textarea id="system-description" aria-describedby="description-help description-budget" value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={running} rows={6}
            placeholder={PLACEHOLDERS[view]}
            style={{ resize: 'vertical', ...input, padding: 12, lineHeight: 1.65, minHeight: 150 }} />

          <p id="description-help" className="aw-field-help">Include the main components, who uses them, and what happens next.</p>
          <div id="description-budget" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: overBudget ? '#f87171' : '#8b98b8' }}>
            <span>≈{tokens.toLocaleString()} tokens</span>
            {remaining !== null && <span>{remaining} credits left</span>}
          </div>

          <div>
            <div style={{ fontSize: 12, color: '#8b98b8', marginBottom: 6 }}>Try an example · {VIEW_LABELS[view]}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {EXAMPLES[view].map((ex) => (
                <button key={ex.label} onClick={() => applyExample(ex.prompt)} disabled={running}
                  style={{ padding: '8px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #1f2937', background: '#111a2e', color: '#cbd5e1', cursor: 'pointer' }}>
                  {ex.label}
                </button>
              ))}
            </div>
          </div>

          <button className="aw-primary" onClick={() => onGenerate(prompt, view)} disabled={running || !prompt.trim() || overBudget}
            style={{ padding: '10px 14px', borderRadius: 8, border: 'none', background: '#5eead4', color: '#04211f', fontWeight: 600, cursor: 'pointer', opacity: running || !prompt.trim() || overBudget ? 0.5 : 1 }}>
            {running ? 'Creating your diagram…' : 'Generate diagram  →'}
          </button>
          {running && <button onClick={onCancel} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #f87171', background: 'transparent', color: '#f87171', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>}
        </>
      ) : (
        <>
          {deploy === 'local' && <div role="group" aria-label="Repository source" style={{ display: 'flex', gap: 6 }}>
            <button type="button" aria-pressed={source === 'local'} onClick={() => setSourceChoice('local')} disabled={running} style={seg(source === 'local')}>Local folder</button>
            <button type="button" aria-pressed={source === 'github'} onClick={() => setSourceChoice('github')} disabled={running} style={seg(source === 'github')}>GitHub</button>
          </div>}
          {source === 'local' ? <>
            <label className="aw-field-label" htmlFor="repository-path">Path to a git clone</label>
            <input id="repository-path" aria-describedby={pathError ? 'repository-path-help repository-path-error' : 'repository-path-help'} aria-invalid={!!pathError} value={localPath} onChange={(e) => setLocalPath(e.target.value)} disabled={running} placeholder="~/code/project" spellCheck={false} autoCapitalize="off" style={input} />
            {pathError && <div id="repository-path-error" role="alert" style={{ fontSize: 12, color: '#f87171' }}>{pathError}</div>}
            <div style={{ display: 'flex', gap: 6 }}>
              <label className="aw-repo-option">Subdirectory
              <input aria-label="Repository subdirectory" value={subdir} onChange={(e) => setSubdir(e.target.value)} disabled={running} placeholder="Optional" style={input} /></label>
            </div>
            <div id="repository-path-help" style={{ fontSize: 12, color: '#8b98b8', lineHeight: 1.6 }}>Reads the checked-out commit of a git clone on the machine running Archwoven (in Docker, a folder mounted into the container). Uncommitted and untracked changes are excluded. Nothing leaves this machine. Runs locally; no credits.</div>
          </> : <>
            <label className="aw-field-label" htmlFor="repository-url">Public GitHub repository</label>
            <input id="repository-url" type="url" aria-describedby={url && urlError ? "repository-help repository-error" : "repository-help"} aria-invalid={!!url && !!urlError} value={url} onChange={(e) => setUrl(e.target.value)} disabled={running} placeholder="https://github.com/owner/repo" style={input} />
            {url && urlError && <div id="repository-error" role="alert" style={{ fontSize: 12, color: '#f87171' }}>{urlError}</div>}
            <div style={{ display: 'flex', gap: 6 }}>
              <label className="aw-repo-option">Subdirectory
              <input aria-label="Repository subdirectory" value={subdir} onChange={(e) => setSubdir(e.target.value)} disabled={running} placeholder="Optional" style={input} /></label>
              <label className="aw-repo-option">Branch or commit
              <input aria-label="Repository branch or commit" value={ref} onChange={(e) => setRef(e.target.value)} disabled={running} placeholder="Default branch" style={input} /></label>
            </div>
            <div id="repository-help" style={{ fontSize: 12, color: '#8b98b8', lineHeight: 1.6 }}>Map public repositories across languages. Spring Boot and FastAPI include deeper framework-specific extraction; other repositories use a general code map with gaps called out.<br />{remaining !== null ? `Costs 2 credits (${remaining} left). ` : 'Runs locally; no credits. '}The commit is pinned when the job starts.</div>

            <div>
              <div style={{ fontSize: 12, color: '#8b98b8', marginBottom: 6 }}>Examples</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {REPO_EXAMPLES.map((ex) => (
                  <button key={ex.label} onClick={() => applyRepoExample(ex.url, ex.ref)} disabled={running}
                    style={{ padding: '8px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #1f2937', background: '#111a2e', color: '#cbd5e1', cursor: 'pointer' }}>
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

          </>}
          {running ? (
            <button onClick={onCancel}
              style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #f87171', background: 'transparent', color: '#f87171', fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
          ) : (
            <button className="aw-primary" onClick={() => onGenerateRepo(source === 'local'
                ? { localPath: localPath.trim(), subdir: subdir.trim() || undefined }
                : { url: url.trim(), subdir: subdir.trim() || undefined, ref: ref.trim() || undefined })}
              disabled={source === 'local' ? !localPath.trim() || !!pathError : !!urlError}
              style={{ padding: '10px 14px', borderRadius: 8, border: 'none', background: '#5eead4', color: '#04211f', fontWeight: 600, cursor: 'pointer', opacity: (source === 'local' ? !localPath.trim() || !!pathError : !!urlError) ? 0.5 : 1 }}>
              Analyze repository
            </button>
          )}
        </>
      )}
      <div className="aw-panel-footer"><span aria-hidden="true">◇</span> Inspect connections. Refine in words. Export your map.</div>
      </fieldset>
    </aside>
  );
}
