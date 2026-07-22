import { describe, it, expect } from 'vitest';
import { getTransactionById, mapTxEcho } from '../../src/core/tx-read.js';
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
