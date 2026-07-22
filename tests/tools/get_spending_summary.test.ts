import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_spending_summary.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const rows = [
  { 'category.name': 'Alimentacion', 'category.group.is_income': false, 'payee.name': 'Mercadona', date: '2026-06-03', amount: -100000, transfer_id: null },
  { 'category.name': 'Alimentacion', 'category.group.is_income': false, 'payee.name': 'Lidl', date: '2026-06-20', amount: -63210, transfer_id: null },
  { 'category.name': 'Ropa', 'category.group.is_income': false, 'payee.name': 'Zara', date: '2026-06-10', amount: -8997, transfer_id: null },
  { 'category.name': 'Salary', 'category.group.is_income': true, 'payee.name': 'Taiko', date: '2026-06-01', amount: 300000, transfer_id: null },
];

describe('get_spending_summary', () => {
  it('groups by category, inverts sign, excludes income by default, sorts desc', async () => {
    const api = mockApi({ runQuery: async () => ({ data: rows }) });
    const r: any = await tool.handler({ start_date: '2026-06-01', end_date: '2026-06-30' }, { api, config: testConfig });
    expect(r.rows.map((x: any) => x.key)).toEqual(['Alimentacion', 'Ropa']);
    expect(r.rows[0]).toMatchObject({ amount: 1755.50, transaction_count: 2 });
  });
  it('groups by month across categories', async () => {
    const api = mockApi({ runQuery: async () => ({ data: rows }) });
    const r: any = await tool.handler(
      { start_date: '2026-06-01', end_date: '2026-06-30', group_by: 'month' },
      { api, config: testConfig },
    );
    expect(r.rows).toEqual([expect.objectContaining({ key: '2026-06', amount: 1839.70 })]);
  });
  it('rolls tail into others with top_n', async () => {
    const api = mockApi({ runQuery: async () => ({ data: rows }) });
    const r: any = await tool.handler(
      { start_date: '2026-06-01', end_date: '2026-06-30', top_n: 1 },
      { api, config: testConfig },
    );
    expect(r.rows).toHaveLength(1);
    expect(r.others).toMatchObject({ amount: 89.97, transaction_count: 1 });
  });
});
