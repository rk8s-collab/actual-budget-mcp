import { z } from 'zod';
import { ruleFromApi } from '../core/rule-schema.js';
import type { ToolDef } from '../core/types.js';

const input = {};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_rules',
  title: 'List rules',
  description: "Actual's automation rules, with their IDs. Rules run on imported transactions and are how recurring movements classify themselves. Amounts are in currency units.",
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api }) => {
    schema.parse(raw ?? {});
    const rules = ((await api.getRules()) ?? []) as any[];
    return { rules: rules.map(ruleFromApi) };
  },
};
