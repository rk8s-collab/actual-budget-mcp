import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/update_category_group.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const G1 = '11111111-1111-4111-8111-111111111111';
const GX = '99999999-9999-4999-8999-999999999999';
const groups = [{ id: G1, name: 'Housing', is_income: false, hidden: false, categories: [] }];

describe('update_category_group', () => {
  it('renames the group', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    const r: any = await tool.handler({ id: G1, name: 'Home' }, { api, config: testConfig });
    expect(api.updateCategoryGroup).toHaveBeenCalledWith(G1, { name: 'Home', is_income: false, hidden: false });
    expect(r).toMatchObject({ updated: true, group: { id: G1, name: 'Home', hidden: false } });
  });

  it('sends the stored name when only hidden changes — a partial update crashes Actual', async () => {
    // api/category-group-update passes fields straight through and the layer below
    // does group.name.toUpperCase(): omitting name is a TypeError, not a no-op.
    const api = mockApi({ getCategoryGroups: async () => groups });
    await tool.handler({ id: G1, hidden: true }, { api, config: testConfig });
    expect(api.updateCategoryGroup).toHaveBeenCalledWith(G1, { name: 'Housing', is_income: false, hidden: true });
  });

  it('rejects an unknown group id before writing', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ id: GX, name: 'x' }, { api, config: testConfig })).rejects.toThrow(GX);
    expect(api.updateCategoryGroup).not.toHaveBeenCalled();
  });

  it('demands at least one field to change', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ id: G1 }, { api, config: testConfig })).rejects.toThrow(/name, hidden/);
    expect(api.updateCategoryGroup).not.toHaveBeenCalled();
  });

  it('syncs after writing', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await tool.handler({ id: G1, name: 'Home' }, { api, config: testConfig });
    expect(api.sync).toHaveBeenCalledTimes(1);
  });
});
