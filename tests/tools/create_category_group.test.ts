import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/create_category_group.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const NEW = '44444444-4444-4444-8444-444444444444';

describe('create_category_group', () => {
  it('creates the group and echoes it', async () => {
    const api = mockApi({ createCategoryGroup: async () => NEW });
    const r: any = await tool.handler({ name: 'Savings & Investment' }, { api, config: testConfig });
    expect(api.createCategoryGroup).toHaveBeenCalledWith({ name: 'Savings & Investment', is_income: false });
    expect(r).toEqual({ created: true, group: { id: NEW, name: 'Savings & Investment', is_income: false } });
  });

  it('passes is_income through', async () => {
    const api = mockApi({ createCategoryGroup: async () => NEW });
    const r: any = await tool.handler({ name: 'Salary', is_income: true }, { api, config: testConfig });
    expect(api.createCategoryGroup).toHaveBeenCalledWith({ name: 'Salary', is_income: true });
    expect(r.group.is_income).toBe(true);
  });

  it('syncs after writing', async () => {
    const api = mockApi({ createCategoryGroup: async () => NEW });
    await tool.handler({ name: 'X' }, { api, config: testConfig });
    expect(api.sync).toHaveBeenCalledTimes(1);
  });

  it('reports a failed sync without failing the creation', async () => {
    const api = mockApi({
      createCategoryGroup: async () => NEW,
      sync: async () => { throw new Error('offline'); },
    });
    const r: any = await tool.handler({ name: 'X' }, { api, config: testConfig });
    expect(r.created).toBe(true);
    expect(r.sync_pending).toBe(true);
    expect(r.note).toContain('offline');
  });

  it('rejects an empty name before touching the API', async () => {
    const api = mockApi();
    await expect(tool.handler({ name: '' }, { api, config: testConfig })).rejects.toThrow();
    expect(api.createCategoryGroup).not.toHaveBeenCalled();
  });

  it('is a write tool', () => {
    expect(tool.readOnly).toBe(false);
  });
});
