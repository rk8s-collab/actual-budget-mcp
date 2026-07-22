import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/update_category_note.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const groups = [{ id: 'g1', name: 'Comida', is_income: false, categories: [{ id: 'c1', name: 'Alimentacion', hidden: false }] }];

describe('update_category_note', () => {
  it('writes the note and echoes the stored value', async () => {
    const api = mockApi({
      getCategoryGroups: async () => groups,
      getNote: async () => ({ id: 'c1', note: '#template 350' }),
    });
    const r: any = await tool.handler({ category_id: 'c1', note: '#template 350' }, { api, config: testConfig });
    expect(api.updateNote).toHaveBeenCalledWith('c1', '#template 350');
    expect(r).toMatchObject({ updated: true, category_id: 'c1', category_name: 'Alimentacion', note: '#template 350' });
  });
  it('rejects unknown category ids', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ category_id: 'cX', note: 'x' }, { api, config: testConfig }))
      .rejects.toThrow(/cX/);
    expect(api.updateNote).not.toHaveBeenCalled();
  });
  it('echoes the real stored state (null) when the note is cleared', async () => {
    const api = mockApi({
      getCategoryGroups: async () => groups,
      getNote: async () => null,
    });
    const r: any = await tool.handler({ category_id: 'c1', note: '' }, { api, config: testConfig });
    expect(api.updateNote).toHaveBeenCalledWith('c1', '');
    expect(r.note).toBeNull();
  });
});
