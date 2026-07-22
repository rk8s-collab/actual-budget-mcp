import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/update_transaction.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

describe('update_transaction', () => {
  it('converts amount to cents, passes only provided fields, echoes result', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: 't1', date: '2026-07-01', account: 'a1', category: 'c9', amount: -4550 }] }),
    });
    const r: any = await tool.handler(
      { transaction_id: 't1', category_id: 'c9', amount: -45.5 },
      { api, config: testConfig },
    );
    expect(api.updateTransaction).toHaveBeenCalledWith('t1', { category: 'c9', amount: -4550 });
    expect(r.updated).toBe(true);
    expect(r.transaction).toMatchObject({ id: 't1', category_id: 'c9', amount: -45.5 });
  });
  it('rejects when no field to update is provided', async () => {
    await expect(tool.handler({ transaction_id: 't1' }, { api: mockApi(), config: testConfig }))
      .rejects.toThrow(/campo/i);
  });
  it('errors clearly when the transaction does not exist', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [] }) });
    await expect(tool.handler({ transaction_id: 'nope', notes: 'x' }, { api, config: testConfig }))
      .rejects.toThrow(/nope/);
  });
  it('is write-gated', () => {
    expect(tool.readOnly).toBe(false);
    expect(tool.name).toBe('update_transaction');
  });
});
