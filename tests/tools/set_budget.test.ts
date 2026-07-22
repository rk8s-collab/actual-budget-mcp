import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/set_budget.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

describe('set_budget', () => {
  it('sets amounts (units→cents) and optional carryover, reporting per-op results', async () => {
    const api = mockApi();
    (api.setBudgetAmount as any) = vi.fn(async (_m: string, cat: string) => {
      if (cat === 'cBad') throw new Error('nope');
    });
    const r: any = await tool.handler(
      { operations: [
        { month: '2026-08', category_id: 'c1', amount: 350 },
        { month: '2026-08', category_id: 'cBad', amount: 100 },
        { month: '2026-08', category_id: 'c2', amount: 120.5, carryover: true },
      ] },
      { api, config: testConfig },
    );
    expect(api.batchBudgetUpdates).toHaveBeenCalledTimes(1);
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', 'c1', 35000);
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', 'c2', 12050);
    expect(api.setBudgetCarryover).toHaveBeenCalledWith('2026-08', 'c2', true);
    expect(r).toMatchObject({ total: 3, success_count: 2, failure_count: 1 });
    expect(r.failed[0]).toMatchObject({ category_id: 'cBad', error: 'nope' });
  });
  it('validates month format and op count (1-50)', async () => {
    await expect(tool.handler(
      { operations: [{ month: 'agosto', category_id: 'c1', amount: 1 }] },
      { api: mockApi(), config: testConfig },
    )).rejects.toThrow();
  });
});
