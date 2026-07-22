import { describe, it, expect } from 'vitest';
import { getAccountBalances } from '../../src/core/balances.js';
import { mockApi } from '../helpers/mock-api.js';

describe('getAccountBalances', () => {
  it('builds a grouped-by-account query on transactions and maps rows to a Map', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ account: 'a1', balance: 162498 }, { account: 'a2', balance: 500000 }] }),
    });
    const balances = await getAccountBalances(api);

    // La query se construye sobre 'transactions' y agrupa por 'account'.
    expect(api.q).toHaveBeenCalledWith('transactions');
    const builder = api.q.mock.results[0].value;
    expect(builder.calls.groupBy).toEqual(['account']);

    expect(balances).toBeInstanceOf(Map);
    expect(balances.get('a1')).toBe(162498);
    expect(balances.get('a2')).toBe(500000);
    expect(balances.size).toBe(2);
  });

  it('returns an empty Map when there are no rows', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [] }) });
    const balances = await getAccountBalances(api);
    expect(balances.size).toBe(0);
  });
});
