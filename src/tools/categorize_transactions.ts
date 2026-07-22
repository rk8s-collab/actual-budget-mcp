import { z } from 'zod';
import type { ToolDef } from '../core/types.js';

const input = {
  updates: z.array(z.object({
    transaction_id: z.string().min(1),
    category_id: z.string().min(1),
  })).min(1).max(50).describe('Máx. 50 por llamada; cada item se aplica de forma independiente'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'categorize_transactions',
  description: 'Bulk-categorize transactions: [{transaction_id, category_id}] (max 50). Each update applies independently; the result names exactly which succeeded and which failed.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api }) => {
    const a = schema.parse(raw ?? {});
    const succeeded: any[] = [];
    const failed: any[] = [];
    for (const u of a.updates) {
      try {
        await api.updateTransaction(u.transaction_id, { category: u.category_id });
        succeeded.push({ transaction_id: u.transaction_id, category_id: u.category_id });
      } catch (err) {
        failed.push({ transaction_id: u.transaction_id, error: (err as Error).message ?? String(err) });
      }
    }
    return { total: a.updates.length, success_count: succeeded.length, failure_count: failed.length, succeeded, failed };
  },
};
