import { z } from 'zod';
import { getCategoryIndex, categoryNotFound } from '../core/categories.js';
import { toCents, formatAmount } from '../core/money.js';
import { candidateIds, newIdFromDiff, getTransactionById, mapTxEcho } from '../core/tx-read.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  transaction_id: ID,
  splits: z.array(z.object({
    amount: z.number().describe('Units; same sign as the original. With adjust_last, the LAST part may be 0 (computed server-side)'),
    category_id: ID,
    notes: z.string().max(1000).optional(),
  })).min(2).max(20).describe('Parts of the split (min 2, max 20)'),
  adjust_last: z.boolean().default(false).describe('Compute the last part as the exact remainder'),
  force: z.boolean().default(false).describe('Allow splitting a reconciled transaction'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'split_transaction',
  description: 'Split an existing transaction into parts with real subtransactions. Parts must sum exactly to the original amount (integer-cent validation); adjust_last=true computes the final part. Internally replaces the transaction (new id).',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    // Los guards del objetivo (existe, no es transferencia, no está ya dividido) son
    // más fundamentales que la cardinalidad de partes: se validan ANTES del schema
    // completo para que un transfer devuelva su error propio aunque llegue 1 sola parte.
    const { transaction_id, force } = z
      .object({ transaction_id: input.transaction_id, force: input.force })
      .parse(raw ?? {});
    const orig = await getTransactionById(api, transaction_id);
    if (!orig) throw new Error(`Transacción no encontrada: ${transaction_id}`);
    if (orig.transfer_id) throw new Error('No se puede dividir una transferencia entre cuentas');
    if (orig.is_parent || (Array.isArray(orig.subtransactions) && orig.subtransactions.length > 0)) {
      throw new Error('La transacción ya está dividida; edita sus partes en Actual o deshaz el split primero');
    }
    // Dividir reemplaza la transacción: si estaba conciliada, la conciliación cerrada
    // se rompe en silencio. Exigimos confirmación explícita.
    if (orig.reconciled && !force) {
      throw new Error('La transacción está conciliada; dividirla rompería la conciliación. Vuelve a intentarlo con force: true si estás seguro');
    }

    const a = schema.parse(raw ?? {});
    const totalCents = orig.amount ?? 0;
    const parts = a.splits.map((s) => ({ amount: toCents(s.amount), category: s.category_id, ...(s.notes ? { notes: s.notes } : {}) }));
    const partialSum = parts.slice(0, -1).reduce((s, p) => s + p.amount, 0);
    if (a.adjust_last) {
      parts[parts.length - 1].amount = totalCents - partialSum;
    }
    const sum = parts.reduce((s, p) => s + p.amount, 0);
    if (sum !== totalCents) {
      const diff = totalCents - sum;
      const word = diff > 0 ? 'faltan' : 'sobran';
      throw new Error(
        `Las partes difieren del total: suman ${formatAmount(sum, config.locale, config.currency)} y el movimiento es ${formatAmount(totalCents, config.locale, config.currency)} (${word} ${formatAmount(Math.abs(diff), config.locale, config.currency)}). Ajusta las partes o usa adjust_last=true`,
      );
    }

    // Validar TODAS las categorías antes de tocar nada: un id inexistente dejaría
    // la parte sin categoría en silencio, y el split ya no es reversible sin trabajo.
    const cats = await getCategoryIndex(api);
    for (const p of parts) {
      if (!cats.has(p.category)) throw new Error(categoryNotFound(msg(config), p.category));
    }

    // Crear primero, borrar después: un fallo intermedio deja un duplicado visible, nunca pérdida de datos.
    const copy: any = { date: orig.date, amount: totalCents, subtransactions: parts };
    if (orig.payee) copy.payee = orig.payee;
    if (orig.notes) copy.notes = orig.notes;
    if (orig.cleared !== undefined) copy.cleared = !!orig.cleared;
    // Metadatos que la copia debe heredar: imported_id/imported_payee son la clave de
    // deduplicación del banco (perderlos reimportaría el movimiento), schedule mantiene
    // el vínculo con el repetitivo y reconciled preserva el estado de conciliación.
    if (orig.imported_id) copy.imported_id = orig.imported_id;
    if (orig.imported_payee) copy.imported_payee = orig.imported_payee;
    if (orig.schedule) copy.schedule = orig.schedule;
    // En el modelo de Actual conciliado implica compensado: copiarlos como campos
    // independientes podría producir una fila incoherente (reconciled sin cleared).
    if (orig.reconciled) {
      copy.reconciled = true;
      copy.cleared = true;
    }
    // Fotografiamos los candidatos ANTES de escribir: con splits agrupados la consulta
    // puede arrastrar parents ajenos, y el orden de Actual es un detalle interno.
    const before = new Set(await candidateIds(api, orig.account, orig.date, totalCents));
    await api.addTransactions(orig.account, [copy], { learnCategories: false, runTransfers: false });

    const after = (await candidateIds(api, orig.account, orig.date, totalCents))
      .filter((cid) => cid !== a.transaction_id); // cinturón y tirantes: el original nunca es la copia
    const { id: newId, ambiguous } = newIdFromDiff(before, after);
    if (!newId) {
      throw new Error(`Split creado pero no localizado; el original ${a.transaction_id} NO se ha borrado — revisa duplicados en Actual`);
    }
    try {
      await api.deleteTransaction(a.transaction_id);
    } catch (err) {
      throw new Error(
        `Split creado como ${newId} pero no se pudo borrar el original ${a.transaction_id} (${(err as Error).message}); hay un duplicado visible en Actual — borra el original a mano. Ojo: la copia hereda el mismo id de importación (imported_id) que el original, así que mientras convivan las dos filas comparten la clave de deduplicación del banco y la próxima sincronización bancaria puede confundirse. Si el original estaba conciliado, tendrás que desbloquear la conciliación antes de poder borrarlo`,
      );
    }
    const fresh = await getTransactionById(api, newId);
    return {
      split: true,
      original_id: a.transaction_id,
      ...(ambiguous
        ? { note: 'Aparecieron varias filas nuevas con la misma cuenta, fecha e importe; se devuelve la primera. Revisa posibles duplicados en Actual' }
        : {}),
      transaction: mapTxEcho(fresh ?? { ...copy, id: newId, account: orig.account }, config.locale, config.currency),
    };
  },
};
