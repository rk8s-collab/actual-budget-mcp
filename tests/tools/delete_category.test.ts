import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/delete_category.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';
const CX = '88888888-8888-4888-8888-888888888888';
const groups = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Housing', is_income: false, categories: [
  { id: C1, name: 'Traspaso', hidden: false },
  { id: C2, name: 'Rent', hidden: false },
] }];

const empty = { data: [] };
const three = { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };

describe('delete_category', () => {
  it('refuses without confirm_delete and points at the archive alternative', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => empty });
    await expect(tool.handler({ id: C1 }, { api, config: testConfig }))
      .rejects.toThrow(/update_category\(hidden: true\)/);
    expect(api.deleteCategory).not.toHaveBeenCalled();
  });

  it('deletes an unused category once confirmed', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => empty });
    const r: any = await tool.handler({ id: C1, confirm_delete: true }, { api, config: testConfig });
    expect(api.deleteCategory).toHaveBeenCalledWith(C1, undefined);
    expect(r).toMatchObject({ deleted: true, category: { id: C1, name: 'Traspaso' }, transactions_reassigned: 0 });
  });

  it('refuses to strand transactions when no destination is given', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => three });
    await expect(tool.handler({ id: C1, confirm_delete: true }, { api, config: testConfig }))
      .rejects.toThrow(/3 transactions|3 transacciones/);
    expect(api.deleteCategory).not.toHaveBeenCalled();
  });

  it('reassigns transactions to the destination category', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => three });
    const r: any = await tool.handler({ id: C1, confirm_delete: true, transfer_category_id: C2 }, { api, config: testConfig });
    expect(api.deleteCategory).toHaveBeenCalledWith(C1, C2);
    expect(r.transactions_reassigned).toBe(3);
    expect(r.reassigned_to).toMatchObject({ id: C2, name: 'Rent' });
  });

  it('rejects an unknown destination category', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => three });
    await expect(tool.handler({ id: C1, confirm_delete: true, transfer_category_id: CX }, { api, config: testConfig }))
      .rejects.toThrow(CX);
    expect(api.deleteCategory).not.toHaveBeenCalled();
  });

  it('rejects reassigning a category to itself', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => three });
    await expect(tool.handler({ id: C1, confirm_delete: true, transfer_category_id: C1 }, { api, config: testConfig }))
      .rejects.toThrow(/transfer_category_id/);
    expect(api.deleteCategory).not.toHaveBeenCalled();
  });

  it('rejects an unknown category id', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => empty });
    await expect(tool.handler({ id: CX, confirm_delete: true }, { api, config: testConfig })).rejects.toThrow(CX);
  });

  it('is flagged destructive', () => {
    expect(tool.annotations?.destructiveHint).toBe(true);
  });
});
