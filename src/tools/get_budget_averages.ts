import { z } from 'zod';
import { moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

export function lastCompleteMonths(n: number, today: Date = new Date()) {
  const months: string[] = [];
  const y = today.getFullYear(), m = today.getMonth(); // current (running) month excluded
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const endDate = new Date(Date.UTC(y, m, 0)); // last day of previous month
  return { start: `${months[0]}-01`, end: endDate.toISOString().slice(0, 10), months };
}

const input = {
  months_back: z.number().int().min(1).max(24).default(6).describe('Complete months to analyze (running month excluded)'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_budget_averages',
  title: 'Get category spending averages',
  description: 'Per-category spending average, median and max over the last N complete months — input for budget preparation. Median resists anomalous months. Spending positive; transfers and income excluded.',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const fmt = (c: number) => moneyFields(Math.round(c), config.locale, config.currency);
    const win = lastCompleteMonths(a.months_back);

    let q: any = api.q('transactions')
      .filter({ date: { $gte: win.start, $lte: win.end } })
      .filter({ transfer_id: null })
      .filter({ is_parent: false });
    const { data } = await api.runQuery(
      q.select(['category.id', 'category.name', 'category.group.name', 'category.group.is_income', 'date', 'amount']),
    );

    // category -> month -> cents spent
    const perCat = new Map<string, { name: string; group: string; byMonth: Map<string, number> }>();
    for (const t of data as any[]) {
      if (t['category.group.is_income']) continue;
      const id = t['category.id'] ?? '__uncategorized__';
      const entry = perCat.get(id) ?? {
        name: t['category.name'] ?? 'Uncategorized',
        group: t['category.group.name'] ?? '',
        byMonth: new Map(),
      };
      const month = String(t.date).slice(0, 7);
      entry.byMonth.set(month, (entry.byMonth.get(month) ?? 0) + -(t.amount ?? 0));
      perCat.set(id, entry);
    }

    const categories = [...perCat.entries()]
      .map(([id, e]) => {
        const values = [...e.byMonth.values()].sort((x, y) => x - y);
        const sum = values.reduce((s, v) => s + v, 0);
        const mid = Math.floor(values.length / 2);
        const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
        return {
          id, name: e.name, group: e.group,
          average: fmt(sum / a.months_back),
          median: fmt(median),
          max: fmt(values[values.length - 1] ?? 0),
          months_with_data: values.length,
        };
      })
      .sort((x, y) => y.average.amount - x.average.amount);

    return { months_back: a.months_back, months_analyzed: win.months, categories };
  },
};
