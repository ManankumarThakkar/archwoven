import type { HostedJobs } from '@archwoven/jobs';
import { expandBlocker } from '@archwoven/model';
import { serverDeps } from '../../../../lib/server';
import { postHostedDiagramJob, readDiagramRequest, badRequest } from '../../../../lib/hosted-diagram-job';

const MAX_HINT_CHARS = 300;

/** Component expansion through the shared hosted diagram job, on the diagram the browser holds. */
export async function postHostedExpand(req: Request, jobs: HostedJobs | 'misconfigured', id: string): Promise<Response> {
  const read = await readDiagramRequest(req, jobs);
  if ('response' in read) return read.response;
  const b = read.body;
  const valid = Object.keys(b).every(k => ['baseRevision', 'target', 'hint', 'model'].includes(k))
    && typeof b.target === 'string' && b.target.length > 0 && b.target.length <= 200
    && (b.hint === undefined || (typeof b.hint === 'string' && b.hint.length <= MAX_HINT_CHARS));
  if (!valid) return badRequest(`Send baseRevision, the diagram, a component id as target and an optional hint of up to ${MAX_HINT_CHARS} characters.`);
  const target = b.target as string, hint = (b.hint as string | undefined) ?? '';
  return postHostedDiagramJob(req, jobs, {
    kind: 'expand', view: 'component-detail', modelId: id, baseRevision: Number(b.baseRevision), rawModel: b.model,
    request: [target, hint], texts: [{ label: 'Your hint', text: hint }],
    precheck: model => expandBlocker(model, target),
    run: (model, signal, spender) => serverDeps.expandComponent(model, target, hint, { signal, spender }),
  });
}
