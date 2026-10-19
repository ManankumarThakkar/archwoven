import type { HostedJobs } from '@archwoven/jobs';
import { applyEditOps, type ViewType } from '@archwoven/model';
import { serverDeps } from '../../lib/server';
import { postHostedDiagramJob, readDiagramRequest, badRequest } from '../../lib/hosted-diagram-job';

export { STALE_COPY, NO_CHANGE_COPY } from '../../lib/hosted-diagram-job';
const VALID_VIEWS: ViewType[] = ['architecture', 'sequence', 'er', 'component-detail'];

/** Refinement through the shared hosted diagram job, on the diagram the browser holds. */
export async function postHostedRefine(req: Request, jobs: HostedJobs | 'misconfigured'): Promise<Response> {
  const read = await readDiagramRequest(req, jobs);
  if ('response' in read) return read.response;
  const { body } = read;
  const instruction = typeof body.instruction === 'string' ? body.instruction : '';
  if (!instruction.trim() || instruction.length > 2000) return badRequest('modelId, baseRevision and an instruction of up to 2,000 characters are required');
  const view: ViewType = VALID_VIEWS.includes(body.view as ViewType) ? body.view as ViewType : 'architecture';
  return postHostedDiagramJob(req, jobs, {
    kind: 'refine', view, modelId: typeof body.modelId === 'string' ? body.modelId : '', baseRevision: Number(body.baseRevision), rawModel: body.model,
    request: [view, instruction], texts: [{ label: 'Your instruction', text: instruction }],
    run: async (model, signal, spender) => {
      const out = await serverDeps.generateRefinement(instruction, model, view, { signal, spender });
      if (!out.ok) return out;
      const applied = applyEditOps(model, out.ops);
      return applied.ok ? { ok: true, model: applied.model, usage: out.usage, extra: { ops: out.ops } } : { ok: false, errors: applied.errors, usage: out.usage };
    },
  });
}
