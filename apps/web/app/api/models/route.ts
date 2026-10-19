import { hostedJobs } from '../../lib/hosted-runner';
import { postImportedModel } from '../../lib/hosted-model-edit';

export const runtime = 'nodejs';

/** Open a JSON download as a new diagram. No AI request is made. */
export async function POST(req: Request) {
  return postImportedModel(req, hostedJobs());
}
