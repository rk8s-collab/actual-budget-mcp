import { moneyFields } from './money.js';

/** Lee una transacción por id con splits agrupados (parents llevan subtransactions). */
export async function getTransactionById(api: any, id: string): Promise<any | null> {
  const { data } = await api.runQuery(
    api.q('transactions').filter({ id }).options({ splits: 'grouped' }).select(['*']),
  );
  return (data as any[])[0] ?? null;
}

/**
 * Ids de las filas que compiten por ser "la recién creada": mismo (cuenta, fecha, importe).
 * Con splits agrupados la consulta puede arrastrar parents ajenos cuyo hijo coincide en
 * importe, así que el conjunto se usa SIEMPRE por diferencia (antes vs después), nunca
 * confiando en el orden implícito que devuelve Actual.
 */
export async function candidateIds(api: any, account: string, date: string, amount: number): Promise<string[]> {
  const { data } = await api.runQuery(
    api.q('transactions')
      .filter({ account })
      .filter({ date })
      .filter({ amount })
      .options({ splits: 'grouped' })
      .select(['id']),
  );
  return (data as any[]).map((c) => c.id);
}

/** Diferencia de conjuntos: la fila nueva es la que no existía antes de escribir. */
export function newIdFromDiff(before: Set<string>, after: string[]): { id?: string; ambiguous: boolean } {
  const added = after.filter((id) => !before.has(id));
  return { id: added[0], ambiguous: added.length > 1 };
}

/** Echo compacto post-escritura: ids incluidos (el LLM acaba de usarlos). */
export function mapTxEcho(raw: any, locale: string, currency: string) {
  const echo: any = {
    id: raw.id,
    date: raw.date,
    account_id: raw.account,
    payee: raw.payee_name ?? raw.payee ?? null,
    category_id: raw.category ?? null,
    ...moneyFields(raw.amount ?? 0, locale, currency),
  };
  if (raw.notes) echo.notes = raw.notes;
  if (raw.cleared !== undefined) echo.cleared = !!raw.cleared;
  if (Array.isArray(raw.subtransactions) && raw.subtransactions.length > 0) {
    echo.splits = raw.subtransactions.map((s: any) => {
      const part: any = { category_id: s.category ?? null, ...moneyFields(s.amount ?? 0, locale, currency) };
      if (s.notes) part.notes = s.notes;
      return part;
    });
  }
  return echo;
}
