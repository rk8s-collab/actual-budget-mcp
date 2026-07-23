import { describe, it, expect, vi } from 'vitest';
import { getTransactionById, mapTxEcho, newIdFromDiff, reflectsFields, readBack } from '../../src/core/tx-read.js';
import { mockApi } from '../helpers/mock-api.js';

describe('getTransactionById', () => {
  it('queries by id with grouped splits and returns first row', async () => {
    const row = { id: 't1', date: '2026-07-01', account: 'a1', amount: -18000, subtransactions: [] };
    const api = mockApi({ runQuery: async () => ({ data: [row] }) });
    expect(await getTransactionById(api, 't1')).toEqual(row);
    const builder: any = (api.q as any).mock.results[0].value;
    expect(Object.assign({}, ...builder.calls.filter.flat())).toEqual({ id: 't1' });
    expect(builder.calls.options).toEqual([{ splits: 'grouped' }]);
  });
  it('returns null when not found', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [] }) });
    expect(await getTransactionById(api, 'nope')).toBeNull();
  });
});

describe('newIdFromDiff', () => {
  it('returns the only id when nothing existed before', () => {
    expect(newIdFromDiff(new Set(), ['t9'])).toEqual({ id: 't9', ambiguous: false });
  });
  it('returns id undefined (not found) when after adds nothing to before', () => {
    // Rama de degradación: sin fila nueva no hay nada que devolver. Las tools que la
    // consumen dependen de este `id: undefined` para no borrar el original.
    expect(newIdFromDiff(new Set(['t1', 't2']), ['t1', 't2'])).toEqual({ id: undefined, ambiguous: false });
  });
  it('returns the first new id and signals ambiguity when two rows appear', () => {
    expect(newIdFromDiff(new Set(['t1']), ['t1', 't8', 't9'])).toEqual({ id: 't8', ambiguous: true });
  });
});

describe('reflectsFields', () => {
  const row = { id: 't1', notes: 'nueva', amount: -4550, category: 'c9', cleared: 1 };
  it('accepts a row that already carries every written field', () => {
    expect(reflectsFields(row, { notes: 'nueva', amount: -4550 })).toBe(true);
  });
  it('rejects a row that still shows the previous value', () => {
    expect(reflectsFields(row, { notes: 'vieja' })).toBe(false);
  });
  it('compares cleared by truthiness: Actual guarda 1/0, la tool escribe true/false', () => {
    expect(reflectsFields(row, { cleared: true })).toBe(true);
    expect(reflectsFields(row, { cleared: false })).toBe(false);
  });
  it('rejects a missing row', () => {
    expect(reflectsFields(null, { notes: 'x' })).toBe(false);
  });
});

describe('readBack', () => {
  // api.updateTransaction() de Actual resuelve ANTES de que la escritura aterrice:
  // api/transaction-update devuelve handlers['transactions-batch-update'](diff)['updated']
  // sin await, así que una única re-lectura devuelve la fila anterior.
  const stale = { id: 't1', date: '2026-07-01', account: 'a1', amount: -4550, notes: 'vieja' };
  const fresh = { ...stale, notes: 'nueva' };

  it('waits for the write to land instead of echoing the previous row', async () => {
    let reads = 0;
    const api = mockApi({ runQuery: async () => ({ data: [reads++ < 2 ? stale : fresh] }) });
    const sleep = vi.fn(async () => {});
    const r = await readBack(api, 't1', { notes: 'nueva' }, { sleep });
    expect(r.row.notes).toBe('nueva');
    expect(r.settled).toBe(true);
    expect(sleep).toHaveBeenCalled();
  });

  it('does not sleep when the first read already reflects the write', async () => {
    const api = mockApi({ runQuery: vi.fn(async () => ({ data: [fresh] })) });
    const sleep = vi.fn(async () => {});
    const r = await readBack(api, 't1', { notes: 'nueva' }, { sleep });
    expect(r.settled).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
    expect(api.runQuery).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured attempts and says so', async () => {
    const api = mockApi({ runQuery: vi.fn(async () => ({ data: [stale] })) });
    const sleep = vi.fn(async () => {});
    const r = await readBack(api, 't1', { notes: 'nueva' }, { attempts: 3, sleep });
    expect(r.settled).toBe(false);
    expect(r.row.notes).toBe('vieja'); // se devuelve lo último leído, no una invención
    expect(api.runQuery).toHaveBeenCalledTimes(3);
  });
});

describe('mapTxEcho', () => {
  it('maps cents to units and includes splits when present', () => {
    const echo: any = mapTxEcho({
      id: 't1', date: '2026-07-01', account: 'a1', payee: 'p1', category: null,
      amount: -18000, notes: 'ticket', cleared: true,
      subtransactions: [
        { amount: -12000, category: 'c1' },
        { amount: -6000, category: 'c2', notes: 'casa' },
      ],
    }, 'en-US', 'USD');
    expect(echo.amount).toBe(-180);
    expect(echo.splits).toHaveLength(2);
    expect(echo.splits[0]).toMatchObject({ amount: -120, category_id: 'c1' });
    expect(echo.splits[1].notes).toBe('casa');
  });
  it('omits splits/notes/cleared when absent', () => {
    const echo: any = mapTxEcho({ id: 't2', date: '2026-07-02', account: 'a1', amount: 500 }, 'en-US', 'USD');
    expect(echo).not.toHaveProperty('splits');
    expect(echo).not.toHaveProperty('notes');
  });
});
