import { z } from 'zod';
import { getGroupIndex } from '../core/taxonomy.js';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  name: z.string().min(1).max(100).describe('Category name, e.g. "VAT"'),
  group_id: ID.describe('Category group UUID the category belongs to (from get_categories or create_category_group)'),
  is_income: z.boolean().default(false).describe('Income category instead of a spending one'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'create_category',
  title: 'Create category',
  description: 'Create a category inside an existing category group. Returns the created category with its id, ready for categorize_transactions or set_budget.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    // Actual accepts any UUID-shaped group id and would strand the category:
    // validate before writing, the same way the other write tools do.
    if (!(await getGroupIndex(api)).has(a.group_id)) throw new Error(m.categoryGroupNotFound(a.group_id));
    const id = await api.createCategory({ name: a.name, group_id: a.group_id, is_income: a.is_income });
    const sync = await syncAfterWrite(api);
    return {
      created: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      category: { id, name: a.name, group_id: a.group_id, is_income: a.is_income },
    };
  },
};
