import { secretRefusal } from '@archwoven/llm';
import { deployMode } from '../app/lib/mode';

/** Typed text is checked before any credit or provider call; local deployments never send it anywhere. */
export const secretGate = (fields: { label: string; text: string }[]): Promise<string | null> =>
  deployMode() === 'local' ? Promise.resolve(null) : secretRefusal(fields);
