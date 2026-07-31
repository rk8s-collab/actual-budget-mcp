import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_rules.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const CAT = '11111111-1111-4111-8111-111111111111';
const rules = [
  { id: 'r1', stage: null, conditionsOp: 'and',
    conditions: [{ field: 'payee', op: 'contains', value: 'Landlord' }],
    actions: [{ op: 'set', field: 'category', value: CAT }] },
  { id: 'r2', stage: 'pre', conditionsOp: 'and',
    conditions: [{ field: 'amount', op: 'lt', value: -4550 }],
    actions: [{ op: 'set', field: 'notes', value: 'big' }] },
];

describe('get_rules', () => {
  it('returns the rules with amounts in units', async () => {
    const r: any = await tool.handler({}, { api: mockApi({ getRules: async () => rules }), config: testConfig });
    expect(r.rules).toHaveLength(2);
    expect(r.rules[1].conditions[0].value).toBe(-45.5);
    expect(r.rules[0].actions[0].value).toBe(CAT);
  });

  it('is a read tool', () => {
    expect(tool.readOnly).toBe(true);
  });

  it('tolerates an empty rule set', async () => {
    const r: any = await tool.handler({}, { api: mockApi(), config: testConfig });
    expect(r.rules).toEqual([]);
  });
});
