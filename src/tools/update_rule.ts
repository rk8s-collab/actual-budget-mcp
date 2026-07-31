import { RULE_SHAPE, RULE_OBJECT, ruleToApi, ruleFromApi } from '../core/rule-schema.js';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  id: ID.describe('Rule UUID (from get_rules)'),
  ...RULE_SHAPE,
};

const schema = RULE_OBJECT.safeExtend({ id: ID });

export const tool: ToolDef = {
  name: 'update_rule',
  title: 'Update rule',
  description: "Replace an automation rule. Actual's API takes the WHOLE rule object, so send every field you want to keep — anything omitted is lost. Read the current rule with get_rules first. Amounts are in currency units.",
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    const rules = ((await api.getRules()) ?? []) as any[];
    if (!rules.some((r) => r.id === a.id)) throw new Error(m.ruleNotFound(a.id));
    const updated = await api.updateRule({ id: a.id, ...ruleToApi(a) });
    const sync = await syncAfterWrite(api);
    return {
      updated: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      rule: ruleFromApi(updated),
    };
  },
};
