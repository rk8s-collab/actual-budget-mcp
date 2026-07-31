import { describe, it, expect } from 'vitest';
import { getGroupIndex, countTransactionsForCategories } from '../../src/core/taxonomy.js';
import { mockApi } from '../helpers/mock-api.js';

const G1 = '11111111-1111-4111-8111-111111111111';
const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';

const groups = [
  { id: G1, name: 'Housing', is_income: false, hidden: false, categories: [
    { id: C1, name: 'Rent', hidden: false },
    { id: C2, name: 'Utilities', hidden: true },
  ] },
];

describe('getGroupIndex', () => {
  it('indexes groups by id with their child category ids', async () => {
    const idx = await getGroupIndex(mockApi({ getCategoryGroups: async () => groups }));
    expect(idx.get(G1)).toEqual({
      id: G1, name: 'Housing', is_income: false, hidden: false, categoryIds: [C1, C2],
    });
  });

  it('tolerates a group with no categories array', async () => {
    const api = mockApi({ getCategoryGroups: async () => [{ id: G1, name: 'Empty' }] });
    const idx = await getGroupIndex(api);
    expect(idx.get(G1)!.categoryIds).toEqual([]);
    expect(idx.get(G1)!.is_income).toBe(false);
    expect(idx.get(G1)!.hidden).toBe(false);
  });
});

describe('countTransactionsForCategories', () => {
  it('counts through a single AQL query including split children', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }) });
    const n = await countTransactionsForCategories(api, [C1, C2]);
    expect(n).toBe(3);
    const q = api.q.mock.results[0].value;
    expect(q.table).toBe('transactions');
    expect(q.calls.filter[0]).toEqual({ category: { $oneof: [C1, C2] } });
    // Split children carry their own category: 'grouped' would hide them behind the parent.
    expect(q.calls.options[0]).toEqual({ splits: 'all' });
  });

  it('does not query at all for an empty id list', async () => {
    const api = mockApi();
    expect(await countTransactionsForCategories(api, [])).toBe(0);
    expect(api.runQuery).not.toHaveBeenCalled();
  });

  it('treats a null data set as zero', async () => {
    const api = mockApi({ runQuery: async () => ({ data: null }) });
    expect(await countTransactionsForCategories(api, [C1])).toBe(0);
  });
});
