import type { SystemModel, ViewType } from '@archwoven/model';

/** New ER generation must not silently present missing relationship semantics
 * as complete. Existing saved models retain their backward-compatible schema. */
export function generatedViewErrors(model: SystemModel, requested: ViewType): string[] {
  if (requested !== 'er') return [];
  const views = model.views.filter(view => view.type === 'er');
  if (!views.length) return ['The requested ER view is missing. Include an er view with entity nodes and relation edges.'];
  const errors: string[] = [];
  for (const view of views) for (const id of view.edges) {
    const edge = model.edges.find(edge => edge.id === id);
    if (edge?.type === 'relation' && !edge.cardinality && !model.openQuestions.some(question => question.blockedBy === id)) {
      errors.push(`ER relationship ${id} has no cardinality. Preserve the stated 1:1, 1:N or N:M cardinality; if it is unknown, add an openQuestions entry with blockedBy ${id}. Do not invent a cardinality.`);
    }
  }
  return errors;
}
