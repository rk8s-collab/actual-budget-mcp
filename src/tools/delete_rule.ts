import { z } from 'zod';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  id: ID.describe('Rule UUID (from get_rules)'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'delete_rule',
  title: 'Delete rule',
  description: 'Delete an automation rule. Past transactions keep whatever the rule already applied to them; only future imports change.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    const rules = ((await api.getRules()) ?? []) as any[];
    if (!rules.some((r) => r.id === a.id)) throw new Error(m.ruleNotFound(a.id));
    // deleteRule returns a boolean: a false is a refusal, not a success.
    const ok = await api.deleteRule(a.id);
    if (ok === false) throw new Error(m.ruleDeleteRejected(a.id));
    const sync = await syncAfterWrite(api);
    return {
      deleted: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      rule_id: a.id,
    };
  },
};
