// getNetWorth.js — Calcula el patrimonio neto (suma de balances de cuentas abiertas)
import { api } from '../actualClient.js';

export const definition = {
  name: 'get_net_worth',
  description:
    'Calcula el patrimonio neto actual sumando los balances de todas las cuentas abiertas (on-budget). Devuelve el total y un desglose por cuenta en euros.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export async function handler() {
  const accounts = await api.getAccounts();

  // Solo cuentas abiertas y on-budget
  const activeAccounts = accounts.filter((a) => !a.closed && !a.offbudget);

  let totalBalance = 0;
  const accountsSummary = activeAccounts.map((acc) => {
    const balance = (acc.balance_current ?? 0) / 100;
    totalBalance += balance;
    return {
      name: acc.name,
      balance_euros: balance,
      type: acc.type ?? 'checking',
    };
  });

  return {
    net_worth_euros: Math.round(totalBalance * 100) / 100,
    accounts_summary: accountsSummary,
  };
}
