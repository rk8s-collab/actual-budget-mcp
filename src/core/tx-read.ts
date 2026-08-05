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

/** ¿La fila leída ya lleva aplicados los campos que se escribieron? */
export function reflectsFields(row: any, fields: Record<string, any>): boolean {
  if (!row) return false;
  return Object.entries(fields).every(([key, value]) =>
    // Actual guarda cleared como 1/0 y las tools escriben true/false.
    key === 'cleared' ? !!row.cleared === !!value : row[key] === value,
  );
}

/**
 * Re-lectura post-escritura tolerante a la carrera de la API. `api/transaction-update`
 * de Actual acaba en `return handlers['transactions-batch-update'](diff)['updated']`
 * SIN await: indexar una promesa da undefined, así que updateTransaction() resuelve
 * antes de que la escritura aterrice y una única lectura devuelve la fila anterior.
 * Se sondea hasta verla aplicada; si no llega, se devuelve lo último leído con
 * settled=false — nunca lo que se pidió escribir, que sería inventarse el resultado.
 */
export async function readBack(
  api: any,
  id: string,
  fields: Record<string, any>,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ row: any | null; settled: boolean }> {
  const attempts = opts.attempts ?? 5;
  const delayMs = opts.delayMs ?? 20;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let row = await getTransactionById(api, id);
  for (let i = 1; i < attempts && !reflectsFields(row, fields); i++) {
    await sleep(delayMs);
    row = await getTransactionById(api, id);
  }
  return { row, settled: reflectsFields(row, fields) };
}

/**
 * Variante de readBack para splits: subtransactions es un array, así que row[key] === value
 * nunca sería cierto. Aquí se confirma la FORMA (is_parent + nº de partes esperado), no el
 * valor exacto de cada parte.
 */
export async function readBackSplit(
  api: any,
  id: string,
  expectedParts: number,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ row: any | null; settled: boolean }> {
  const attempts = opts.attempts ?? 5;
  const delayMs = opts.delayMs ?? 20;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const isSettled = (row: any) =>
    !!row?.is_parent && Array.isArray(row.subtransactions) && row.subtransactions.length === expectedParts;
  let row = await getTransactionById(api, id);
  for (let i = 1; i < attempts && !isSettled(row); i++) {
    await sleep(delayMs);
    row = await getTransactionById(api, id);
  }
  return { row, settled: isSettled(row) };
}

/**
 * Variante por lote de readBack para categorías. Devuelve los ids cuya categoría ya está
 * aplicada. Cada vuelta consulta SOLO los que siguen pendientes: confirmar de uno en uno
 * un lote de 50 serían 50 sondeos secuenciales.
 */
export async function readBackCategories(
  api: any,
  wanted: Map<string, string>,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Set<string>> {
  const attempts = opts.attempts ?? 5;
  const delayMs = opts.delayMs ?? 20;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const settled = new Set<string>();
  let pending = [...wanted.keys()];
  for (let i = 0; i < attempts && pending.length > 0; i++) {
    if (i > 0) await sleep(delayMs);
    const { data } = await api.runQuery(
      api.q('transactions').filter({ id: { $oneof: pending } }).options({ splits: 'all' }).select(['id', 'category']),
    );
    for (const row of data as any[]) {
      if (row.category === wanted.get(row.id)) settled.add(row.id);
    }
    pending = pending.filter((id) => !settled.has(id));
  }
  return settled;
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
