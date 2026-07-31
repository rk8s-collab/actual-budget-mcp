import { z } from 'zod';
import { getGroupIndex } from '../core/taxonomy.js';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  id: ID.describe('Category group UUID (from get_categories)'),
  name: z.string().min(1).max(100).optional().describe('New name'),
  hidden: z.boolean().optional().describe('true archives the group and its categories without deleting anything'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'update_category_group',
  title: 'Update category group',
  description: 'Rename a category group or archive it (hidden: true). Archiving is the non-destructive alternative to delete_category_group: nothing is lost and past transactions keep their categories.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    if (a.name === undefined && a.hidden === undefined) throw new Error(m.noGroupFieldToUpdate);
    const group = (await getGroupIndex(api)).get(a.id);
    if (!group) throw new Error(m.categoryGroupNotFound(a.id));
    // Actual does NOT merge: api/category-group-update forwards `fields` as-is and
    // the layer below reads group.name.toUpperCase(). Sending only { hidden } throws.
    const fields = {
      name: a.name ?? group.name,
      is_income: group.is_income,
      hidden: a.hidden ?? group.hidden,
    };
    await api.updateCategoryGroup(a.id, fields);
    const sync = await syncAfterWrite(api);
    return {
      updated: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      group: { id: a.id, name: fields.name, is_income: fields.is_income, hidden: fields.hidden },
    };
  },
};
