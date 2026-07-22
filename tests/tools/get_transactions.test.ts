import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_transactions.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const rows = [
  { id: 't1', date: '2026-06-10', 'account.name': 'Banco', 'payee.name': 'Mercadona',
    'category.name': 'Alimentacion', amount: -4550, notes: null, transfer_id: null, is_parent: false },
  { id: 't2', date: '2026-06-09', 'account.name': 'Banco', 'payee.name': 'Traspaso',
    'category.name': null, amount: -10000, notes: null, transfer_id: 'x9', is_parent: false },
];

describe('get_transactions', () => {
  it('maps rows compactly and flags transfers', async () => {
    const api = mockApi({
      runQuery: async (q: any) => (q.calls?.calculate ? { data: 2 } : { data: rows }),
    });
    const r: any = await tool.handler(
      { start_date: '2026-06-01', end_date: '2026-06-30', include_transfers: true },
      { api, config: testConfig },
    );
    expect(r.transactions[0]).toMatchObject({
      id: 't1', account: 'Banco', payee: 'Mercadona', category: 'Alimentacion', amount: -45.5,
    });
    expect(r.transactions[0].is_transfer).toBeUndefined();
    expect(r.transactions[1].is_transfer).toBe(true);
    expect(r.total_count).toBe(2);
  });
  it('filters transfers out via query by default and applies pagination filters', async () => {
    const api = mockApi();
    await tool.handler({ start_date: '2026-06-01', end_date: '2026-06-30', limit: 10, offset: 20 }, { api, config: testConfig });
    // Inspect the recorded chainable calls of the SELECT query (2nd q() call)
    const selectQ: any = (api.q as any).mock.results[1].value;
    const filters = Object.assign({}, ...selectQ.calls.filter.flat());
    expect(filters.transfer_id).toEqual(null);
    expect(selectQ.calls.limit).toEqual([10]);
    expect(selectQ.calls.offset).toEqual([20]);
  });
  it('rejects an invalid date', async () => {
    const api = mockApi();
    await expect(
      tool.handler({ start_date: 'junio', end_date: '2026-06-30' }, { api, config: testConfig }),
    ).rejects.toThrow();
  });
});
