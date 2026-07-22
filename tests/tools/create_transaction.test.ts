import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/create_transaction.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

describe('create_transaction', () => {
  it('creates with payee_name and category, converts units to cents, echoes state', async () => {
    let call = 0;
    const api = mockApi({
      runQuery: vi.fn(async () => {
        call += 1;
        if (call === 1) return { data: [{ id: 'tNew' }] };
        return { data: [{ id: 'tNew', date: '2026-07-22', account: 'a1', payee_name: 'Mercadona', category: 'c1', amount: -2350 }] };
      }),
    });
    const r: any = await tool.handler(
      { account_id: 'a1', date: '2026-07-22', amount: -23.5, payee_name: 'Mercadona', category_id: 'c1' },
      { api, config: testConfig },
    );
    expect(api.addTransactions).toHaveBeenCalledWith('a1', [expect.objectContaining({
      date: '2026-07-22', amount: -2350, payee_name: 'Mercadona', category: 'c1',
    })], { learnCategories: true, runTransfers: false });
    expect(r.created).toBe(true);
    expect(r.transaction).toMatchObject({ id: 'tNew', amount: -23.5 });
  });
  it('creates already-split when splits are given and they sum to the total', async () => {
    let call = 0;
    const api = mockApi({
      runQuery: vi.fn(async () => {
        call += 1;
        if (call === 1) return { data: [{ id: 'tS' }] };
        return { data: [{ id: 'tS', date: '2026-07-22', account: 'a1', amount: -18000,
          subtransactions: [{ amount: -12000, category: 'c1' }, { amount: -6000, category: 'c2' }] }] };
      }),
    });
    const r: any = await tool.handler(
      { account_id: 'a1', date: '2026-07-22', amount: -180, payee_name: 'Super', splits: [
        { amount: -120, category_id: 'c1' }, { amount: -60, category_id: 'c2' },
      ] },
      { api, config: testConfig },
    );
    expect(r.transaction.splits).toHaveLength(2);
  });
  it('rejects splits that do not sum to the amount', async () => {
    const api = mockApi();
    await expect(tool.handler(
      { account_id: 'a1', date: '2026-07-22', amount: -180, splits: [
        { amount: -120, category_id: 'c1' }, { amount: -50, category_id: 'c2' },
      ] },
      { api, config: testConfig },
    )).rejects.toThrow(/difieren/i);
    expect(api.addTransactions).not.toHaveBeenCalled();
  });
});
