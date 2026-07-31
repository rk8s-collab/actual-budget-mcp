import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/delete_category_group.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '66666666-6666-4666-8666-666666666666';
const GX = '99999999-9999-4999-8999-999999999999';
const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';
const OTHER = '77777777-7777-4777-8777-777777777777';

const groups = [
  { id: G1, name: 'Legacy', is_income: false, categories: [
    { id: C1, name: 'Traspaso', hidden: false },
    { id: C2, name: 'Profesora', hidden: false },
  ] },
  { id: G2, name: 'Living', is_income: false, categories: [{ id: OTHER, name: 'Misc', hidden: false }] },
];

const empty = { data: [] };
const two = { data: [{ id: 'a' }, { id: 'b' }] };

describe('delete_category_group', () => {
  it('refuses without confirm_delete and says how many categories go with it', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => empty });
    await expect(tool.handler({ id: G1 }, { api, config: testConfig }))
      .rejects.toThrow(/2/);
    expect(api.deleteCategoryGroup).not.toHaveBeenCalled();
  });

  it('deletes an empty-of-transactions group once confirmed', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => empty });
    const r: any = await tool.handler({ id: G1, confirm_delete: true }, { api, config: testConfig });
    expect(api.deleteCategoryGroup).toHaveBeenCalledWith(G1, undefined);
    expect(r).toMatchObject({ deleted: true, group: { id: G1, name: 'Legacy' }, categories_deleted: 2, transactions_reassigned: 0 });
  });

  it('refuses to strand the child categories transactions', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => two });
    await expect(tool.handler({ id: G1, confirm_delete: true }, { api, config: testConfig }))
      .rejects.toThrow(/transfer_category_id/);
    expect(api.deleteCategoryGroup).not.toHaveBeenCalled();
  });

  it('reassigns to a category outside the group', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => two });
    const r: any = await tool.handler({ id: G1, confirm_delete: true, transfer_category_id: OTHER }, { api, config: testConfig });
    expect(api.deleteCategoryGroup).toHaveBeenCalledWith(G1, OTHER);
    expect(r.transactions_reassigned).toBe(2);
  });

  it('rejects a destination that is inside the group being deleted', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => two });
    await expect(tool.handler({ id: G1, confirm_delete: true, transfer_category_id: C2 }, { api, config: testConfig }))
      .rejects.toThrow(/transfer_category_id/);
    expect(api.deleteCategoryGroup).not.toHaveBeenCalled();
  });

  it('rejects an unknown group id', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => empty });
    await expect(tool.handler({ id: GX, confirm_delete: true }, { api, config: testConfig })).rejects.toThrow(GX);
  });
});
