import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/categorize_transactions.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

describe('categorize_transactions', () => {
  it('applies each update independently and reports per-item results', async () => {
    const api = mockApi();
    (api.updateTransaction as any) = vi.fn(async (id: string) => {
      if (id === 't2') throw new Error('boom');
    });
    const r: any = await tool.handler(
      { updates: [
        { transaction_id: 't1', category_id: 'c1' },
        { transaction_id: 't2', category_id: 'c1' },
        { transaction_id: 't3', category_id: 'c2' },
      ] },
      { api, config: testConfig },
    );
    expect(r).toMatchObject({ total: 3, success_count: 2, failure_count: 1 });
    expect(r.succeeded.map((s: any) => s.transaction_id)).toEqual(['t1', 't3']);
    expect(r.failed[0]).toMatchObject({ transaction_id: 't2', error: 'boom' });
    expect(api.updateTransaction).toHaveBeenCalledWith('t1', { category: 'c1' });
  });
  it('rejects more than 50 updates', async () => {
    const updates = Array.from({ length: 51 }, (_, i) => ({ transaction_id: `t${i}`, category_id: 'c' }));
    await expect(tool.handler({ updates }, { api: mockApi(), config: testConfig })).rejects.toThrow();
  });
});
