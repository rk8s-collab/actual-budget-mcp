import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_net_worth.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

describe('get_net_worth', () => {
  it('includes off-budget (pensions, mortgage) and excludes closed', async () => {
    const api = mockApi({
      getAccounts: async () => [
        { id: 'a1', name: 'Banco', offbudget: false, closed: false },
        { id: 'a2', name: 'Pensión', offbudget: true, closed: false },
        { id: 'a3', name: 'Hipoteca', offbudget: true, closed: false },
        { id: 'a4', name: 'Cerrada', offbudget: false, closed: true },
      ],
      // Saldos de ejemplo vía AQL. a4 aparece pero está cerrada => no debe contar.
      runQuery: async () => ({
        data: [
          { account: 'a1', balance: 1234567 },
          { account: 'a2', balance: 5000000 },
          { account: 'a3', balance: -12000000 },
          { account: 'a4', balance: 77777 },
        ],
      }),
    });
    const r: any = await tool.handler({}, { api, config: testConfig });
    expect(r.net_worth.amount).toBeCloseTo(-57654.33, 2);   // 12345.67 + 50000.00 - 120000.00
    expect(r.on_budget.total.amount).toBeCloseTo(12345.67, 2);
    expect(r.off_budget.total.amount).toBeCloseTo(-70000.0, 1);
    expect(r.off_budget.accounts).toHaveLength(2);
  });
});
