import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/split_transaction.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

// Los ids de entrada se validan como UUID (ID en src/core/types.ts).
const T1 = '11111111-1111-4111-8111-111111111111';
const C1 = 'cccccccc-1111-4111-8111-111111111111';
const C2 = 'cccccccc-2222-4222-8222-222222222222';
const C_GHOST = 'cccccccc-0000-4000-8000-000000000000';
const SCH1 = 'dddddddd-1111-4111-8111-111111111111';

// Grupos de categorías del presupuesto: sólo C1 y C2 existen.
const GROUPS = [{ id: 'g1', name: 'Gastos', is_income: false, categories: [
  { id: C1, name: 'Alimentacion' }, { id: C2, name: 'Ocio' },
] }];

const original = { id: T1, date: '2026-07-10', account: 'a1', payee: 'p1', amount: -18000, notes: 'super', cleared: true, transfer_id: null, is_parent: false };
const asSplit = { ...original, is_parent: true, subtransactions: [
  { amount: -12000, category: C1 }, { amount: -6000, category: C2 },
] };

/** Primera lectura (pre-check) devuelve `orig`; toda lectura posterior (readBackSplit) devuelve
 * `after` — igual que el servidor real una vez aplicado el update. */
function apiForSplit(orig: Record<string, unknown> = original, after: Record<string, unknown> = asSplit) {
  let call = 0;
  return mockApi({
    getCategoryGroups: vi.fn(async () => GROUPS),
    runQuery: vi.fn(async () => {
      call += 1;
      return { data: [call === 1 ? orig : after] };
    }),
  });
}

describe('split_transaction', () => {
  it('updates the transaction in place with subtransactions, echoes the split', async () => {
    const api = apiForSplit();
    const r: any = await tool.handler(
      { transaction_id: T1, splits: [
        { amount: -120, category_id: C1 },
        { amount: -60, category_id: C2 },
      ] },
      { api, config: testConfig },
    );
    expect(api.updateTransaction).toHaveBeenCalledWith(T1, {
      subtransactions: [
        { amount: -12000, category: C1 },
        { amount: -6000, category: C2 },
      ],
    });
    expect(api.addTransactions).not.toHaveBeenCalled();
    expect(api.deleteTransaction).not.toHaveBeenCalled();
    expect(r).toMatchObject({ split: true, original_id: T1 });
    expect(r.transaction.id).toBe(T1);
    expect(r.transaction.splits).toHaveLength(2);
  });

  it('rejects when parts do not sum to the total, reporting the difference', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [original] }) });
    await expect(tool.handler(
      { transaction_id: T1, splits: [{ amount: -120, category_id: C1 }, { amount: -50, category_id: C2 }] },
      { api, config: testConfig },
    )).rejects.toThrow(/-10|10,00|difieren/i);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('reports "sobran" when the parts overshoot the total', async () => {
    const positive = { ...original, amount: 18000 };
    const api = mockApi({ runQuery: async () => ({ data: [positive] }) });
    await expect(tool.handler(
      { transaction_id: T1, splits: [{ amount: 120, category_id: C1 }, { amount: 70, category_id: C2 }] },
      { api, config: testConfig },
    )).rejects.toThrow(/sobran/i);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('adjust_last computes the remainder server-side', async () => {
    const api = apiForSplit();
    await tool.handler(
      { transaction_id: T1, adjust_last: true, splits: [
        { amount: -120, category_id: C1 },
        { amount: 0, category_id: C2 },
      ] },
      { api, config: testConfig },
    );
    const sent = (api.updateTransaction as any).mock.calls[0][1].subtransactions;
    expect(sent[1].amount).toBe(-6000); // -18000 - (-12000)
  });

  it('refuses transfers', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [{ ...original, transfer_id: 'x' }] }) });
    await expect(tool.handler(
      { transaction_id: T1, splits: [{ amount: -180, category_id: C1 }] },
      { api, config: testConfig },
    )).rejects.toThrow(/transferencia/i);
  });

  it('refuses a transaction that is already split -- an in-place update would silently overwrite its existing parts', async () => {
    const alreadySplit = { ...original, is_parent: true, subtransactions: [
      { amount: -12000, category: C1 }, { amount: -6000, category: C2 },
    ] };
    const api = mockApi({ runQuery: async () => ({ data: [alreadySplit] }) });
    await expect(tool.handler(
      { transaction_id: T1, splits: [{ amount: -90, category_id: C1 }, { amount: -90, category_id: C2 }] },
      { api, config: testConfig },
    )).rejects.toThrow(/dividida|already split/i);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('rejects a well-formed but non-existent category in any part, before writing', async () => {
    const api = mockApi({
      getCategoryGroups: async () => GROUPS,
      runQuery: async () => ({ data: [original] }),
    });
    await expect(tool.handler(
      { transaction_id: T1, splits: [
        { amount: -120, category_id: C1 },
        { amount: -60, category_id: C_GHOST },
      ] },
      { api, config: testConfig },
    )).rejects.toThrow(C_GHOST);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('sends only { subtransactions } -- imported_id/imported_payee/schedule/reconciled are never read or touched', async () => {
    const withMetadata = { ...original, imported_id: 'imp-1', imported_payee: 'MERCADONA S.A.', schedule: SCH1, reconciled: true };
    const api = apiForSplit(withMetadata, { ...withMetadata, is_parent: true, subtransactions: asSplit.subtransactions });
    await tool.handler(
      { transaction_id: T1, force: true, splits: [
        { amount: -120, category_id: C1 },
        { amount: -60, category_id: C2 },
      ] },
      { api, config: testConfig },
    );
    // toHaveBeenCalledWith compara el segundo argumento por igualdad profunda: si el payload
    // llevara imported_id/schedule/reconciled, esta aserción fallaría.
    expect(api.updateTransaction).toHaveBeenCalledWith(T1, {
      subtransactions: [
        { amount: -12000, category: C1 },
        { amount: -6000, category: C2 },
      ],
    });
  });

  it('propagates the error from updateTransaction, with no cleanup step to run', async () => {
    const api = mockApi({
      getCategoryGroups: async () => GROUPS,
      runQuery: async () => ({ data: [original] }),
      updateTransaction: vi.fn(async () => { throw new Error('server exploded'); }),
    });
    await expect(tool.handler(
      { transaction_id: T1, splits: [
        { amount: -120, category_id: C1 },
        { amount: -60, category_id: C2 },
      ] },
      { api, config: testConfig },
    )).rejects.toThrow('server exploded');
  });

  it('refuses to split a reconciled transaction unless forced', async () => {
    const api = apiForSplit({ ...original, reconciled: true });
    await expect(tool.handler(
      { transaction_id: T1, splits: [
        { amount: -120, category_id: C1 },
        { amount: -60, category_id: C2 },
      ] },
      { api, config: testConfig },
    )).rejects.toThrow(/conciliad/i);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('reports echo_pending when the split is not yet reflected after writing', async () => {
    const api = mockApi({
      getCategoryGroups: async () => GROUPS,
      runQuery: vi.fn(async () => ({ data: [original] })), // siempre devuelve la fila sin dividir
    });
    const r: any = await tool.handler(
      { transaction_id: T1, splits: [
        { amount: -120, category_id: C1 },
        { amount: -60, category_id: C2 },
      ] },
      { api, config: testConfig },
    );
    expect(r.echo_pending).toBe(true);
  });
});
