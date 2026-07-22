import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/transfer_budget.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const month = {
  month: '2026-08',
  categoryGroups: [{ id: 'g1', name: 'Gastos', is_income: false, categories: [
    { id: 'c1', name: 'Alimentacion', budgeted: 35000 },
    { id: 'c2', name: 'Ocio', budgeted: 5000 },
  ] }],
};

describe('transfer_budget', () => {
  it('moves budget between categories and echoes new values', async () => {
    const api = mockApi({ getBudgetMonth: async () => month });
    const r: any = await tool.handler(
      { month: '2026-08', from_category_id: 'c1', to_category_id: 'c2', amount: 50 },
      { api, config: testConfig },
    );
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', 'c1', 30000);
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', 'c2', 10000);
    expect(r.from.budgeted.amount).toBe(300);
    expect(r.to.budgeted.amount).toBe(100);
    expect(r.transferred.amount).toBe(50);
  });
  it('rejects non-positive amounts and unknown categories', async () => {
    const api = mockApi({ getBudgetMonth: async () => month });
    await expect(tool.handler(
      { month: '2026-08', from_category_id: 'c1', to_category_id: 'c2', amount: 0 },
      { api, config: testConfig },
    )).rejects.toThrow();
    await expect(tool.handler(
      { month: '2026-08', from_category_id: 'cX', to_category_id: 'c2', amount: 10 },
      { api, config: testConfig },
    )).rejects.toThrow(/cX/);
  });
});
