import { z } from 'zod';
import type { GenerateOutcome, TaskUsage } from './client';

export const ClarificationSchema = z.strictObject({
  clarificationQuestions: z.array(z.string().trim().min(1).max(500)).min(1).max(3)
    .refine(q => new Set(q.map(s => s.toLowerCase())).size === q.length, 'Questions must be distinct'),
});
export type DescriptionOutcome = GenerateOutcome | { ok: true; questions: string[]; usage: TaskUsage };
export const CLARIFICATION_SCHEMA = z.toJSONSchema(ClarificationSchema, { target: 'draft-2020-12' });

/** One decision inside the initial generation call; a resumed request disables this alternative. */
export const CLARIFICATION_SYSTEM = `
Before drawing, check the description for contradictory requirements or missing decisions that fundamentally change this diagram.
If clarification is necessary, emit ONLY {"clarificationQuestions":["one focused question?", "another if needed?"]} instead of a system model. Ask 1 to 3 short, distinct questions (each at most 500 characters). Ask about the actual conflict; do not choose a side or draw a contradictory diagram.
For a sufficiently clear description, emit the normal system model directly. Do not ask routine technology/preferences questions or block a useful diagram on optional detail. This is the only clarification round; the user can answer or skip.`;
