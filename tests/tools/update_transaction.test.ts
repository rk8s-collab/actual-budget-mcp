import { describe, it, expect, vi } from 'vitest';
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
  it('rejects editing a split child (pre-read returns the parent row)', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: 'tParent', is_parent: true, date: '2026-07-01', account: 'a1',
        subtransactions: [{ amount: -12000, category: 'c1' }, { amount: -6000, category: 'c2' }] }] }),
    });
    await expect(tool.handler({ transaction_id: 'tChild', notes: 'x' }, { api, config: testConfig }))
      .rejects.toThrow(/split/i);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });
  it('rejects editing amount/category of a split parent', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: 'tParent', is_parent: true, date: '2026-07-01', account: 'a1',
        subtransactions: [{ amount: -12000, category: 'c1' }, { amount: -6000, category: 'c2' }] }] }),
    });
    await expect(tool.handler({ transaction_id: 'tParent', amount: -180 }, { api, config: testConfig }))
      .rejects.toThrow(/split/i);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });
  it('allows editing notes-only on a split parent', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: 'tParent', is_parent: true, date: '2026-07-01', account: 'a1',
        subtransactions: [{ amount: -12000, category: 'c1' }, { amount: -6000, category: 'c2' }] }] }),
    });
    const r: any = await tool.handler({ transaction_id: 'tParent', notes: 'combo' }, { api, config: testConfig });
    expect(api.updateTransaction).toHaveBeenCalledWith('tParent', { notes: 'combo' });
    expect(r.updated).toBe(true);
  });
  it('resolves payee_name to an existing payee id (case-insensitive)', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: 't1', date: '2026-07-01', account: 'a1', amount: -4550 }] }),
      getPayees: async () => [{ id: 'p1', name: 'Mercadona' }],
    });
    await tool.handler({ transaction_id: 't1', payee_name: 'mercadona' }, { api, config: testConfig });
    expect(api.updateTransaction).toHaveBeenCalledWith('t1', { payee: 'p1' });
    expect(api.createPayee).not.toHaveBeenCalled();
  });
  it('creates a payee when payee_name is unknown and uses the returned id', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: 't1', date: '2026-07-01', account: 'a1', amount: -4550 }] }),
      getPayees: async () => [],
      createPayee: vi.fn(async () => 'p-new'),
    });
    await tool.handler({ transaction_id: 't1', payee_name: 'Nueva Tienda' }, { api, config: testConfig });
    expect(api.createPayee).toHaveBeenCalledWith({ name: 'Nueva Tienda' });
    expect(api.updateTransaction).toHaveBeenCalledWith('t1', { payee: 'p-new' });
  });
  it('is write-gated', () => {
    expect(tool.readOnly).toBe(false);
    expect(tool.name).toBe('update_transaction');
  });
});
