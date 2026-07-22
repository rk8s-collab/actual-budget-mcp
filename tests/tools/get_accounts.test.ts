import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_accounts.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const accounts = [
  { id: 'a1', name: 'Banco', type: 'checking', offbudget: false, closed: false, balance_current: 162498 },
  { id: 'a2', name: 'Pensión', type: 'investment', offbudget: true, closed: false, balance_current: 500000 },
  { id: 'a3', name: 'Vieja', type: 'checking', offbudget: false, closed: true, balance_current: 0 },
];

describe('get_accounts', () => {
  it('excludes closed by default, converts amounts', async () => {
    const api = mockApi({ getAccounts: async () => accounts });
    const r: any = await tool.handler({}, { api, config: testConfig });
    expect(r.accounts.map((a: any) => a.id)).toEqual(['a1', 'a2']);
    expect(r.accounts[0]).toMatchObject({ amount: 1624.98, amount_formatted: '$1,624.98', on_budget: true });
    expect(r.total_count).toBe(2);
  });
  it('includes closed and filters off-budget on demand', async () => {
    const api = mockApi({ getAccounts: async () => accounts });
    const r: any = await tool.handler({ include_closed: true, include_off_budget: false }, { api, config: testConfig });
    expect(r.accounts.map((a: any) => a.id)).toEqual(['a1', 'a3']);
  });
  it('is registered as read-only with valid name', () => {
    expect(tool.readOnly).toBe(true);
    expect(tool.name).toBe('get_accounts');
  });
});
