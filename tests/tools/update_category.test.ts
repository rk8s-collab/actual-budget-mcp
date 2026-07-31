import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/update_category.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '66666666-6666-4666-8666-666666666666';
const GX = '99999999-9999-4999-8999-999999999999';
const C1 = '22222222-2222-4222-8222-222222222222';
const CX = '88888888-8888-4888-8888-888888888888';

const groups = [
  { id: G1, name: 'Housing', is_income: false, hidden: false, categories: [{ id: C1, name: 'Rent', hidden: false, is_income: false }] },
  { id: G2, name: 'Savings', is_income: false, hidden: false, categories: [] },
];

describe('update_category', () => {
  it('renames the category, keeping its group', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    const r: any = await tool.handler({ id: C1, name: 'Mortgage' }, { api, config: testConfig });
    expect(api.updateCategory).toHaveBeenCalledWith(C1, { name: 'Mortgage', group_id: G1, is_income: false, hidden: false });
    expect(r).toMatchObject({ updated: true, category: { id: C1, name: 'Mortgage', group_id: G1 } });
  });

  it('moves the category to another group', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    const r: any = await tool.handler({ id: C1, group_id: G2 }, { api, config: testConfig });
    expect(api.updateCategory).toHaveBeenCalledWith(C1, { name: 'Rent', group_id: G2, is_income: false, hidden: false });
    expect(r.category.group_id).toBe(G2);
  });

  it('sends the stored name when only hidden changes — a partial update crashes Actual', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await tool.handler({ id: C1, hidden: true }, { api, config: testConfig });
    expect(api.updateCategory).toHaveBeenCalledWith(C1, { name: 'Rent', group_id: G1, is_income: false, hidden: true });
  });

  it('rejects an unknown category id', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ id: CX, name: 'x' }, { api, config: testConfig })).rejects.toThrow(CX);
    expect(api.updateCategory).not.toHaveBeenCalled();
  });

  it('rejects a move into an unknown group', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ id: C1, group_id: GX }, { api, config: testConfig })).rejects.toThrow(GX);
    expect(api.updateCategory).not.toHaveBeenCalled();
  });

  it('demands at least one field to change', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ id: C1 }, { api, config: testConfig })).rejects.toThrow(/group_id/);
  });
});
