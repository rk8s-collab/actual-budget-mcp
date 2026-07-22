import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/create_transaction.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

// Los ids de entrada se validan como UUID (ID en src/core/types.ts).
const A1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const C1 = 'cccccccc-1111-4111-8111-111111111111';
const C2 = 'cccccccc-2222-4222-8222-222222222222';
const C_GHOST = 'cccccccc-9999-4999-8999-999999999999';

const GROUPS = [
  { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Comida', is_income: false, categories: [
    { id: C1, name: 'Alimentacion' }, { id: C2, name: 'Restaurantes' },
  ] },
];

describe('create_transaction', () => {
  it('creates with payee_name and category, converts units to cents, echoes state', async () => {
    let call = 0;
    const api = mockApi({
      getCategoryGroups: vi.fn(async () => GROUPS),
      runQuery: vi.fn(async () => {
        call += 1;
        if (call === 1) return { data: [{ id: 'tNew' }] };
        return { data: [{ id: 'tNew', date: '2026-07-22', account: A1, payee_name: 'Mercadona', category: C1, amount: -2350 }] };
      }),
    });
    const r: any = await tool.handler(
      { account_id: A1, date: '2026-07-22', amount: -23.5, payee_name: 'Mercadona', category_id: C1 },
      { api, config: testConfig },
    );
    expect(api.addTransactions).toHaveBeenCalledWith(A1, [expect.objectContaining({
      date: '2026-07-22', amount: -2350, payee_name: 'Mercadona', category: C1,
    })], { learnCategories: true, runTransfers: false });
    expect(r.created).toBe(true);
    expect(r.transaction).toMatchObject({ id: 'tNew', amount: -23.5 });
  });
  it('creates already-split when splits are given and they sum to the total', async () => {
    let call = 0;
    const api = mockApi({
      getCategoryGroups: vi.fn(async () => GROUPS),
      runQuery: vi.fn(async () => {
        call += 1;
        if (call === 1) return { data: [{ id: 'tS' }] };
        return { data: [{ id: 'tS', date: '2026-07-22', account: A1, amount: -18000,
          subtransactions: [{ amount: -12000, category: C1 }, { amount: -6000, category: C2 }] }] };
      }),
    });
    const r: any = await tool.handler(
      { account_id: A1, date: '2026-07-22', amount: -180, payee_name: 'Super', splits: [
        { amount: -120, category_id: C1 }, { amount: -60, category_id: C2 },
      ] },
      { api, config: testConfig },
    );
    expect(r.transaction.splits).toHaveLength(2);
  });
  it('rejects splits that do not sum to the amount', async () => {
    const api = mockApi({ getCategoryGroups: vi.fn(async () => GROUPS) });
    await expect(tool.handler(
      { account_id: A1, date: '2026-07-22', amount: -180, splits: [
        { amount: -120, category_id: C1 }, { amount: -50, category_id: C2 },
      ] },
      { api, config: testConfig },
    )).rejects.toThrow(/difieren/i);
    expect(api.addTransactions).not.toHaveBeenCalled();
  });
  it('rejects a well-formed but non-existent category_id before writing', async () => {
    const api = mockApi({ getCategoryGroups: vi.fn(async () => GROUPS) });
    await expect(tool.handler(
      { account_id: A1, date: '2026-07-22', amount: -23.5, category_id: C_GHOST },
      { api, config: testConfig },
    )).rejects.toThrow(new RegExp(`categoría inexistente.*${C_GHOST}`, 'i'));
    expect(api.addTransactions).not.toHaveBeenCalled();
  });
  it('rejects a non-existent category_id inside splits before writing', async () => {
    const api = mockApi({ getCategoryGroups: vi.fn(async () => GROUPS) });
    await expect(tool.handler(
      { account_id: A1, date: '2026-07-22', amount: -180, splits: [
        { amount: -120, category_id: C1 }, { amount: -60, category_id: C_GHOST },
      ] },
      { api, config: testConfig },
    )).rejects.toThrow(/categoría inexistente/i);
    expect(api.addTransactions).not.toHaveBeenCalled();
  });
  it('does not read the category index when no category is given', async () => {
    let call = 0;
    const api = mockApi({
      runQuery: vi.fn(async () => {
        call += 1;
        if (call === 1) return { data: [{ id: 'tNo' }] };
        return { data: [{ id: 'tNo', date: '2026-07-22', account: A1, amount: -1000 }] };
      }),
    });
    await tool.handler({ account_id: A1, date: '2026-07-22', amount: -10 }, { api, config: testConfig });
    expect(api.getCategoryGroups).not.toHaveBeenCalled();
    expect(api.addTransactions).toHaveBeenCalled();
  });
});
