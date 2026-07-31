import { z } from 'zod';
import { syncAfterWrite } from '../core/write-sync.js';
import type { ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  name: z.string().min(1).max(100).describe('Group name, e.g. "Savings & Investment"'),
  is_income: z.boolean().default(false).describe('Income group (holds income categories) instead of a spending group'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'create_category_group',
  title: 'Create category group',
  description: 'Create a new category group (the top-level buckets that hold categories). Returns the created group with its id, ready to pass to create_category.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    const id = await api.createCategoryGroup({ name: a.name, is_income: a.is_income });
    const sync = await syncAfterWrite(api);
    return {
      created: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      group: { id, name: a.name, is_income: a.is_income },
    };
  },
};
