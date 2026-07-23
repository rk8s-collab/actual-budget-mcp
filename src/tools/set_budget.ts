import { z } from 'zod';
import { getCategoryIndex, categoryNotFound } from '../core/categories.js';
import { toCents, moneyFields } from '../core/money.js';
import { ID, type ToolDef } from '../core/types.js';
import { activeMessages, msg } from '../core/messages.js';

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: () => activeMessages().monthFormat });

const input = {
  operations: z.array(z.object({
    month: MONTH,
    category_id: ID,
    amount: z.number().min(0).describe('Units to budget for the category that month'),
    carryover: z.boolean().optional().describe('Enable/disable rollover of leftover balance'),
  })).min(1).max(50),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'set_budget',
  description: 'Assign budget amounts (units) to categories for given months — single cell or bulk (max 50 ops, e.g. applying a full monthly budget or copying a month). Per-operation results.',
  readOnly: false,
  // Sobrescribe el presupuesto asignado del mes: destructivo (en MCP, false = solo aditivo).
  annotations: { destructiveHint: true, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const succeeded: any[] = [];
    const failed: any[] = [];
    // Sin esta comprobación, un id inventado escribiría una celda huérfana.
    const cats = await getCategoryIndex(api);
    await api.batchBudgetUpdates(async () => {
      for (const op of a.operations) {
        const cat = cats.get(op.category_id);
        if (!cat) {
          failed.push({ month: op.month, category_id: op.category_id, error: categoryNotFound(msg(config), op.category_id) });
          continue;
        }
        try {
          const cents = toCents(op.amount);
          await api.setBudgetAmount(op.month, op.category_id, cents);
          if (op.carryover !== undefined) await api.setBudgetCarryover(op.month, op.category_id, op.carryover);
          succeeded.push({
            month: op.month, category_id: op.category_id, category_name: cat.name,
            ...moneyFields(cents, config.locale, config.currency),
          });
        } catch (err) {
          failed.push({ month: op.month, category_id: op.category_id, error: (err as Error).message ?? String(err) });
        }
      }
    });
    return { total: a.operations.length, success_count: succeeded.length, failure_count: failed.length, succeeded, failed };
  },
};
