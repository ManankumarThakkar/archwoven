import type { SystemModel } from './schema';

/** Persist analysis disclosures with the model so every load shows the same gaps. Existing texts are not repeated. */
export function appendDisclosures(model: SystemModel, texts: string[]): SystemModel {
  const next = structuredClone(model);
  const known = new Set(next.openQuestions.map(q => q.text));
  const ids = new Set(next.openQuestions.map(q => q.id));
  let n = 0;
  for (const raw of texts) {
    const text = raw.trim();
    if (!text || known.has(text)) continue;
    let id: string;
    do id = `gap.ingest.${++n}`; while (ids.has(id));
    ids.add(id); known.add(text);
    next.openQuestions.push({ id, text });
  }
  return next;
}
