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
  it('normalizes the sign of the budgeted total against its own categories', async () => {
    // loot-core calcula total-budgeted como `-sumAmounts(...)`: llega negado respecto a
    // las categorías del mismo payload. Devolver ambos signos obliga al LLM a adivinar.
    const api = mockApi({ getBudgetMonth: async () => ({
      month: '2026-07', toBudget: -5000000, totalIncome: 60000, totalBudgeted: -100000, totalSpent: -150000,
      categoryGroups: [{ id: 'g1', name: 'Comida', is_income: false, categories: [
        { id: 'c1', name: 'Alimentacion', budgeted: 60000, spent: -45000, balance: 15000 },
        { id: 'c2', name: 'Restaurantes', budgeted: 40000, spent: 0, balance: 40000 },
      ]}],
    }) });
    const r: any = await tool.handler({ month: '2026-07' }, { api, config: testConfig });
    const sumOfCategories = r.categories.reduce((s: number, c: any) => s + c.budgeted.amount, 0);
    expect(r.budgeted.amount).toBe(1000.00);
    expect(r.budgeted.amount).toBe(sumOfCategories);
  });

  it('never reports a negative zero when nothing is budgeted', async () => {
    // Con nada presupuestado, `-sumAmounts()` de loot-core devuelve -0 y se formateaba
    // como "-0,00 €"; fue la pista que destapó el signo invertido.
    const api = mockApi({ getBudgetMonth: async () => ({ ...budgetMonth, totalBudgeted: -0 }) });
    const r: any = await tool.handler({ month: '2026-07' }, { api, config: testConfig });
    expect(Object.is(r.budgeted.amount, -0)).toBe(false);
    expect(r.budgeted.amount_formatted).not.toContain('-');
  });

  it('rejects bad month format', async () => {
    await expect(tool.handler({ month: 'julio' }, { api: mockApi(), config: testConfig })).rejects.toThrow();
  });
});
