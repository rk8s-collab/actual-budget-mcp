import { z } from 'zod';
import { moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

const input = {
  include_closed: z.boolean().default(false).describe('Include closed accounts'),
  include_off_budget: z.boolean().default(true).describe('Include off-budget accounts (pensions, funds, mortgage)'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_accounts',
  description: 'List accounts with current balances. Off-budget accounts (pensions, funds, mortgage) included by default.',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const args = schema.parse(raw ?? {});
    const all = await api.getAccounts();
    const accounts = all
      .filter((a: any) => (args.include_closed || !a.closed) && (args.include_off_budget || !a.offbudget))
      .map((a: any) => ({
        id: a.id,
        name: a.name,
        on_budget: !a.offbudget,
        closed: !!a.closed,
        ...moneyFields(a.balance_current ?? 0, config.locale, config.currency),
      }));
    return { accounts, total_count: accounts.length };
  },
};
