import { z } from 'zod';
import { toCents, moneyFields } from '../core/money.js';
import { ID, type ToolDef } from '../core/types.js';

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes en formato YYYY-MM');

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
  annotations: { destructiveHint: false, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const succeeded: any[] = [];
    const failed: any[] = [];
    await api.batchBudgetUpdates(async () => {
      for (const op of a.operations) {
        try {
          const cents = toCents(op.amount);
          await api.setBudgetAmount(op.month, op.category_id, cents);
          if (op.carryover !== undefined) await api.setBudgetCarryover(op.month, op.category_id, op.carryover);
          succeeded.push({ month: op.month, category_id: op.category_id, ...moneyFields(cents, config.locale, config.currency) });
        } catch (err) {
          failed.push({ month: op.month, category_id: op.category_id, error: (err as Error).message ?? String(err) });
        }
      }
    });
    return { total: a.operations.length, success_count: succeeded.length, failure_count: failed.length, succeeded, failed };
  },
};
