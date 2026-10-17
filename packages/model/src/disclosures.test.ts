import { describe, expect, it } from 'vitest';
import { appendDisclosures } from './disclosures';
import { validFullModelExtended } from './fixtures';
import { validateModel } from './validate';

describe('appendDisclosures', () => {
  it('adds new disclosures as open questions with stable unique ids, once each', () => {
    const m = structuredClone(validFullModelExtended);
    m.openQuestions.push({ id: 'gap.ingest.1', text: 'Taken id' });
    const next = appendDisclosures(m, ['Skipped 1 binary file: a.png.', 'Is inventory held in Postgres or a dedicated service?', 'Skipped 1 binary file: a.png.', '  ']);
    expect(next.openQuestions.slice(-2)).toEqual([{ id: 'gap.ingest.1', text: 'Taken id' }, { id: 'gap.ingest.2', text: 'Skipped 1 binary file: a.png.' }]);
    expect(next.openQuestions.filter(q => q.text.startsWith('Is inventory'))).toHaveLength(1);
    expect(validateModel(next).ok).toBe(true);
  });

  it('leaves the input model untouched', () => {
    const m = structuredClone(validFullModelExtended);
    const before = structuredClone(m);
    appendDisclosures(m, ['Skipped 1 binary file: a.png.']);
    expect(m).toEqual(before);
  });
});
