import { moneyFields } from './money.js';

/** Lee una transacción por id con splits agrupados (parents llevan subtransactions). */
export async function getTransactionById(api: any, id: string): Promise<any | null> {
  const { data } = await api.runQuery(
    api.q('transactions').filter({ id }).options({ splits: 'grouped' }).select(['*']),
  );
  return (data as any[])[0] ?? null;
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
