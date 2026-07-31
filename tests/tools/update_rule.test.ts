import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/update_rule.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const R1 = '11111111-1111-4111-8111-111111111111';
const RX = '99999999-9999-4999-8999-999999999999';
const CAT = '22222222-2222-4222-8222-222222222222';

const stored = [{ id: R1, stage: null, conditionsOp: 'and', conditions: [], actions: [] }];
const rule = {
  id: R1,
  stage: 'pre',
  conditionsOp: 'and',
  conditions: [{ field: 'notes', op: 'contains', value: 'rent' }],
  actions: [{ op: 'set', field: 'category', value: CAT }],
};

describe('update_rule', () => {
  it('sends the whole rule object including the id, as the API requires', async () => {
    const api = mockApi({ getRules: async () => stored, updateRule: async (r: any) => r });
    const r: any = await tool.handler(rule, { api, config: testConfig });
    expect(api.updateRule).toHaveBeenCalledWith(expect.objectContaining({ id: R1, stage: 'pre' }));
    expect(r).toMatchObject({ updated: true, rule: { id: R1 } });
  });

  it('rejects an unknown rule id before writing', async () => {
    const api = mockApi({ getRules: async () => stored });
    await expect(tool.handler({ ...rule, id: RX }, { api, config: testConfig })).rejects.toThrow(RX);
    expect(api.updateRule).not.toHaveBeenCalled();
  });

  it('converts amounts to cents', async () => {
    const api = mockApi({ getRules: async () => stored, updateRule: async (r: any) => r });
    await tool.handler({ ...rule, actions: [{ op: 'set', field: 'amount', value: 10.5 }] }, { api, config: testConfig });
    expect(api.updateRule.mock.calls[0][0].actions[0].value).toBe(1050);
  });

  it('still applies the rule refinement through the extended schema', async () => {
    const api = mockApi({ getRules: async () => stored });
    await expect(tool.handler({ ...rule, actions: [{ op: 'set', field: 'category', value: 'Rent' }] }, { api, config: testConfig }))
      .rejects.toThrow();
    expect(api.updateRule).not.toHaveBeenCalled();
  });
});
