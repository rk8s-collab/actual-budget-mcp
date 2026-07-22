import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_accounts.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const accounts = [
  { id: 'a1', name: 'Banco', type: 'checking', offbudget: false, closed: false },
  { id: 'a2', name: 'Pensión', type: 'investment', offbudget: true, closed: false },
  { id: 'a3', name: 'Vieja', type: 'checking', offbudget: false, closed: true },
];

// Saldos de ejemplo vía AQL agrupado (balance_current es null en cuentas manuales).
const aqlBalances = { data: [{ account: 'a1', balance: 162498 }, { account: 'a2', balance: 500000 }] };

describe('get_accounts', () => {
  it('excludes closed by default, converts amounts', async () => {
    const api = mockApi({ getAccounts: async () => accounts, runQuery: async () => aqlBalances });
    const r: any = await tool.handler({}, { api, config: testConfig });
    expect(r.accounts.map((a: any) => a.id)).toEqual(['a1', 'a2']);
    expect(r.accounts[0]).toMatchObject({ amount: 1624.98, amount_formatted: '$1,624.98', on_budget: true });
    expect(r.accounts[0]).not.toHaveProperty('type');
    expect(r.total_count).toBe(2);
  });
  it('includes closed and filters off-budget on demand', async () => {
    const api = mockApi({ getAccounts: async () => accounts, runQuery: async () => aqlBalances });
    const r: any = await tool.handler({ include_closed: true, include_off_budget: false }, { api, config: testConfig });
    expect(r.accounts.map((a: any) => a.id)).toEqual(['a1', 'a3']);
  });
  it('defaults to 0 when account has no AQL balance row', async () => {
    // a3 no aparece en las filas AQL (sin transacciones) => amount 0.
    const api = mockApi({ getAccounts: async () => accounts, runQuery: async () => aqlBalances });
    const r: any = await tool.handler({ include_closed: true }, { api, config: testConfig });
    const a3 = r.accounts.find((a: any) => a.id === 'a3');
    expect(a3.amount).toBe(0);
  });
  it('is registered as read-only with valid name', () => {
    expect(tool.readOnly).toBe(true);
    expect(tool.name).toBe('get_accounts');
  });
});
