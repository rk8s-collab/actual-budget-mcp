import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/update_category_note.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

// Los ids de entrada se validan como UUID (ID en src/core/types.ts).
const C1 = '11111111-1111-4111-8111-111111111111';
const CX = '99999999-9999-4999-8999-999999999999';

const groups = [{ id: 'g1', name: 'Comida', is_income: false, categories: [{ id: C1, name: 'Alimentacion', hidden: false }] }];

describe('update_category_note', () => {
  it('writes the note and echoes the stored value', async () => {
    const api = mockApi({
      getCategoryGroups: async () => groups,
      getNote: async () => ({ id: C1, note: '#template 350' }),
    });
    const r: any = await tool.handler({ category_id: C1, note: '#template 350' }, { api, config: testConfig });
    expect(api.updateNote).toHaveBeenCalledWith(C1, '#template 350');
    expect(r).toMatchObject({ updated: true, category_id: C1, category_name: 'Alimentacion', note: '#template 350' });
  });
  it('rejects unknown category ids', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ category_id: CX, note: 'x' }, { api, config: testConfig }))
      .rejects.toThrow(CX);
    expect(api.updateNote).not.toHaveBeenCalled();
  });
  it('echoes the real stored state (null) when the note is cleared', async () => {
    const api = mockApi({
      getCategoryGroups: async () => groups,
      getNote: async () => null,
    });
    const r: any = await tool.handler({ category_id: C1, note: '' }, { api, config: testConfig });
    expect(api.updateNote).toHaveBeenCalledWith(C1, '');
    expect(r.note).toBeNull();
  });
});
