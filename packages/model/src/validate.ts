import { SystemModelSchema, type SystemModel } from './schema';

export type ValidationResult =
  | { ok: true; model: SystemModel }
  | { ok: false; errors: string[] };

/**
 * Zod shape validation + graph referential integrity.
 * Error strings always name the offending ids so LLM repair loops get actionable feedback.
 */
export function validateModel(raw: unknown): ValidationResult {
  const parsed = SystemModelSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    };
  }
  const m = parsed.data;
  const errors: string[] = [];

  const nodeIds = new Set<string>();
  for (const n of m.nodes) {
    if (nodeIds.has(n.id)) errors.push(`duplicate node id: "${n.id}"`);
    nodeIds.add(n.id);
  }

  const edgeIds = new Set<string>();
  for (const e of m.edges) {
    if (edgeIds.has(e.id)) errors.push(`duplicate edge id: "${e.id}"`);
    edgeIds.add(e.id);
    if (!nodeIds.has(e.from)) errors.push(`edge "${e.id}" from unknown node: "${e.from}"`);
    if (!nodeIds.has(e.to)) errors.push(`edge "${e.id}" to unknown node: "${e.to}"`);
  }

  for (const v of m.views) {
    for (const id of v.nodes) {
      if (!nodeIds.has(id)) errors.push(`view "${v.id}" references unknown node: "${id}"`);
    }
    for (const id of v.edges) {
      if (!edgeIds.has(id)) errors.push(`view "${v.id}" references unknown edge: "${id}"`);
    }
    if (v.sequence) {
      const viewNodes = new Set(v.nodes);
      for (const p of v.sequence.participants) {
        if (!viewNodes.has(p)) errors.push(`view "${v.id}" participant not in view nodes: "${p}"`);
      }
      const seqs = v.sequence.messages.map((msg) => msg.seq);
      for (let i = 0; i < seqs.length; i++) {
        const expected = i + 1;
        if (seqs[i] !== expected) {
          errors.push(`view "${v.id}" message seq must be consecutive from 1, got ${seqs[i]} at index ${i}`);
          break;
        }
      }
      for (const msg of v.sequence.messages) {
        if (!v.sequence.participants.includes(msg.from))
          errors.push(`view "${v.id}" message ${msg.seq} from unknown participant: "${msg.from}"`);
        if (!v.sequence.participants.includes(msg.to))
          errors.push(`view "${v.id}" message ${msg.seq} to unknown participant: "${msg.to}"`);
      }
    }
  }

  if (m.parentId !== undefined && m.parentId !== m.revision - 1) {
    errors.push(`parentId ${m.parentId} must equal revision - 1 (${m.revision - 1})`);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, model: m };
}
