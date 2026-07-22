import { z } from 'zod';
import { moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato YYYY-MM-DD');

const input = {
  start_date: DATE,
  end_date: DATE,
  group_by: z.enum(['category', 'payee', 'month']).default('category'),
  include_income: z.boolean().default(false),
  top_n: z.number().int().min(1).optional().describe('Return top N rows and roll the rest into "others"'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_spending_summary',
  description: 'Aggregated spending by category, payee or month. Transfers always excluded. Spending amounts are positive; income negative. Sorted descending.',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const fmt = (c: number) => moneyFields(c, config.locale, config.currency);

    let q: any = api.q('transactions')
      .filter({ date: { $gte: a.start_date, $lte: a.end_date } })
      .filter({ transfer_id: null })
      .filter({ is_parent: false });
    const { data } = await api.runQuery(
      q.select(['category.name', 'category.group.is_income', 'payee.name', 'date', 'amount', 'transfer_id']),
    );

    const buckets = new Map<string, { cents: number; count: number }>();
    for (const t of data as any[]) {
      const isIncome = !!t['category.group.is_income'];
      if (!a.include_income && isIncome) continue;
      const key =
        a.group_by === 'month' ? String(t.date).slice(0, 7)
        : a.group_by === 'payee' ? (t['payee.name'] ?? 'Unknown')
        : (t['category.name'] ?? 'Uncategorized');
      const b = buckets.get(key) ?? { cents: 0, count: 0 };
      b.cents += -(t.amount ?? 0); // invert: spending positive
      b.count += 1;
      buckets.set(key, b);
    }

    let rows = [...buckets.entries()]
      .map(([key, b]) => ({ key, ...fmt(b.cents), transaction_count: b.count }))
      .sort((x, y) => y.amount - x.amount);
    if (a.group_by === 'month') rows = rows.sort((x, y) => x.key.localeCompare(y.key));

    let others;
    if (a.top_n && rows.length > a.top_n) {
      const tail = rows.slice(a.top_n);
      others = {
        ...fmt(tail.reduce((s, r) => s + Math.round(r.amount * 100), 0)),
        transaction_count: tail.reduce((s, r) => s + r.transaction_count, 0),
      };
      rows = rows.slice(0, a.top_n);
    }

    return { group_by: a.group_by, start_date: a.start_date, end_date: a.end_date, rows, ...(others ? { others } : {}) };
  },
};
