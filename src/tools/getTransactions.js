// getTransactions.js — Transacciones en un rango de fechas con filtros opcionales
import { api } from '../actualClient.js';

export const definition = {
  name: 'get_transactions',
  description:
    'Obtiene transacciones en un rango de fechas. Puede filtrarse por cuenta o categoría. Devuelve fecha, pagador, categoría, importe en euros y notas. Ordenado por fecha descendente.',
  inputSchema: {
    type: 'object',
    properties: {
      start_date: {
        type: 'string',
        description: 'Fecha inicio en formato YYYY-MM-DD',
      },
      end_date: {
        type: 'string',
        description: 'Fecha fin en formato YYYY-MM-DD',
      },
      account_id: {
        type: 'string',
        description: 'ID de cuenta para filtrar (opcional)',
      },
      category_id: {
        type: 'string',
        description: 'ID de categoría para filtrar (opcional)',
      },
    },
    required: ['start_date', 'end_date'],
  },
};

export async function handler(params) {
  const { start_date, end_date, account_id, category_id } = params;

  // Obtener cuentas, categorías y payees para enriquecer los datos
  const accounts = await api.getAccounts();
  const allCatItems = await api.getCategories();
  const categories = allCatItems.filter((c) => c.group_id);
  const payees = await api.getPayees();

  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const payeeMap = new Map(payees.map((p) => [p.id, p]));

  // Si se especifica cuenta, solo esa; si no, todas las abiertas
  const targetAccounts = account_id
    ? accounts.filter((a) => a.id === account_id)
    : accounts.filter((a) => !a.closed);

  let allTransactions = [];

  for (const acc of targetAccounts) {
    const txs = await api.getTransactions(acc.id, start_date, end_date);
    // Añadir info de cuenta a cada transacción
    for (const tx of txs) {
      tx._account_id = acc.id;
    }
    allTransactions.push(...txs);
  }

  // Filtrar por categoría si se especifica
  if (category_id) {
    allTransactions = allTransactions.filter((tx) => tx.category === category_id);
  }

  // Transformar y enriquecer
  const result = allTransactions.map((tx) => {
    const account = accountMap.get(tx._account_id);
    const category = categoryMap.get(tx.category);
    const payee = payeeMap.get(tx.payee);

    return {
      id: tx.id,
      date: tx.date,
      account_name: account?.name ?? 'Desconocida',
      payee: payee?.name ?? tx.imported_payee ?? 'Sin pagador',
      category_name: category?.name ?? 'Sin categoría',
      amount_euros: (tx.amount ?? 0) / 100,
      notes: tx.notes ?? '',
      transfer: tx.transfer_id ? true : false,
    };
  });

  // Ordenar por fecha descendente
  result.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));

  return result;
}
