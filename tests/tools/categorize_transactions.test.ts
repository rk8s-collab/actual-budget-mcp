import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/categorize_transactions.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

// Los ids de entrada se validan como UUID (ID en src/core/types.ts).
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const C1 = 'cccccccc-1111-4111-8111-111111111111';
const C2 = 'cccccccc-2222-4222-8222-222222222222';
const C_GHOST = 'cccccccc-9999-4999-8999-999999999999';

const GROUPS = [
  { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Comida', is_income: false, categories: [
    { id: C1, name: 'Alimentacion' }, { id: C2, name: 'Restaurantes' },
  ] },
];

describe('categorize_transactions', () => {
  it('applies each update independently and reports per-item results', async () => {
    const api = mockApi({
      getCategoryGroups: vi.fn(async () => GROUPS),
      // La misma respuesta sirve para la pre-lectura (id/is_child/is_parent) y para la
      // re-lectura de confirmación (id/category): las categorías ya son las escritas.
      runQuery: async () => ({ data: [
        { id: T1, is_child: false, is_parent: false, category: C1 },
        { id: T2, is_child: false, is_parent: false },
        { id: T3, is_child: false, is_parent: false, category: C2 },
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
    // Los lotes deben ser legibles en la aprobación: nombre además del id.
    expect(r.succeeded[0]).toMatchObject({ category_id: C1, category_name: 'Alimentacion' });
    expect(r.succeeded[1]).toMatchObject({ category_id: C2, category_name: 'Restaurantes' });
  });
  it('rejects a well-formed but non-existent category id without writing', async () => {
    const api = mockApi({
      getCategoryGroups: vi.fn(async () => GROUPS),
      runQuery: async () => ({ data: [
        { id: T1, is_child: false, is_parent: false },
        { id: T2, is_child: false, is_parent: false, category: C2 },
      ] }),
    });
    const r: any = await tool.handler(
      { updates: [
        { transaction_id: T1, category_id: C_GHOST },
        { transaction_id: T2, category_id: C2 },
      ] },
      { api, config: testConfig },
    );
    expect(r).toMatchObject({ total: 2, success_count: 1, failure_count: 1 });
    expect(r.failed[0]).toMatchObject({ transaction_id: T1 });
    expect(r.failed[0].error).toMatch(/categoría inexistente/i);
    expect(r.failed[0].error).toContain(C_GHOST);
    expect(api.updateTransaction).toHaveBeenCalledTimes(1);
    expect(api.updateTransaction).toHaveBeenCalledWith(T2, { category: C2 });
    // El índice se lee una sola vez por lote.
    expect(api.getCategoryGroups).toHaveBeenCalledTimes(1);
  });
  it('guards split children/parents and missing ids via a batched pre-read', async () => {
    const api = mockApi({
      getCategoryGroups: vi.fn(async () => GROUPS),
      runQuery: async () => ({ data: [
        { id: T1, is_child: false, is_parent: false, category: C1 },
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
  it('only counts as succeeded what it can confirm by re-reading', async () => {
    // api.updateTransaction() resuelve antes de que la escritura aterrice, así que "no
    // lanzó" no es prueba de nada: hay que releer. Aquí t1 tarda una vuelta en reflejarse.
    let reads = 0;
    const api = mockApi({
      getCategoryGroups: vi.fn(async () => GROUPS),
      runQuery: async () => {
        reads++;
        if (reads === 1) return { data: [{ id: T1, is_child: false, is_parent: false }] }; // pre-lectura
        if (reads === 2) return { data: [{ id: T1, category: 'todavia-la-vieja' }] };
        return { data: [{ id: T1, category: C1 }] };
      },
    });
    const r: any = await tool.handler(
      { updates: [{ transaction_id: T1, category_id: C1 }] },
      { api, config: testConfig },
    );
    expect(r).toMatchObject({ total: 1, success_count: 1, failure_count: 0, unconfirmed_count: 0 });
    expect(r.succeeded[0]).toMatchObject({ transaction_id: T1, category_id: C1 });
  });

  it('separates writes it could not confirm from the ones that succeeded', async () => {
    let reads = 0;
    const api = mockApi({
      getCategoryGroups: vi.fn(async () => GROUPS),
      runQuery: async () => {
        reads++;
        if (reads === 1) {
          return { data: [
            { id: T1, is_child: false, is_parent: false },
            { id: T2, is_child: false, is_parent: false },
          ] };
        }
        // t1 se refleja; t2 no llega nunca.
        return { data: [{ id: T1, category: C1 }, { id: T2, category: 'todavia-la-vieja' }] };
      },
    });
    const r: any = await tool.handler(
      { updates: [
        { transaction_id: T1, category_id: C1 },
        { transaction_id: T2, category_id: C2 },
      ] },
      { api, config: testConfig },
    );
    expect(r).toMatchObject({ total: 2, success_count: 1, failure_count: 0, unconfirmed_count: 1 });
    expect(r.succeeded.map((s: any) => s.transaction_id)).toEqual([T1]);
    expect(r.unconfirmed[0]).toMatchObject({ transaction_id: T2, category_id: C2 });
    // Las cuentas tienen que cuadrar siempre: nada se pierde entre buckets.
    expect(r.success_count + r.failure_count + r.unconfirmed_count).toBe(r.total);
  });

  it('rejects more than 50 updates', async () => {
    const updates = Array.from({ length: 51 }, (_, i) => ({
      transaction_id: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
      category_id: C1,
    }));
    await expect(tool.handler({ updates }, { api: mockApi(), config: testConfig })).rejects.toThrow();
  });
});
