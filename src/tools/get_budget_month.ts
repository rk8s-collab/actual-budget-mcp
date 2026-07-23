import { z } from 'zod';
import { moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';
import { key } from '../core/messages.js';

const input = {
  month: z.string().regex(/^\d{4}-\d{2}$/, key('monthFormat')),
  only_active: z.boolean().default(true).describe('Only categories with budgeted, spent or balance != 0'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_budget_month',
  description: 'Budget status for a month: to-budget, income, totals and per-category budgeted/spent/balance. Category ids included for set_budget.',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const fmt = (c: number) => moneyFields(c ?? 0, config.locale, config.currency);
    const m = await api.getBudgetMonth(a.month);

    const categories = [];
    for (const g of m.categoryGroups ?? []) {
      if (g.is_income) continue;
      for (const c of g.categories ?? []) {
        const active = (c.budgeted ?? 0) !== 0 || (c.spent ?? 0) !== 0 || (c.balance ?? 0) !== 0;
        if (a.only_active && !active) continue;
        categories.push({
          id: c.id, name: c.name, group: g.name,
          budgeted: fmt(c.budgeted), spent: fmt(c.spent), balance: fmt(c.balance),
        });
      }
    }
    return {
      month: m.month,
      to_budget: fmt(m.toBudget), income: fmt(m.totalIncome),
      // loot-core calcula total-budgeted como `-sumAmounts(...)`: llega con el signo
      // contrario al de las categorías de este mismo payload. Se normaliza aquí para no
      // dejar que el LLM adivine cuál de los dos criterios vale. El `|| 0` evita el -0.
      budgeted: fmt(-(m.totalBudgeted ?? 0) || 0), spent: fmt(m.totalSpent),
      categories,
    };
  },
};
