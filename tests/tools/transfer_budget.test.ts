import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/transfer_budget.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

// Los ids de entrada se validan como UUID (ID en src/core/types.ts).
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const CX = '99999999-9999-4999-8999-999999999999';

const month = {
  month: '2026-08',
  categoryGroups: [{ id: 'g1', name: 'Gastos', is_income: false, categories: [
    { id: C1, name: 'Alimentacion', budgeted: 35000 },
    { id: C2, name: 'Ocio', budgeted: 5000 },
  ] }],
};

describe('transfer_budget', () => {
  it('moves budget between categories and echoes new values', async () => {
    const api = mockApi({ getBudgetMonth: async () => month });
    const r: any = await tool.handler(
      { month: '2026-08', from_category_id: C1, to_category_id: C2, amount: 50 },
      { api, config: testConfig },
    );
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', C1, 30000);
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', C2, 10000);
    expect(r.from.budgeted.amount).toBe(300);
    expect(r.to.budgeted.amount).toBe(100);
    expect(r.transferred.amount).toBe(50);
  });
  it('rejects non-positive amounts and unknown categories', async () => {
    const api = mockApi({ getBudgetMonth: async () => month });
    await expect(tool.handler(
      { month: '2026-08', from_category_id: C1, to_category_id: C2, amount: 0 },
      { api, config: testConfig },
    )).rejects.toThrow();
    await expect(tool.handler(
      { month: '2026-08', from_category_id: CX, to_category_id: C2, amount: 10 },
      { api, config: testConfig },
    )).rejects.toThrow(CX);
  });
});
