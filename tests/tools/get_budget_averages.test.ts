import { describe, it, expect } from 'vitest';
import { tool, lastCompleteMonths } from '../../src/tools/get_budget_averages.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

describe('lastCompleteMonths', () => {
  it('excludes the running month', () => {
    const w = lastCompleteMonths(3, new Date('2026-07-21'));
    expect(w.months).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(w.start).toBe('2026-04-01');
    expect(w.end).toBe('2026-06-30');
  });
});

describe('get_budget_averages', () => {
  it('computes average, median and max per category', async () => {
    const rows = [
      { 'category.id': 'c1', 'category.name': 'Alimentacion', 'category.group.name': 'Comida', 'category.group.is_income': false, date: '2026-04-10', amount: -30000 },
      { 'category.id': 'c1', 'category.name': 'Alimentacion', 'category.group.name': 'Comida', 'category.group.is_income': false, date: '2026-05-10', amount: -50000 },
      { 'category.id': 'c1', 'category.name': 'Alimentacion', 'category.group.name': 'Comida', 'category.group.is_income': false, date: '2026-06-10', amount: -100000 },
    ];
    const api = mockApi({ runQuery: async () => ({ data: rows }) });
    const r: any = await tool.handler({ months_back: 3 }, { api, config: testConfig });
    const cat = r.categories[0];
    expect(cat).toMatchObject({ id: 'c1', months_with_data: 3 });
    expect(cat.average.amount).toBe(600);   // (300+500+1000)/3
    expect(cat.median.amount).toBe(500);
    expect(cat.max.amount).toBe(1000);
  });
});
