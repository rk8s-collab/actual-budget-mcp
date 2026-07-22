import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/split_transaction.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

// Los ids de entrada se validan como UUID (ID en src/core/types.ts).
const T1 = '11111111-1111-4111-8111-111111111111';
const C1 = 'cccccccc-1111-4111-8111-111111111111';
const C2 = 'cccccccc-2222-4222-8222-222222222222';

const C_GHOST = 'cccccccc-0000-4000-8000-000000000000';
const SCH1 = 'dddddddd-1111-4111-8111-111111111111';
// Parent ajeno que la consulta agrupada arrastra porque una de sus partes coincide en importe.
const T_OTHER = 'eeeeeeee-1111-4111-8111-111111111111';
// Grupos de categorías del presupuesto: sólo C1 y C2 existen.
const GROUPS = [{ id: 'g1', name: 'Gastos', is_income: false, categories: [
  { id: C1, name: 'Alimentacion' }, { id: C2, name: 'Ocio' },
] }];

const original = { id: T1, date: '2026-07-10', account: 'a1', payee: 'p1', amount: -18000, notes: 'super', cleared: true, transfer_id: null, is_parent: false };
const newParent = { id: 't9', date: '2026-07-10', account: 'a1', payee: 'p1', amount: -18000, notes: 'super',
  subtransactions: [{ amount: -12000, category: C1 }, { amount: -6000, category: C2 }] };

function apiForSplit(orig: Record<string, unknown> = original) {
  let call = 0;
  return mockApi({
    getCategoryGroups: vi.fn(async () => GROUPS),
    runQuery: vi.fn(async () => {
      call += 1;
      if (call === 1) return { data: [orig] };                         // pre-read
      if (call === 2) return { data: [{ id: T1 }] };                   // snapshot previo a escribir
      if (call === 3) return { data: [{ id: T1 }, { id: 't9' }] };     // candidatos tras escribir
      return { data: [newParent] };                                     // echo grouped
    }),
  });
}

describe('split_transaction', () => {
  it('creates split copy, deletes original, echoes new state', async () => {
    const api = apiForSplit();
    const r: any = await tool.handler(
      { transaction_id: T1, splits: [
        { amount: -120, category_id: C1 },
        { amount: -60, category_id: C2 },
      ] },
      { api, config: testConfig },
    );
    expect(api.addTransactions).toHaveBeenCalledWith('a1', [expect.objectContaining({
      date: '2026-07-10', amount: -18000, notes: 'super', cleared: true,
      subtransactions: [
        { amount: -12000, category: C1 },
        { amount: -6000, category: C2 },
      ],
    })], { learnCategories: false, runTransfers: false });
    expect(api.deleteTransaction).toHaveBeenCalledWith(T1);
    expect(r).toMatchObject({ split: true, original_id: T1 });
    expect(r.transaction.splits).toHaveLength(2);
  });
  it('rejects when parts do not sum to the total, reporting the difference', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [original] }) });
    await expect(tool.handler(
      { transaction_id: T1, splits: [{ amount: -120, category_id: C1 }, { amount: -50, category_id: C2 }] },
      { api, config: testConfig },
    )).rejects.toThrow(/-10|10,00|difieren/i);
    expect(api.addTransactions).not.toHaveBeenCalled();
  });
  it('reports "sobran" when the parts overshoot the total', async () => {
    const positive = { ...original, amount: 18000 };
    const api = mockApi({ runQuery: async () => ({ data: [positive] }) });
    await expect(tool.handler(
      { transaction_id: T1, splits: [{ amount: 120, category_id: C1 }, { amount: 70, category_id: C2 }] },
      { api, config: testConfig },
    )).rejects.toThrow(/sobran/i);
    expect(api.addTransactions).not.toHaveBeenCalled();
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
    const sent = (api.addTransactions as any).mock.calls[0][1][0].subtransactions;
    expect(sent[1].amount).toBe(-6000); // -18000 - (-12000)
  });
  it('refuses transfers and already-split transactions', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [{ ...original, transfer_id: 'x' }] }) });
    await expect(tool.handler(
      { transaction_id: T1, splits: [{ amount: -180, category_id: C1 }] },
      { api, config: testConfig },
    )).rejects.toThrow(/transferencia/i);
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
    expect(api.addTransactions).not.toHaveBeenCalled();
    expect(api.deleteTransaction).not.toHaveBeenCalled();
  });
  it('identifies the replacement by set difference, ignoring unrelated parents already present', async () => {
    let call = 0;
    const api = mockApi({
      getCategoryGroups: vi.fn(async () => GROUPS),
      runQuery: vi.fn(async () => {
        call += 1;
        if (call === 1) return { data: [original] };                                // pre-read
        if (call === 2) return { data: [{ id: T1 }, { id: T_OTHER }] };             // snapshot previo
        if (call === 3) return { data: [{ id: T1 }, { id: T_OTHER }, { id: 't9' }] }; // tras crear
        return { data: [newParent] };                                                // echo grouped
      }),
    });
    const r: any = await tool.handler(
      { transaction_id: T1, splits: [
        { amount: -120, category_id: C1 },
        { amount: -60, category_id: C2 },
      ] },
      { api, config: testConfig },
    );
    expect(r.transaction.id).toBe('t9');
    expect(api.deleteTransaction).toHaveBeenCalledWith(T1);
  });
  it('carries imported_id, imported_payee, reconciled and schedule to the replacement', async () => {
    const api = apiForSplit({ ...original, imported_id: 'imp-1', imported_payee: 'MERCADONA S.A.', schedule: SCH1, reconciled: true });
    await tool.handler(
      { transaction_id: T1, force: true, splits: [
        { amount: -120, category_id: C1 },
        { amount: -60, category_id: C2 },
      ] },
      { api, config: testConfig },
    );
    expect((api.addTransactions as any).mock.calls[0][1][0]).toMatchObject({
      imported_id: 'imp-1', imported_payee: 'MERCADONA S.A.', schedule: SCH1, reconciled: true,
    });
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
    expect(api.addTransactions).not.toHaveBeenCalled();
    expect(api.deleteTransaction).not.toHaveBeenCalled();
  });
});
