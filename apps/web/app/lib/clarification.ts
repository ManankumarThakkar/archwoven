import type { Clarification } from '@archwoven/jobs';
import type { SystemModel } from '@archwoven/model';

export interface ClarificationReply { jobId: string; answers?: string[]; skip?: true }

export function parseReply(value: unknown, count: number): ClarificationReply | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['jobId', 'answers', 'skip'].includes(k)) || typeof v.jobId !== 'string') return null;
  if (v.skip === true && v.answers === undefined) return { jobId: v.jobId, skip: true };
  if (v.skip !== undefined || !Array.isArray(v.answers) || v.answers.length !== count
    || v.answers.some(a => typeof a !== 'string' || a.length > 1000)) return null;
  const answers = (v.answers as string[]).map(a => a.trim());
  return answers.some(Boolean) ? { jobId: v.jobId, answers } : null;
}

export function continuationPrompt(context: Clarification, reply: ClarificationReply): string {
  return `Create the requested diagram now. This is the only clarification round and it is finished. Do not ask another round. Explicit answers below clarify and supersede conflicting statements in the original description. An unanswered question remains unresolved: do not choose a side, invent agreement, or add incompatible requirements. Keep unknown decisions in openQuestions and make only the useful, nonconflicting portion of the diagram.\n\nOriginal description:\n${context.prompt}\n\nClarification record (JSON):\n${JSON.stringify(context.questions.map((question, i) => ({ question, answer: reply.answers?.[i] || null })))}`;
}

/** Provider omissions cannot erase a question the user skipped or a supplied clarification. */
export function preserveClarification(model: SystemModel, context: Clarification, reply: ClarificationReply): SystemModel {
  const requirements = [...model.requirements], openQuestions = [...model.openQuestions];
  const ids = new Set([...requirements, ...openQuestions].map(r => r.id));
  const nextId = (base: string) => { let id = base; while (ids.has(id)) id += '.next'; ids.add(id); return id; };
  context.questions.forEach((question, i) => {
    const answer = reply.answers?.[i];
    if (answer) requirements.push({ id: nextId(`req.clarification.${i + 1}`), text: `${question}\nAnswer: ${answer}`, status: 'clarified' });
    else if (!openQuestions.some(q => q.text === question)) openQuestions.push({ id: nextId(`q.clarification.${i + 1}`), text: question });
  });
  return { ...model, requirements, openQuestions };
}
