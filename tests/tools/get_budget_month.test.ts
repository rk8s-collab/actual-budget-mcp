import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_budget_month.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const budgetMonth = {
  month: '2026-07', toBudget: -5000000, totalIncome: 60000, totalBudgeted: 0, totalSpent: -150000,
  categoryGroups: [
    { id: 'g1', name: 'Comida', is_income: false, categories: [
      { id: 'c1', name: 'Alimentacion', budgeted: 0, spent: -45000, balance: -45000 },
      { id: 'c2', name: 'Sin actividad', budgeted: 0, spent: 0, balance: 0 },
    ]},
    { id: 'gi', name: 'Income', is_income: true, categories: [{ id: 'ci', name: 'Salary', budgeted: 0, spent: 0, balance: 0 }] },
  ],
};

describe('get_budget_month', () => {
  it('summarizes totals and filters inactive categories by default', async () => {
    const api = mockApi({ getBudgetMonth: async () => budgetMonth });
    const r: any = await tool.handler({ month: '2026-07' }, { api, config: testConfig });
    expect(r.to_budget.amount).toBeCloseTo(-50000.00, 2);
    expect(r.categories).toHaveLength(1);
    expect(r.categories[0]).toMatchObject({ id: 'c1', name: 'Alimentacion', group: 'Comida', spent: { amount: -450.00 } });
  });
  it('returns every expense category with only_active=false', async () => {
    const api = mockApi({ getBudgetMonth: async () => budgetMonth });
    const r: any = await tool.handler({ month: '2026-07', only_active: false }, { api, config: testConfig });
    expect(r.categories).toHaveLength(2); // income group still excluded
  });
  it('rejects bad month format', async () => {
    await expect(tool.handler({ month: 'julio' }, { api: mockApi(), config: testConfig })).rejects.toThrow();
  });
});
