import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/update_transaction.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

// Los ids de entrada se validan como UUID (ID en src/core/types.ts).
const T1 = '11111111-1111-4111-8111-111111111111';
const T_PARENT = '22222222-2222-4222-8222-222222222222';
const T_CHILD = '33333333-3333-4333-8333-333333333333';
const T_MISSING = '99999999-9999-4999-8999-999999999999';
const C9 = 'cccccccc-9999-4999-8999-999999999999';
const C_GHOST = 'cccccccc-0000-4000-8000-000000000000';
// Grupos de categorías del presupuesto: sólo C9 existe.
const GROUPS = [{ id: 'g1', name: 'Gastos', is_income: false, categories: [{ id: C9, name: 'Alimentacion' }] }];

describe('update_transaction', () => {
  it('converts amount to cents, passes only provided fields, echoes result', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: T1, date: '2026-07-01', account: 'a1', category: C9, amount: -4550 }] }),
      getCategoryGroups: async () => GROUPS,
    });
    const r: any = await tool.handler(
      { transaction_id: T1, category_id: C9, amount: -45.5 },
      { api, config: testConfig },
    );
    expect(api.updateTransaction).toHaveBeenCalledWith(T1, { category: C9, amount: -4550 });
    expect(r.updated).toBe(true);
    expect(r.transaction).toMatchObject({ id: T1, category_id: C9, amount: -45.5 });
  });
  it('rejects when no field to update is provided', async () => {
    await expect(tool.handler({ transaction_id: T1 }, { api: mockApi(), config: testConfig }))
      .rejects.toThrow(/campo/i);
  });
  it('errors clearly when the transaction does not exist', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [] }) });
    await expect(tool.handler({ transaction_id: T_MISSING, notes: 'x' }, { api, config: testConfig }))
      .rejects.toThrow(T_MISSING);
  });
  it('rejects editing a split child (pre-read returns the parent row)', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: T_PARENT, is_parent: true, date: '2026-07-01', account: 'a1',
        subtransactions: [{ amount: -12000, category: 'c1' }, { amount: -6000, category: 'c2' }] }] }),
    });
    await expect(tool.handler({ transaction_id: T_CHILD, notes: 'x' }, { api, config: testConfig }))
      .rejects.toThrow(/split/i);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });
  it('rejects editing amount/category of a split parent', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: T_PARENT, is_parent: true, date: '2026-07-01', account: 'a1',
        subtransactions: [{ amount: -12000, category: 'c1' }, { amount: -6000, category: 'c2' }] }] }),
    });
    await expect(tool.handler({ transaction_id: T_PARENT, amount: -180 }, { api, config: testConfig }))
      .rejects.toThrow(/split/i);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });
  it('allows editing notes-only on a split parent', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: T_PARENT, is_parent: true, date: '2026-07-01', account: 'a1',
        subtransactions: [{ amount: -12000, category: 'c1' }, { amount: -6000, category: 'c2' }] }] }),
    });
    const r: any = await tool.handler({ transaction_id: T_PARENT, notes: 'combo' }, { api, config: testConfig });
    expect(api.updateTransaction).toHaveBeenCalledWith(T_PARENT, { notes: 'combo' });
    expect(r.updated).toBe(true);
  });
  it('resolves payee_name to an existing payee id (case-insensitive)', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: T1, date: '2026-07-01', account: 'a1', amount: -4550 }] }),
      getPayees: async () => [{ id: 'p1', name: 'Mercadona' }],
    });
    await tool.handler({ transaction_id: T1, payee_name: 'mercadona' }, { api, config: testConfig });
    expect(api.updateTransaction).toHaveBeenCalledWith(T1, { payee: 'p1' });
    expect(api.createPayee).not.toHaveBeenCalled();
  });
  it('creates a payee when payee_name is unknown and uses the returned id', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: T1, date: '2026-07-01', account: 'a1', amount: -4550 }] }),
      getPayees: async () => [],
      createPayee: vi.fn(async () => 'p-new'),
    });
    await tool.handler({ transaction_id: T1, payee_name: 'Nueva Tienda' }, { api, config: testConfig });
    expect(api.createPayee).toHaveBeenCalledWith({ name: 'Nueva Tienda' });
    expect(api.updateTransaction).toHaveBeenCalledWith(T1, { payee: 'p-new' });
  });
  it('rejects a well-formed but non-existent category before writing', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: T1, date: '2026-07-01', account: 'a1', amount: -4550 }] }),
      getCategoryGroups: async () => GROUPS,
    });
    await expect(tool.handler({ transaction_id: T1, category_id: C_GHOST }, { api, config: testConfig }))
      .rejects.toThrow(C_GHOST);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });
  it('does not fetch the category index when no category_id is given', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: T1, date: '2026-07-01', account: 'a1', amount: -4550 }] }),
    });
    await tool.handler({ transaction_id: T1, notes: 'x' }, { api, config: testConfig });
    expect(api.getCategoryGroups).not.toHaveBeenCalled();
  });
  it('echoes the applied state even though the API resolves before writing', async () => {
    // Reproduce el fallo visto contra el servidor real: se pidió cambiar las notas,
    // respondió updated:true con las notas VIEJAS y en la base estaban las nuevas.
    const stale = { id: T1, date: '2026-07-01', account: 'a1', amount: -4550, notes: 'vieja' };
    // Lectura 1 = pre-lectura; lectura 2 = re-lectura inmediata, que AÚN no ve la
    // escritura (ahí es donde se rompía); lectura 3 = ya aplicada.
    let reads = 0;
    const api = mockApi({
      runQuery: async () => ({ data: [reads++ < 2 ? stale : { ...stale, notes: 'nueva' }] }),
    });
    const r: any = await tool.handler({ transaction_id: T1, notes: 'nueva' }, { api, config: testConfig });
    expect(r.transaction.notes).toBe('nueva');
    expect(r).not.toHaveProperty('echo_pending');
  });

  it('flags the echo instead of lying when the write never shows up', async () => {
    const stale = { id: T1, date: '2026-07-01', account: 'a1', amount: -4550, notes: 'vieja' };
    const api = mockApi({ runQuery: async () => ({ data: [stale] }) });
    const r: any = await tool.handler({ transaction_id: T1, notes: 'nueva' }, { api, config: testConfig });
    expect(r.updated).toBe(true);
    expect(r.echo_pending).toBe(true);
    expect(r.transaction.notes).toBe('vieja'); // lo leído, no lo deseado
  });

  it('is write-gated', () => {
    expect(tool.readOnly).toBe(false);
    expect(tool.name).toBe('update_transaction');
  });

  it('responde en inglés cuando se configura así', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [] }) });
    await expect(tool.handler(
      { transaction_id: T_MISSING, notes: 'x' },
      { api, config: { ...testConfig, messagesLang: 'en' } },
    )).rejects.toThrow(/not found/i);
  });
});
