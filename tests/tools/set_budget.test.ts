import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/set_budget.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

// Los ids de entrada se validan como UUID (ID en src/core/types.ts).
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const C_BAD = '99999999-9999-4999-8999-999999999999';
const C_GHOST = '88888888-8888-4888-8888-888888888888';

const GROUPS = [
  { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Comida', is_income: false, categories: [
    { id: C1, name: 'Alimentacion' }, { id: C2, name: 'Restaurantes' }, { id: C_BAD, name: 'Rota' },
  ] },
];

describe('set_budget', () => {
  it('sets amounts (units→cents) and optional carryover, reporting per-op results', async () => {
    const api = mockApi({ getCategoryGroups: vi.fn(async () => GROUPS) });
    (api.setBudgetAmount as any) = vi.fn(async (_m: string, cat: string) => {
      if (cat === C_BAD) throw new Error('nope');
    });
    const r: any = await tool.handler(
      { operations: [
        { month: '2026-08', category_id: C1, amount: 350 },
        { month: '2026-08', category_id: C_BAD, amount: 100 },
        { month: '2026-08', category_id: C2, amount: 120.5, carryover: true },
      ] },
      { api, config: testConfig },
    );
    expect(api.batchBudgetUpdates).toHaveBeenCalledTimes(1);
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', C1, 35000);
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', C2, 12050);
    expect(api.setBudgetCarryover).toHaveBeenCalledWith('2026-08', C2, true);
    expect(r).toMatchObject({ total: 3, success_count: 2, failure_count: 1 });
    expect(r.failed[0]).toMatchObject({ category_id: C_BAD, error: 'nope' });
    expect(r.succeeded[0]).toMatchObject({ category_id: C1, category_name: 'Alimentacion' });
    expect(r.succeeded[1]).toMatchObject({ category_id: C2, category_name: 'Restaurantes' });
  });
  it('rejects a well-formed but non-existent category id without writing the cell', async () => {
    const api = mockApi({ getCategoryGroups: vi.fn(async () => GROUPS) });
    const r: any = await tool.handler(
      { operations: [
        { month: '2026-08', category_id: C_GHOST, amount: 50 },
        { month: '2026-08', category_id: C1, amount: 10 },
      ] },
      { api, config: testConfig },
    );
    expect(r).toMatchObject({ total: 2, success_count: 1, failure_count: 1 });
    expect(r.failed[0].error).toMatch(/categoría inexistente/i);
    expect(r.failed[0].error).toContain(C_GHOST);
    expect(api.setBudgetAmount).toHaveBeenCalledTimes(1);
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', C1, 1000);
    expect(api.getCategoryGroups).toHaveBeenCalledTimes(1);
  });
  it('validates month format and op count (1-50)', async () => {
    await expect(tool.handler(
      { operations: [{ month: 'agosto', category_id: C1, amount: 1 }] },
      { api: mockApi(), config: testConfig },
    )).rejects.toThrow();
  });
});
