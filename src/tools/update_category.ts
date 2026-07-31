import { z } from 'zod';
import { getGroupIndex } from '../core/taxonomy.js';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  id: ID.describe('Category UUID (from get_categories)'),
  name: z.string().min(1).max(100).optional().describe('New name'),
  group_id: ID.optional().describe('Move the category to this category group'),
  hidden: z.boolean().optional().describe('true archives the category without deleting anything'),
};
const schema = z.object(input);

/** The stored category plus the id of the group that owns it. */
async function findCategory(api: any, id: string): Promise<{ name: string; group_id: string; is_income: boolean; hidden: boolean } | null> {
  for (const g of (await api.getCategoryGroups()) ?? []) {
    for (const c of g.categories ?? []) {
      if (c.id === id) {
        return { name: c.name, group_id: g.id, is_income: !!c.is_income, hidden: !!c.hidden };
      }
    }
  }
  return null;
}

export const tool: ToolDef = {
  name: 'update_category',
  title: 'Update category',
  description: 'Rename a category, move it to another group, or archive it (hidden: true). Archiving is the non-destructive alternative to delete_category: past transactions keep their category.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    if (a.name === undefined && a.group_id === undefined && a.hidden === undefined) {
      throw new Error(m.noCategoryFieldToUpdate);
    }
    const current = await findCategory(api, a.id);
    if (!current) throw new Error(m.categoryNotFound(a.id));
    if (a.group_id !== undefined && !(await getGroupIndex(api)).has(a.group_id)) {
      throw new Error(m.categoryGroupNotFound(a.group_id));
    }
    // Same trap as update_category_group: Actual forwards `fields` unmerged and
    // then does category.name.trim(), so the full record has to travel.
    const fields = {
      name: a.name ?? current.name,
      group_id: a.group_id ?? current.group_id,
      is_income: current.is_income,
      hidden: a.hidden ?? current.hidden,
    };
    await api.updateCategory(a.id, fields);
    const sync = await syncAfterWrite(api);
    return {
      updated: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      category: { id: a.id, ...fields },
    };
  },
};
