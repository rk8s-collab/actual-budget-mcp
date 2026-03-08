// getAccounts.js — Lista todas las cuentas con su balance actual
import { api } from '../actualClient.js';

export const definition = {
  name: 'get_accounts',
  description: 'Lista todas las cuentas del presupuesto con su balance actual en euros, tipo y estado (abierta/cerrada).',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export async function handler() {
  const accounts = await api.getAccounts();

  const result = accounts.map((acc) => ({
    id: acc.id,
    name: acc.name,
    // Los amounts en Actual están en céntimos — dividir entre 100 para euros
    balance_euros: (acc.balance_current ?? 0) / 100,
    type: acc.type ?? 'checking',
    closed: acc.closed ?? false,
  }));

  return result;
}
