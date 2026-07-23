import { describe, it, expect, vi, afterEach } from 'vitest';
import { tool } from '../../src/tools/transfer_budget.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';
import { setMessageLanguage } from '../../src/core/messages.js';

// El idioma activo es estado de módulo: restaurarlo o se contamina el resto del fichero.
afterEach(() => setMessageLanguage('es'));

// Los ids de entrada se validan como UUID (ID en src/core/types.ts).
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const CX = '99999999-9999-4999-8999-999999999999';

const month = {
  month: '2026-08',
  categoryGroups: [{ id: 'g1', name: 'Gastos', is_income: false, categories: [
    { id: C1, name: 'Alimentacion', budgeted: 35000 },
    { id: C2, name: 'Ocio', budgeted: 5000 },
  ] }],
};

describe('transfer_budget', () => {
  it('moves budget between categories and echoes new values', async () => {
    const api = mockApi({ getBudgetMonth: async () => month });
    const r: any = await tool.handler(
      { month: '2026-08', from_category_id: C1, to_category_id: C2, amount: 50 },
      { api, config: testConfig },
    );
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', C1, 30000);
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', C2, 10000);
    expect(r.from.budgeted.amount).toBe(300);
    expect(r.to.budgeted.amount).toBe(100);
    expect(r.transferred.amount).toBe(50);
  });
  it('rejects non-positive amounts and unknown categories', async () => {
    const api = mockApi({ getBudgetMonth: async () => month });
    await expect(tool.handler(
      { month: '2026-08', from_category_id: C1, to_category_id: C2, amount: 0 },
      { api, config: testConfig },
    )).rejects.toThrow();
    await expect(tool.handler(
      { month: '2026-08', from_category_id: CX, to_category_id: C2, amount: 10 },
      { api, config: testConfig },
    )).rejects.toThrow(CX);
  });
  it('reporta en inglés el mensaje de categorías distintas tras cambiar el idioma (Tarea 7)', async () => {
    setMessageLanguage('en');
    const api = mockApi({ getBudgetMonth: async () => month });
    await expect(tool.handler(
      { month: '2026-08', from_category_id: C1, to_category_id: C1, amount: 10 },
      { api, config: testConfig },
    )).rejects.toThrow('Source and destination categories must be different');
  });
  it('compensates the source when the second leg fails', async () => {
    const api = mockApi({ getBudgetMonth: async () => month });
    const calls: any[] = [];
    (api.setBudgetAmount as any) = vi.fn(async (m: string, cat: string, cents: number) => {
      calls.push([m, cat, cents]);
      if (cat === C2) throw new Error('fallo de red');
    });
    await expect(tool.handler(
      { month: '2026-08', from_category_id: C1, to_category_id: C2, amount: 50 },
      { api, config: testConfig },
    )).rejects.toThrow(/revertido y no se ha movido nada/);
    // origen restado y luego restaurado a su valor original
    expect(calls[0]).toEqual(['2026-08', C1, 30000]);
    expect(calls[calls.length - 1]).toEqual(['2026-08', C1, 35000]);
    expect(calls).toHaveLength(3);
  });
  it('reports both failures when the rollback also fails', async () => {
    const api = mockApi({ getBudgetMonth: async () => month });
    let n = 0;
    (api.setBudgetAmount as any) = vi.fn(async () => {
      n += 1;
      if (n >= 2) throw new Error(n === 2 ? 'fallo de red' : 'fallo al revertir');
    });
    await expect(tool.handler(
      { month: '2026-08', from_category_id: C1, to_category_id: C2, amount: 50 },
      { api, config: testConfig },
    )).rejects.toThrow(/ADEMÁS falló la reversión del origen \(fallo al revertir\).*Alimentacion/);
  });
});
