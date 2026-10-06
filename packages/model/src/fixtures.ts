import { SystemModelSchema, type SystemModel } from './schema';
import validFullJson from './fixtures/valid-full.json';

/** Golden fixture, validated + correctly typed at module load (JSON imports widen literals). */
export const validFullModel: SystemModel = SystemModelSchema.parse(validFullJson);
