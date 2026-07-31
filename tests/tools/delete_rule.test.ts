import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/delete_rule.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const R1 = '11111111-1111-4111-8111-111111111111';
const RX = '99999999-9999-4999-8999-999999999999';
const rules = [{ id: R1, stage: null, conditionsOp: 'and', conditions: [], actions: [] }];

describe('delete_rule', () => {
  it('deletes an existing rule', async () => {
    const api = mockApi({ getRules: async () => rules });
    const r: any = await tool.handler({ id: R1 }, { api, config: testConfig });
    expect(api.deleteRule).toHaveBeenCalledWith(R1);
    expect(r).toMatchObject({ deleted: true, rule_id: R1 });
  });

  it('rejects an unknown rule id before writing', async () => {
    const api = mockApi({ getRules: async () => rules });
    await expect(tool.handler({ id: RX }, { api, config: testConfig })).rejects.toThrow(RX);
    expect(api.deleteRule).not.toHaveBeenCalled();
  });

  it('surfaces a false return as a failure instead of claiming success', async () => {
    const api = mockApi({ getRules: async () => rules, deleteRule: async () => false });
    await expect(tool.handler({ id: R1 }, { api, config: testConfig })).rejects.toThrow(R1);
  });

  it('syncs after deleting', async () => {
    const api = mockApi({ getRules: async () => rules });
    await tool.handler({ id: R1 }, { api, config: testConfig });
    expect(api.sync).toHaveBeenCalledTimes(1);
  });
});
