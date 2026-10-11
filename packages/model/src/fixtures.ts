import { SystemModelSchema, type SystemModel } from './schema';
import validFullJson from './fixtures/valid-full.json';

/** Golden fixture, validated + correctly typed at module load (JSON imports widen literals). */
export const validFullModel: SystemModel = SystemModelSchema.parse(validFullJson);
import validExtendedJson from './fixtures/valid-full-extended.json';

/** Golden fixture + M4 semantic fields (semanticChecks/mainPath/boundaries/guidedViews) — fake pipeline exercises enforcement end-to-end. */
export const validFullModelExtended: SystemModel = SystemModelSchema.parse(validExtendedJson);
