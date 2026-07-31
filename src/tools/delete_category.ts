import { z } from 'zod';
import { getCategoryIndex } from '../core/categories.js';
import { countTransactionsForCategories } from '../core/taxonomy.js';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  id: ID.describe('Category UUID to delete (from get_categories)'),
  confirm_delete: z.boolean().default(false).describe('Must be true to actually delete. Deleting cannot be undone; consider update_category(hidden: true) to archive instead'),
  transfer_category_id: ID.optional().describe('Category the deleted category transactions are reassigned to. Required when the category has transactions'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'delete_category',
  title: 'Delete category',
  description: 'Permanently delete a category. Requires confirm_delete: true. If the category has transactions, transfer_category_id is mandatory and Actual reassigns them to it. To keep the history, archive with update_category(hidden: true) instead.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    const cats = await getCategoryIndex(api);
    const cat = cats.get(a.id);
    if (!cat) throw new Error(m.categoryNotFound(a.id));
    if (!a.confirm_delete) throw new Error(m.deleteCategoryNeedsConfirmation(cat.name));

    const txCount = await countTransactionsForCategories(api, [a.id]);
    if (a.transfer_category_id !== undefined) {
      if (a.transfer_category_id === a.id) throw new Error(m.cannotReassignToSelf);
      if (!cats.has(a.transfer_category_id)) throw new Error(m.categoryNotFound(a.transfer_category_id));
    } else if (txCount > 0) {
      // Actual would delete it anyway and leave the rows pointing at a dead id.
      throw new Error(m.deleteCategoryNeedsTarget(cat.name, txCount));
    }

    await api.deleteCategory(a.id, a.transfer_category_id);
    const sync = await syncAfterWrite(api);
    const target = a.transfer_category_id ? cats.get(a.transfer_category_id)! : null;
    return {
      deleted: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      category: { id: a.id, name: cat.name },
      transactions_reassigned: a.transfer_category_id ? txCount : 0,
      ...(target ? { reassigned_to: { id: target.id, name: target.name } } : {}),
    };
  },
};
