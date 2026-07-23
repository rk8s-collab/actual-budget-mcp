import { z } from 'zod';
import { toCents, moneyFields } from '../core/money.js';
import { ID, type ToolDef } from '../core/types.js';
import { activeMessages, msg } from '../core/messages.js';

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: () => activeMessages().monthFormat });

const input = {
  month: MONTH,
  from_category_id: ID,
  to_category_id: ID,
  amount: z.number().positive().describe('Units to move'),
};
const schema = z.object(input).refine((v) => v.from_category_id !== v.to_category_id, {
  message: 'Las categorías de origen y destino deben ser distintas',
});

export const tool: ToolDef = {
  name: 'transfer_budget',
  description: 'Move budgeted money between two categories within a month. Returns both cells with their new budgeted values.',
  readOnly: false,
  // Reescribe el asignado de ambas categorías: destructivo (en MCP, false = solo aditivo).
  annotations: { destructiveHint: true, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const messages = msg(config);
    const cents = toCents(a.amount);
    const m = await api.getBudgetMonth(a.month);
    const cats = new Map<string, any>();
    for (const g of m.categoryGroups ?? []) for (const c of g.categories ?? []) cats.set(c.id, c);
    const from = cats.get(a.from_category_id);
    const to = cats.get(a.to_category_id);
    if (!from) throw new Error(messages.transferSourceMissing(a.month, a.from_category_id));
    if (!to) throw new Error(messages.transferTargetMissing(a.month, a.to_category_id));

    const newFrom = (from.budgeted ?? 0) - cents;
    const newTo = (to.budgeted ?? 0) + cents;
    await api.setBudgetAmount(a.month, a.from_category_id, newFrom);
    try {
      await api.setBudgetAmount(a.month, a.to_category_id, newTo);
    } catch (err) {
      // Compensar: dejar el origen como estaba. Un traspaso a medias es peor
      // que uno no hecho, y el usuario no lo vería en el mensaje de error.
      // Ojo: el throw de éxito va FUERA del try para que su propio catch no lo trague.
      let rolledBack = false;
      let rollbackMsg = '';
      try {
        await api.setBudgetAmount(a.month, a.from_category_id, from.budgeted ?? 0);
        rolledBack = true;
      } catch (rollbackErr) {
        rollbackMsg = (rollbackErr as Error).message;
      }
      if (rolledBack) {
        throw new Error(messages.transferRolledBack((err as Error).message));
      }
      throw new Error(messages.transferRollbackFailed((err as Error).message, rollbackMsg, from.name));
    }

    const fmt = (c: number) => moneyFields(c, config.locale, config.currency);
    return {
      transferred: fmt(cents),
      month: a.month,
      from: { category_id: from.id, name: from.name, budgeted: fmt(newFrom) },
      to: { category_id: to.id, name: to.name, budgeted: fmt(newTo) },
    };
  },
};
