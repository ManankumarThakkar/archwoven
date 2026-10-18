import { STABLE_SYSTEM } from './client';
import { CLARIFICATION_SYSTEM } from './clarification';
import { REPO_SYSTEM } from './repo';
import { SOURCE_PRESENTATION_SYSTEM } from './source-presentation';
import { REFINEMENT_OUTPUT_SCHEMA, REFINEMENT_SYSTEM } from './refine';
import { EXPANSION_OUTPUT_SCHEMA, EXPANSION_SYSTEM } from './expand';

/** Every hosted system prompt and output schema, so evaluation records can name
 * which prompt wording a result came from. User-message templates, repair
 * messages and repair limits live in code and are identified by the commit. */
export const HOSTED_PROMPT_PARTS = {
  generate: STABLE_SYSTEM, clarification: CLARIFICATION_SYSTEM,
  repo: REPO_SYSTEM, repoSourceMap: SOURCE_PRESENTATION_SYSTEM,
  refine: REFINEMENT_SYSTEM, refineSchema: REFINEMENT_OUTPUT_SCHEMA,
  expand: EXPANSION_SYSTEM, expandSchema: EXPANSION_OUTPUT_SCHEMA,
};
