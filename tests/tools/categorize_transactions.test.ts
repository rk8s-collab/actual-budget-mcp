import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/categorize_transactions.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

// Los ids de entrada se validan como UUID (ID en src/core/types.ts).
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const C1 = 'cccccccc-1111-4111-8111-111111111111';
const C2 = 'cccccccc-2222-4222-8222-222222222222';

describe('categorize_transactions', () => {
  it('applies each update independently and reports per-item results', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [
        { id: T1, is_child: false, is_parent: false },
        { id: T2, is_child: false, is_parent: false },
        { id: T3, is_child: false, is_parent: false },
      ] }),
    });
    (api.updateTransaction as any) = vi.fn(async (id: string) => {
      if (id === T2) throw new Error('boom');
    });
    const r: any = await tool.handler(
      { updates: [
        { transaction_id: T1, category_id: C1 },
        { transaction_id: T2, category_id: C1 },
        { transaction_id: T3, category_id: C2 },
      ] },
      { api, config: testConfig },
    );
    expect(r).toMatchObject({ total: 3, success_count: 2, failure_count: 1 });
    expect(r.succeeded.map((s: any) => s.transaction_id)).toEqual([T1, T3]);
    expect(r.failed[0]).toMatchObject({ transaction_id: T2, error: 'boom' });
    expect(api.updateTransaction).toHaveBeenCalledWith(T1, { category: C1 });
  });
  it('guards split children/parents and missing ids via a batched pre-read', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [
        { id: T1, is_child: false, is_parent: false },
        { id: T2, is_child: true, is_parent: false },
        // t3 intentionally missing
      ] }),
    });
    const r: any = await tool.handler(
      { updates: [
        { transaction_id: T1, category_id: C1 },
        { transaction_id: T2, category_id: C1 },
        { transaction_id: T3, category_id: C2 },
      ] },
      { api, config: testConfig },
    );
    expect(r).toMatchObject({ total: 3, success_count: 1, failure_count: 2 });
    expect(r.succeeded.map((s: any) => s.transaction_id)).toEqual([T1]);
    const f2 = r.failed.find((f: any) => f.transaction_id === T2);
    const f3 = r.failed.find((f: any) => f.transaction_id === T3);
    expect(f2.error).toMatch(/split/i);
    expect(f3.error).toMatch(/no encontrada/i);
    expect(api.updateTransaction).toHaveBeenCalledTimes(1);
    expect(api.updateTransaction).toHaveBeenCalledWith(T1, { category: C1 });
  });
  it('rejects more than 50 updates', async () => {
    const updates = Array.from({ length: 51 }, (_, i) => ({
      transaction_id: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
      category_id: C1,
    }));
    await expect(tool.handler({ updates }, { api: mockApi(), config: testConfig })).rejects.toThrow();
  });
});
