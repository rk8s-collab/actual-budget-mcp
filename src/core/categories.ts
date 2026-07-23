// categories.ts — índice de categorías por id.
//
// La API de Actual NO valida que la categoría exista al escribir: un id
// inventado (pero con forma de UUID) deja la transacción sin categoría de
// forma silenciosa, o escribe una celda de presupuesto huérfana, mientras la
// tool informa de éxito. Por eso validamos contra este índice antes de escribir.
import type { Messages } from './messages.js';

export interface CategoryInfo {
  id: string;
  name: string;
  group: string;
  is_income: boolean;
}

/** Aplana api.getCategoryGroups() en un Map id → {id, name, group, is_income}. */
export async function getCategoryIndex(api: any): Promise<Map<string, CategoryInfo>> {
  const groups = await api.getCategoryGroups();
  const idx = new Map<string, CategoryInfo>();
  for (const g of groups ?? []) {
    for (const c of g.categories ?? []) {
      idx.set(c.id, { id: c.id, name: c.name, group: g.name, is_income: !!g.is_income });
    }
  }
  return idx;
}

/** Mensaje único para ids de categoría inexistentes (mismo texto en todas las tools). */
export function categoryNotFound(m: Messages, id: string): string {
  return m.categoryNotFound(id);
}
