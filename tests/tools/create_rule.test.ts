import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/create_rule.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const CAT = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';

const rule = {
  stage: null,
  conditionsOp: 'and',
  conditions: [{ field: 'payee', op: 'contains', value: 'Revolut Vault' }],
  actions: [{ op: 'set', field: 'category', value: CAT }],
};

describe('create_rule', () => {
  it('creates the rule and echoes it with its id', async () => {
    const api = mockApi({ createRule: async (r: any) => ({ id: NEW, ...r }) });
    const r: any = await tool.handler(rule, { api, config: testConfig });
    expect(api.createRule).toHaveBeenCalledWith(expect.objectContaining({
      stage: null,
      conditionsOp: 'and',
      conditions: [expect.objectContaining({ field: 'payee', op: 'contains', value: 'Revolut Vault' })],
    }));
    expect(r).toMatchObject({ created: true, rule: { id: NEW } });
  });

  it('converts amounts to cents on the way in and back to units in the echo', async () => {
    const api = mockApi({ createRule: async (r: any) => ({ id: NEW, ...r }) });
    const withAmount = { ...rule, conditions: [{ field: 'amount', op: 'lt', value: -45.5 }] };
    const r: any = await tool.handler(withAmount, { api, config: testConfig });
    expect(api.createRule.mock.calls[0][0].conditions[0].value).toBe(-4550);
    expect(r.rule.conditions[0].value).toBe(-45.5);
  });

  it('refuses a rule with no conditions', async () => {
    const api = mockApi();
    await expect(tool.handler({ ...rule, conditions: [] }, { api, config: testConfig })).rejects.toThrow();
    expect(api.createRule).not.toHaveBeenCalled();
  });

  it('refuses a non-UUID category in a set action', async () => {
    const api = mockApi();
    await expect(tool.handler({ ...rule, actions: [{ op: 'set', field: 'category', value: 'Rent' }] }, { api, config: testConfig }))
      .rejects.toThrow();
    expect(api.createRule).not.toHaveBeenCalled();
  });

  it('syncs after writing', async () => {
    const api = mockApi({ createRule: async (r: any) => ({ id: NEW, ...r }) });
    await tool.handler(rule, { api, config: testConfig });
    expect(api.sync).toHaveBeenCalledTimes(1);
  });
});
