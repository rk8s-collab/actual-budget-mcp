import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/create_category.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const G1 = '11111111-1111-4111-8111-111111111111';
const GX = '99999999-9999-4999-8999-999999999999';
const NEW = '55555555-5555-4555-8555-555555555555';
const groups = [{ id: G1, name: 'Taxes', is_income: false, hidden: false, categories: [] }];

describe('create_category', () => {
  it('creates the category inside an existing group', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, createCategory: async () => NEW });
    const r: any = await tool.handler({ name: 'VAT', group_id: G1 }, { api, config: testConfig });
    expect(api.createCategory).toHaveBeenCalledWith({ name: 'VAT', group_id: G1, is_income: false });
    expect(r).toMatchObject({ created: true, category: { id: NEW, name: 'VAT', group_id: G1 } });
  });

  it('refuses an unknown group id before writing', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ name: 'VAT', group_id: GX }, { api, config: testConfig })).rejects.toThrow(GX);
    expect(api.createCategory).not.toHaveBeenCalled();
  });

  it('syncs after writing', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, createCategory: async () => NEW });
    await tool.handler({ name: 'VAT', group_id: G1 }, { api, config: testConfig });
    expect(api.sync).toHaveBeenCalledTimes(1);
  });
});
