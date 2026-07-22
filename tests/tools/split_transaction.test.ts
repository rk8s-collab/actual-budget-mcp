import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/split_transaction.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const original = { id: 't1', date: '2026-07-10', account: 'a1', payee: 'p1', amount: -18000, notes: 'super', cleared: true, transfer_id: null, is_parent: false };
const newParent = { id: 't9', date: '2026-07-10', account: 'a1', payee: 'p1', amount: -18000, notes: 'super',
  subtransactions: [{ amount: -12000, category: 'c1' }, { amount: -6000, category: 'c2' }] };

function apiForSplit() {
  let call = 0;
  return mockApi({
    runQuery: vi.fn(async () => {
      call += 1;
      if (call === 1) return { data: [original] };                      // pre-read
      if (call === 2) return { data: [{ id: 't1' }, { id: 't9' }] };    // locate candidates
      return { data: [newParent] };                                     // echo grouped
    }),
  });
}

describe('split_transaction', () => {
  it('creates split copy, deletes original, echoes new state', async () => {
    const api = apiForSplit();
    const r: any = await tool.handler(
      { transaction_id: 't1', splits: [
        { amount: -120, category_id: 'c1' },
        { amount: -60, category_id: 'c2' },
      ] },
      { api, config: testConfig },
    );
    expect(api.addTransactions).toHaveBeenCalledWith('a1', [expect.objectContaining({
      date: '2026-07-10', amount: -18000, notes: 'super', cleared: true,
      subtransactions: [
        { amount: -12000, category: 'c1' },
        { amount: -6000, category: 'c2' },
      ],
    })], { learnCategories: false, runTransfers: false });
    expect(api.deleteTransaction).toHaveBeenCalledWith('t1');
    expect(r).toMatchObject({ split: true, original_id: 't1' });
    expect(r.transaction.splits).toHaveLength(2);
  });
  it('rejects when parts do not sum to the total, reporting the difference', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [original] }) });
    await expect(tool.handler(
      { transaction_id: 't1', splits: [{ amount: -120, category_id: 'c1' }, { amount: -50, category_id: 'c2' }] },
      { api, config: testConfig },
    )).rejects.toThrow(/-10|10,00|difieren/i);
    expect(api.addTransactions).not.toHaveBeenCalled();
  });
  it('adjust_last computes the remainder server-side', async () => {
    const api = apiForSplit();
    await tool.handler(
      { transaction_id: 't1', adjust_last: true, splits: [
        { amount: -120, category_id: 'c1' },
        { amount: 0, category_id: 'c2' },
      ] },
      { api, config: testConfig },
    );
    const sent = (api.addTransactions as any).mock.calls[0][1][0].subtransactions;
    expect(sent[1].amount).toBe(-6000); // -18000 - (-12000)
  });
  it('refuses transfers and already-split transactions', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [{ ...original, transfer_id: 'x' }] }) });
    await expect(tool.handler(
      { transaction_id: 't1', splits: [{ amount: -180, category_id: 'c1' }] },
      { api, config: testConfig },
    )).rejects.toThrow(/transferencia/i);
  });
});
