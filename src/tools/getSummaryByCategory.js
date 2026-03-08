// getSummaryByCategory.js — Resumen de gastos agrupado por categoría
import { api } from '../actualClient.js';

export const definition = {
  name: 'get_summary_by_category',
  description:
    'Resumen de gastos/ingresos agrupado por categoría en un rango de fechas. Muestra total en euros y número de transacciones. Ordenado por importe total descendente.',
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
      include_income: {
        type: 'boolean',
        description: 'Incluir categorías de ingreso (por defecto false)',
      },
    },
    required: ['start_date', 'end_date'],
  },
};

export async function handler(params) {
  const { start_date, end_date, include_income = false } = params;

  // Obtener datos de referencia
  const accounts = await api.getAccounts();
  const allCatItems = await api.getCategories();
  // Filtrar solo categorías (excluir grupos que vienen mezclados)
  const categories = allCatItems.filter((c) => c.group_id);
  const groups = await api.getCategoryGroups();

  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  // Identificar categorías de ingreso para poder filtrarlas
  const incomeGroupIds = new Set(groups.filter((g) => g.is_income).map((g) => g.id));

  // Recopilar todas las transacciones del período (solo cuentas abiertas)
  const openAccounts = accounts.filter((a) => !a.closed);
  let allTransactions = [];

  for (const acc of openAccounts) {
    const txs = await api.getTransactions(acc.id, start_date, end_date);
    allTransactions.push(...txs);
  }

  // Excluir transferencias (para no doblar importes)
  allTransactions = allTransactions.filter((tx) => !tx.transfer_id);

  // Agrupar por categoría
  const summary = new Map();

  for (const tx of allTransactions) {
    const catId = tx.category ?? '__sin_categoria__';
    if (!summary.has(catId)) {
      summary.set(catId, { total: 0, count: 0 });
    }
    const entry = summary.get(catId);
    entry.total += tx.amount ?? 0;
    entry.count += 1;
  }

  // Construir resultado
  let result = [];

  for (const [catId, data] of summary) {
    const cat = categoryMap.get(catId);
    const group = cat ? groupMap.get(cat.group_id) : null;
    const isIncome = group ? incomeGroupIds.has(group.id) : false;

    // Filtrar ingresos si no se piden
    if (!include_income && isIncome) continue;

    result.push({
      category_name: cat?.name ?? 'Sin categoría',
      group_name: group?.name ?? 'Sin grupo',
      // Gastos negativos → invertir signo para facilitar lectura
      total_euros: (data.total / 100) * -1,
      transaction_count: data.count,
    });
  }

  // Ordenar por total descendente (los mayores gastos primero)
  result.sort((a, b) => b.total_euros - a.total_euros);

  return result;
}
