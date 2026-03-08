// getCategories.js — Lista todas las categorías y sus grupos
import { api } from '../actualClient.js';

export const definition = {
  name: 'get_categories',
  description: 'Lista todas las categorías de gasto/ingreso organizadas por grupo, incluyendo si están ocultas o son de tipo ingreso.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export async function handler() {
  const allItems = await api.getCategories();

  // getCategories() devuelve categorías y grupos mezclados — filtrar solo categorías
  const categories = allItems.filter((item) => item.group_id);

  // Construir mapa de grupos para enriquecer cada categoría
  const groups = await api.getCategoryGroups();
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  const result = categories.map((cat) => {
    const group = groupMap.get(cat.group_id);
    return {
      id: cat.id,
      name: cat.name,
      group_id: cat.group_id,
      group_name: group?.name ?? 'Sin grupo',
      is_income: group?.is_income ?? false,
      hidden: cat.hidden ?? false,
    };
  });

  return result;
}
