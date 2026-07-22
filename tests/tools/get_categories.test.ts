import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_categories.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const groups = [
  { id: 'g1', name: 'Comida', is_income: false, categories: [
    { id: 'c1', name: 'Alimentacion', hidden: false, group_id: 'g1' },
    { id: 'c2', name: 'Oculta', hidden: true, group_id: 'g1' },
  ]},
  { id: 'g2', name: 'Income', is_income: true, categories: [{ id: 'c3', name: 'Salary', hidden: false, group_id: 'g2' }] },
];

describe('get_categories', () => {
  it('returns groups with visible categories by default', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    const r: any = await tool.handler({}, { api, config: testConfig });
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0].categories.map((c: any) => c.id)).toEqual(['c1']);
    expect(r.groups[1].is_income).toBe(true);
  });
  it('includes hidden and notes on demand', async () => {
    const api = mockApi({
      getCategoryGroups: async () => groups,
      getNote: async (id: string) => (id === 'c1' ? { id, note: '#template 350' } : null),
    });
    const r: any = await tool.handler({ include_hidden: true, include_notes: true }, { api, config: testConfig });
    expect(r.groups[0].categories).toHaveLength(2);
    expect(r.groups[0].categories[0].note).toBe('#template 350');
  });
});
