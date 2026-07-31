import { z } from 'zod';
import { getCategoryIndex } from '../core/categories.js';
import { getGroupIndex, countTransactionsForCategories } from '../core/taxonomy.js';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  id: ID.describe('Category group UUID to delete (from get_categories)'),
  confirm_delete: z.boolean().default(false).describe('Must be true to actually delete. Deleting a group also deletes every category inside it and cannot be undone'),
  transfer_category_id: ID.optional().describe('Category (in another group) the transactions of the deleted categories are reassigned to. Required when those categories have transactions'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'delete_category_group',
  title: 'Delete category group',
  description: 'Permanently delete a category group AND every category inside it. Requires confirm_delete: true. If those categories have transactions, transfer_category_id is mandatory — pass a category from another group and Actual reassigns them to it. To keep the history, archive with update_category_group(hidden: true) instead.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    const group = (await getGroupIndex(api)).get(a.id);
    if (!group) throw new Error(m.categoryGroupNotFound(a.id));
    if (!a.confirm_delete) throw new Error(m.deleteGroupNeedsConfirmation(group.name, group.categoryIds.length));

    const txCount = await countTransactionsForCategories(api, group.categoryIds);
    const cats = await getCategoryIndex(api);
    if (a.transfer_category_id !== undefined) {
      // A destination inside the group is about to be deleted too: the reassignment
      // would point at a dead category.
      if (group.categoryIds.includes(a.transfer_category_id)) throw new Error(m.cannotReassignToSelf);
      if (!cats.has(a.transfer_category_id)) throw new Error(m.categoryNotFound(a.transfer_category_id));
    } else if (txCount > 0) {
      throw new Error(m.deleteGroupNeedsTarget(group.name, txCount));
    }

    await api.deleteCategoryGroup(a.id, a.transfer_category_id);
    const sync = await syncAfterWrite(api);
    const target = a.transfer_category_id ? cats.get(a.transfer_category_id)! : null;
    return {
      deleted: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      group: { id: a.id, name: group.name },
      categories_deleted: group.categoryIds.length,
      transactions_reassigned: a.transfer_category_id ? txCount : 0,
      ...(target ? { reassigned_to: { id: target.id, name: target.name } } : {}),
    };
  },
};
