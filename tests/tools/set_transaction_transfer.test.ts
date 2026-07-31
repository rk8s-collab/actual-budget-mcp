import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/set_transaction_transfer.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const A_SRC = '22222222-2222-4222-8222-222222222222';
const A_DST = '33333333-3333-4333-8333-333333333333';
const A_OTHER = '44444444-4444-4444-8444-444444444444';
const P_DST = '55555555-5555-4555-8555-555555555555';
const LEG = '66666666-6666-4666-8666-666666666666';

const accounts = [{ id: A_SRC, name: 'Checking' }, { id: A_DST, name: 'Savings' }, { id: A_OTHER, name: 'Cash' }];
const payees = [{ id: P_DST, name: 'Savings', transfer_acct: A_DST }];

/** api.runQuery is how getTransactionById/readBack read: return `rows` each time. */
function apiWithRows(rows: any[][], overrides: Record<string, unknown> = {}) {
  let i = 0;
  return mockApi({
    getAccounts: async () => accounts,
    getPayees: async () => payees,
    runQuery: vi.fn(async () => ({ data: rows[Math.min(i++, rows.length - 1)] })),
    ...overrides,
  });
}

const plain = { id: T1, account: A_SRC, date: '2026-05-01', amount: -5000, payee: 'p-old', category: 'c-old', transfer_id: null };
const linked = { ...plain, payee: P_DST, category: null, transfer_id: LEG };

describe('set_transaction_transfer', () => {
  it('points the transaction at the destination transfer payee and echoes the linked leg', async () => {
    const api = apiWithRows([[plain], [linked]]);
    const r: any = await tool.handler({ transaction_id: T1, target_account_id: A_DST }, { api, config: testConfig });
    expect(api.updateTransaction).toHaveBeenCalledWith(T1, { payee: P_DST });
    expect(r.updated).toBe(true);
    expect(r.transfer_id).toBe(LEG);
    expect(r.transaction.id).toBe(T1);
  });

  it('reports transfer_id null when Actual did not link a counterpart', async () => {
    const api = apiWithRows([[plain], [{ ...plain, payee: P_DST }]]);
    const r: any = await tool.handler({ transaction_id: T1, target_account_id: A_DST }, { api, config: testConfig });
    expect(r.transfer_id).toBeNull();
  });

  it('rejects a target account with no transfer payee', async () => {
    const api = apiWithRows([[plain]]);
    await expect(tool.handler({ transaction_id: T1, target_account_id: A_OTHER }, { api, config: testConfig }))
      .rejects.toThrow(A_OTHER);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown target account', async () => {
    const unknown = '99999999-9999-4999-8999-999999999999';
    const api = apiWithRows([[plain]]);
    await expect(tool.handler({ transaction_id: T1, target_account_id: unknown }, { api, config: testConfig }))
      .rejects.toThrow(/cuenta inexistente|unknown account/);
  });

  it('rejects transferring a transaction into its own account', async () => {
    const api = apiWithRows([[plain]]);
    await expect(tool.handler({ transaction_id: T1, target_account_id: A_SRC }, { api, config: testConfig }))
      .rejects.toThrow(/distinta|different/);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('rejects a missing transaction', async () => {
    const api = apiWithRows([[]]);
    await expect(tool.handler({ transaction_id: T1, target_account_id: A_DST }, { api, config: testConfig }))
      .rejects.toThrow(T1);
  });

  it('rejects a split child by the parent-row detector', async () => {
    const parent = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', account: A_SRC, subtransactions: [{ id: T1 }] };
    const api = apiWithRows([[parent]]);
    await expect(tool.handler({ transaction_id: T1, target_account_id: A_DST }, { api, config: testConfig }))
      .rejects.toThrow(/split/i);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('rejects a split parent — Actual cannot make one a transfer', async () => {
    const api = apiWithRows([[{ ...plain, is_parent: true, subtransactions: [{ id: 'x' }, { id: 'y' }] }]]);
    await expect(tool.handler({ transaction_id: T1, target_account_id: A_DST }, { api, config: testConfig }))
      .rejects.toThrow(T1);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('syncs after writing', async () => {
    const api = apiWithRows([[plain], [linked]]);
    await tool.handler({ transaction_id: T1, target_account_id: A_DST }, { api, config: testConfig });
    expect(api.sync).toHaveBeenCalledTimes(1);
  });
});
