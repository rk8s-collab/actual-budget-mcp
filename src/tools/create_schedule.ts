import { z } from 'zod';
import { toCents, moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato YYYY-MM-DD');

const input = {
  name: z.string().min(1).describe('Unique display name'),
  payee_name: z.string().min(1).describe('Existing payee, matched case-insensitively'),
  account_id: z.string().min(1),
  amount: z.number().describe('Units; negative = expense'),
  date: DATE.optional().describe('One-off schedule on this date (alternative to recurrence)'),
  recurrence: z.object({
    frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    start: DATE,
    interval: z.number().int().min(1).optional().describe('Every N periods (default 1)'),
    end_date: DATE.optional(),
    end_occurrences: z.number().int().min(1).optional(),
  }).optional(),
  auto_post: z.boolean().default(false).describe('Post the transaction automatically when due'),
};
const schema = z.object(input).refine((v) => !!v.date !== !!v.recurrence, {
  message: 'Indica exactamente uno: date (puntual) o recurrence (recurrente)',
});

export const tool: ToolDef = {
  name: 'create_schedule',
  description: 'Create a recurring (or one-off) scheduled transaction in Actual. Amount in currency units. Payee resolved by name from existing payees.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const payees = await api.getPayees();
    const wanted = a.payee_name.trim().toLowerCase();
    const payee = (payees as any[]).find((p) => (p.name ?? '').trim().toLowerCase() === wanted);
    if (!payee) {
      const options = (payees as any[]).map((p) => p.name).filter((n) => (n ?? '').toLowerCase().includes(wanted.slice(0, 4))).slice(0, 5);
      throw new Error(`Pagador no encontrado: "${a.payee_name}"${options.length ? ` — ¿quizá: ${options.join(', ')}?` : ''}`);
    }

    let date: any;
    if (a.date) {
      date = a.date;
    } else {
      const r = a.recurrence!;
      date = { frequency: r.frequency, start: r.start };
      if (r.interval) date.interval = r.interval;
      if (r.end_date) { date.endMode = 'on_date'; date.endDate = r.end_date; }
      else if (r.end_occurrences) { date.endMode = 'after_n_occurrences'; date.endOccurrences = r.end_occurrences; }
      else date.endMode = 'never';
    }

    const id = await api.createSchedule({
      name: a.name,
      payee: payee.id,
      account: a.account_id,
      amount: toCents(a.amount),
      amountOp: 'is',
      posts_transaction: a.auto_post,
      date,
    });
    return {
      created: true,
      schedule: {
        id,
        name: a.name,
        ...moneyFields(toCents(a.amount), config.locale, config.currency),
        recurrence: a.date ? { one_off: a.date } : a.recurrence,
      },
    };
  },
};
