import { z } from 'zod';
import { toCents, formatAmount } from '../core/money.js';
import { getTransactionById, mapTxEcho } from '../core/tx-read.js';
import type { ToolDef } from '../core/types.js';

const input = {
  transaction_id: z.string().min(1),
  splits: z.array(z.object({
    amount: z.number().describe('Units; same sign as the original. With adjust_last, the LAST part may be 0 (computed server-side)'),
    category_id: z.string().min(1),
    notes: z.string().max(1000).optional(),
  })).min(2).describe('Parts of the split (min 2)'),
  adjust_last: z.boolean().default(false).describe('Compute the last part as the exact remainder'),
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
    const { transaction_id } = z.object({ transaction_id: input.transaction_id }).parse(raw ?? {});
    const orig = await getTransactionById(api, transaction_id);
    if (!orig) throw new Error(`Transacción no encontrada: ${transaction_id}`);
    if (orig.transfer_id) throw new Error('No se puede dividir una transferencia entre cuentas');
    if (orig.is_parent || (Array.isArray(orig.subtransactions) && orig.subtransactions.length > 0)) {
      throw new Error('La transacción ya está dividida; edita sus partes en Actual o deshaz el split primero');
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

    // Crear primero, borrar después: un fallo intermedio deja un duplicado visible, nunca pérdida de datos.
    const copy: any = { date: orig.date, amount: totalCents, subtransactions: parts };
    if (orig.payee) copy.payee = orig.payee;
    if (orig.notes) copy.notes = orig.notes;
    if (orig.cleared !== undefined) copy.cleared = !!orig.cleared;
    await api.addTransactions(orig.account, [copy], { learnCategories: false, runTransfers: false });

    const { data: candidates } = await api.runQuery(
      api.q('transactions')
        .filter({ account: orig.account })
        .filter({ date: orig.date })
        .filter({ amount: totalCents })
        .options({ splits: 'grouped' })
        .select(['id']),
    );
    const newId = (candidates as any[]).map((c) => c.id).find((cid) => cid !== a.transaction_id);
    if (!newId) {
      throw new Error(`Split creado pero no localizado; el original ${a.transaction_id} NO se ha borrado — revisa duplicados en Actual`);
    }
    try {
      await api.deleteTransaction(a.transaction_id);
    } catch (err) {
      throw new Error(
        `Split creado como ${newId} pero no se pudo borrar el original ${a.transaction_id} (${(err as Error).message}); hay un duplicado visible en Actual — borra el original a mano`,
      );
    }
    const fresh = await getTransactionById(api, newId);
    return { split: true, original_id: a.transaction_id, transaction: mapTxEcho(fresh ?? { ...copy, id: newId, account: orig.account }, config.locale, config.currency) };
  },
};
