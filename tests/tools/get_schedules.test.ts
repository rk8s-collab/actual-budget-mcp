import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_schedules.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const rows = [
  { id: 's1', name: 'Hipoteca', next_date: '2026-08-01', completed: false, _amount: -85000 },
  { id: 's2', name: 'Gimnasio (aprox)', next_date: '2026-08-05', completed: false, _amount: { num1: -3500, num2: -4000 } },
  { id: 's3', name: 'Terminado', next_date: '2026-01-01', completed: true, _amount: -1000 },
];

describe('get_schedules', () => {
  it('excludes completed by default and normalizes amounts', async () => {
    const api = mockApi({ runQuery: async () => ({ data: rows }) });
    const r: any = await tool.handler({}, { api, config: testConfig });
    expect(r.schedules).toHaveLength(2);
    expect(r.schedules[0]).toMatchObject({ name: 'Hipoteca', amount: -850 });
    expect(r.schedules[1].amount).toBe(-35);
  });
  it('includes completed on demand', async () => {
    const api = mockApi({ runQuery: async () => ({ data: rows }) });
    const r: any = await tool.handler({ include_completed: true }, { api, config: testConfig });
    expect(r.schedules).toHaveLength(3);
  });
});
