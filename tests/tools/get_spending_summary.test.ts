import { describe, it, expect, afterEach } from 'vitest';
import { tool } from '../../src/tools/get_spending_summary.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';
import { setMessageLanguage } from '../../src/core/messages.js';

// El idioma activo es estado de módulo: restaurarlo o se contamina el resto del fichero.
afterEach(() => setMessageLanguage('es'));

const rows = [
  { 'category.name': 'Alimentacion', 'category.group.is_income': false, 'payee.name': 'Mercadona', date: '2026-06-03', amount: -112340, transfer_id: null },
  { 'category.name': 'Alimentacion', 'category.group.is_income': false, 'payee.name': 'Lidl', date: '2026-06-20', amount: -63210, transfer_id: null },
  { 'category.name': 'Ropa', 'category.group.is_income': false, 'payee.name': 'Zara', date: '2026-06-10', amount: -8420, transfer_id: null },
  { 'category.name': 'Salary', 'category.group.is_income': true, 'payee.name': 'Taiko', date: '2026-06-01', amount: 350000, transfer_id: null },
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
    expect(r.others).toMatchObject({ amount: 84.20, transaction_count: 1 });
  });
  it('reporta en inglés el mensaje de rango excesivo tras cambiar el idioma (Tarea 7)', async () => {
    setMessageLanguage('en');
    const api = mockApi({ runQuery: async () => ({ data: rows }) });
    await expect(tool.handler(
      { start_date: '2020-01-01', end_date: '2027-01-01' },
      { api, config: testConfig },
    )).rejects.toThrow('The date range cannot exceed 5 years; shorten start_date/end_date.');
  });
});
