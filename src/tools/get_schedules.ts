import { z } from 'zod';
import { moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

const input = {
  include_completed: z.boolean().default(false),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_schedules',
  description: 'Recurring schedules configured in Actual (name, next date, amount).',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const { data } = await api.runQuery(
      api.q('schedules').select(['id', 'name', 'next_date', 'completed', '_amount']),
    );
    const schedules = (data as any[])
      .filter((s) => a.include_completed || !s.completed)
      .map((s) => {
        const cents = typeof s._amount === 'object' && s._amount !== null ? s._amount.num1 : (s._amount ?? 0);
        return { id: s.id, name: s.name ?? '', next_date: s.next_date, completed: !!s.completed, ...moneyFields(cents, config.locale, config.currency) };
      });
    return { schedules };
  },
};
