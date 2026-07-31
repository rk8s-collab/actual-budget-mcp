import { RULE_SHAPE, RULE_OBJECT, ruleToApi, ruleFromApi } from '../core/rule-schema.js';
import { syncAfterWrite } from '../core/write-sync.js';
import type { ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = RULE_SHAPE;

export const tool: ToolDef = {
  name: 'create_rule',
  title: 'Create rule',
  description: "Create an automation rule. Rules run on transactions as they are imported: a condition like payee contains 'X' with an action set category = <id> is how recurring movements classify themselves. Ids must be UUIDs from get_categories / get_payees / get_accounts; amounts are in currency units. Rules do not apply retroactively to existing transactions.",
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = RULE_OBJECT.parse(raw ?? {});
    const m = msg(config);
    const created = await api.createRule(ruleToApi(a));
    const sync = await syncAfterWrite(api);
    return {
      created: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      rule: ruleFromApi(created),
    };
  },
};
