import { moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

export const tool: ToolDef = {
  name: 'get_net_worth',
  description: 'Full net worth: on-budget + off-budget (pensions, funds, mortgage) with per-account breakdown. Open accounts only.',
  readOnly: true,
  inputSchema: {},
  handler: async (_raw, { api, config }) => {
    const fmt = (c: number) => moneyFields(c, config.locale, config.currency);
    const open = (await api.getAccounts()).filter((a: any) => !a.closed);
    const bucket = (off: boolean) => {
      const accs = open.filter((a: any) => !!a.offbudget === off);
      const cents = accs.reduce((s: number, a: any) => s + (a.balance_current ?? 0), 0);
      return { total: fmt(cents), accounts: accs.map((a: any) => ({ name: a.name, ...fmt(a.balance_current ?? 0) })), cents };
    };
    const on = bucket(false);
    const offb = bucket(true);
    return {
      net_worth: fmt(on.cents + offb.cents),
      on_budget: { total: on.total, accounts: on.accounts },
      off_budget: { total: offb.total, accounts: offb.accounts },
    };
  },
};
