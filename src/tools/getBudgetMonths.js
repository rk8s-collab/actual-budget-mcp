// getBudgetMonths.js — Datos de presupuesto mensual: asignado vs gastado por categoría
import { api } from '../actualClient.js';

export const definition = {
  name: 'get_budget_months',
  description:
    'Obtiene datos de presupuesto mensual: lo asignado, gastado y balance por categoría para uno o varios meses. Formato de mes: YYYY-MM.',
  inputSchema: {
    type: 'object',
    properties: {
      months: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array de meses en formato YYYY-MM, ej: ["2025-01", "2025-02"]',
      },
    },
    required: ['months'],
  },
};

export async function handler(params) {
  const { months } = params;

  // Obtener grupos para enriquecer nombres
  const groups = await api.getCategoryGroups();
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  const result = [];

  for (const month of months) {
    const budgetData = await api.getBudgetMonth(month);

    // budgetData contiene categoryGroups con sus categorías
    for (const group of budgetData.categoryGroups ?? []) {
      const groupInfo = groupMap.get(group.id);

      for (const cat of group.categories ?? []) {
        result.push({
          month,
          category_name: cat.name,
          group_name: groupInfo?.name ?? group.name ?? 'Sin grupo',
          // Amounts en céntimos → convertir a euros
          budgeted_euros: (cat.budgeted ?? 0) / 100,
          spent_euros: (cat.spent ?? 0) / 100,
          balance_euros: (cat.balance ?? 0) / 100,
        });
      }
    }
  }

  return result;
}
