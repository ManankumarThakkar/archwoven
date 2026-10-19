import { SystemModelSchema, validateModel, type SystemModel } from '@archwoven/model';

/**
 * Hosted diagrams kept in this browser (localStorage), so a diagram outlives the server's 24-hour
 * copy. One entry per diagram holds its latest accepted revision. Entries are versioned and
 * validated on every read; anything unreadable is removed and reported, never shown.
 */
export const MAX_BROWSER_DIAGRAMS = 20;
/** Matches the server's limit for restoring a browser copy. */
export const MAX_BROWSER_DIAGRAM_BYTES = 512 * 1024;
const PREFIX = 'aw:diagram:v1:';

export type SaveResult = 'saved' | 'unavailable' | 'too-large' | 'full';
type Entry = { v: 1; savedAt: number; model: unknown };

function local(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** Saved diagrams, most recently saved first. Entries that cannot be parsed sort last. */
function saved(storage: Storage): { id: string; savedAt: number }[] {
  const out: { id: string; savedAt: number }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    let savedAt = 0;
    try { savedAt = Number((JSON.parse(storage.getItem(key) ?? '') as Entry).savedAt) || 0; } catch { /* sorts last */ }
    out.push({ id: key.slice(PREFIX.length), savedAt });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

const quotaError = (error: unknown) => error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');

/** Keep `model` as this diagram's copy. Older diagrams are forgotten beyond the count limit or to make room. */
export function saveBrowserDiagram(id: string, model: SystemModel, storage: Storage | null = local(), now: () => number = Date.now): SaveResult {
  if (!storage) return 'unavailable';
  try {
    const entry = JSON.stringify({ v: 1, savedAt: now(), model } satisfies Entry);
    if (new TextEncoder().encode(JSON.stringify(model)).byteLength > MAX_BROWSER_DIAGRAM_BYTES) return 'too-large';
    // Another tab may have kept a newer revision; an older page never replaces it.
    const kept = loadBrowserDiagram(id, storage);
    if (kept && 'model' in kept && kept.model.revision > model.revision) return 'saved';
    const others = saved(storage).filter(e => e.id !== id);
    while (others.length >= MAX_BROWSER_DIAGRAMS) storage.removeItem(PREFIX + others.pop()!.id);
    for (;;) {
      try { storage.setItem(PREFIX + id, entry); return 'saved'; }
      catch (error) {
        if (!quotaError(error)) return 'unavailable';
        const oldest = others.pop();
        if (!oldest) return 'full';
        storage.removeItem(PREFIX + oldest.id);
      }
    }
  } catch {
    return 'unavailable';
  }
}

/** This browser's copy of a diagram, null when there is none, or a problem when it could not be read (it is then removed). */
export function loadBrowserDiagram(id: string, storage: Storage | null = local()): { model: SystemModel } | { problem: 'unreadable' } | null {
  if (!storage) return null;
  let text: string | null;
  try { text = storage.getItem(PREFIX + id); } catch { return null; }
  if (text === null) return null;
  try {
    const entry = JSON.parse(text) as Entry;
    const parsed = entry?.v === 1 ? SystemModelSchema.safeParse(entry.model) : null;
    const checked = parsed?.success ? validateModel(parsed.data) : null;
    if (checked?.ok) return { model: checked.model };
  } catch { /* unreadable below */ }
  try { storage.removeItem(PREFIX + id); } catch { /* storage became unavailable */ }
  return { problem: 'unreadable' };
}

/** The diagram this browser saved most recently, to reopen after the tab was closed. */
export function latestBrowserDiagram(storage: Storage | null = local()): string | null {
  if (!storage) return null;
  try { return saved(storage)[0]?.id ?? null; } catch { return null; }
}

export function deleteBrowserDiagram(id: string, storage: Storage | null = local()): void {
  try { storage?.removeItem(PREFIX + id); } catch { /* nothing to delete */ }
}
