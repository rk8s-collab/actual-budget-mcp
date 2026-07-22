import { describe, it, expect } from 'vitest';
import { getCategoryIndex } from '../../src/core/categories.js';
import { mockApi } from '../helpers/mock-api.js';

// Los ids son UUID reales (convención del repo desde la task 1).
const G1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const GI = 'aaaaaaaa-2222-4222-8222-222222222222';
const C1 = 'cccccccc-1111-4111-8111-111111111111';
const CI = 'cccccccc-2222-4222-8222-222222222222';

const groups = [
  { id: G1, name: 'Comida', is_income: false, categories: [{ id: C1, name: 'Alimentacion' }] },
  { id: GI, name: 'Ingresos', is_income: true, categories: [{ id: CI, name: 'Nomina' }] },
];

describe('getCategoryIndex', () => {
  it('indexes every category with its group and income flag', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    const idx = await getCategoryIndex(api);
    expect(idx.get(C1)).toMatchObject({ id: C1, name: 'Alimentacion', group: 'Comida', is_income: false });
    expect(idx.get(CI)?.is_income).toBe(true);
    expect(idx.has('noexiste')).toBe(false);
  });

  it('tolerates groups without categories and a null response', async () => {
    const idx = await getCategoryIndex(mockApi({ getCategoryGroups: async () => [{ id: G1, name: 'Vacío' }] }));
    expect(idx.size).toBe(0);
    const empty = await getCategoryIndex(mockApi({ getCategoryGroups: async () => null }));
    expect(empty.size).toBe(0);
  });
});
