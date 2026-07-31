import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_account_transfer_payee.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '44444444-4444-4444-8444-444444444444';
const P2 = '33333333-3333-4333-8333-333333333333';
const payees = [{ id: P2, name: 'Savings', transfer_acct: A1 }];
const accounts = [{ id: A1, name: 'Savings' }, { id: A2, name: 'Cash' }];

describe('get_account_transfer_payee', () => {
  it('returns the transfer payee of the account', async () => {
    const api = mockApi({ getPayees: async () => payees, getAccounts: async () => accounts });
    const r: any = await tool.handler({ account_id: A1 }, { api, config: testConfig });
    expect(r).toEqual({ payee: { id: P2, name: 'Savings', transfer_account_id: A1 } });
  });

  it('gives an actionable error when the account has no transfer payee', async () => {
    const api = mockApi({ getPayees: async () => payees, getAccounts: async () => accounts });
    await expect(tool.handler({ account_id: A2 }, { api, config: testConfig })).rejects.toThrow(A2);
  });

  it('distinguishes an unknown account from one without a transfer payee', async () => {
    const unknown = '99999999-9999-4999-8999-999999999999';
    const api = mockApi({ getPayees: async () => payees, getAccounts: async () => accounts });
    await expect(tool.handler({ account_id: unknown }, { api, config: testConfig }))
      .rejects.toThrow(/cuenta inexistente|unknown account/);
  });
});
