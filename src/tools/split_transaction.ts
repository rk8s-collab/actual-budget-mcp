import { z } from 'zod';
import { getCategoryIndex } from '../core/categories.js';
import { toCents, formatAmount } from '../core/money.js';
import { getTransactionById, mapTxEcho, readBackSplit } from '../core/tx-read.js';
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
  title: 'Split transaction',
  description: 'Split an existing transaction into parts with real subtransactions. Parts must sum exactly to the original amount (integer-cent validation); adjust_last=true computes the final part.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    // Los guards del objetivo (existe, no es transferencia, no está ya dividido) son
    // más fundamentales que la cardinalidad de partes: se validan ANTES del schema
    // completo para que un transfer devuelva su error propio aunque llegue 1 sola parte.
    const m = msg(config);
    const { transaction_id, force } = z
      .object({ transaction_id: input.transaction_id, force: input.force })
      .parse(raw ?? {});
    const orig = await getTransactionById(api, transaction_id);
    if (!orig) throw new Error(m.txNotFound(transaction_id));
    if (orig.transfer_id) throw new Error(m.cannotSplitTransfer);
    if (orig.is_parent || (Array.isArray(orig.subtransactions) && orig.subtransactions.length > 0)) {
      throw new Error(m.alreadySplit);
    }
    // Dividir modifica la conciliación de la fila si estaba conciliada: Actual la conserva
    // (nunca se toca cleared/reconciled aquí), pero exigimos confirmación explícita igual que
    // antes, porque el split cambia la forma de la transacción.
    if (orig.reconciled && !force) {
      throw new Error(m.reconciledNeedsForce);
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
      throw new Error(
        m.partsDoNotSum(
          formatAmount(sum, config.locale, config.currency),
          formatAmount(totalCents, config.locale, config.currency),
          diff > 0,
          formatAmount(Math.abs(diff), config.locale, config.currency),
        ),
      );
    }

    // Validar TODAS las categorías antes de tocar nada: un id inexistente dejaría
    // la parte sin categoría en silencio.
    const cats = await getCategoryIndex(api);
    for (const p of parts) {
      if (!cats.has(p.category)) throw new Error(m.categoryNotFound(p.category));
    }

    // Update in-place: @actual-app/api 26.8.0 convierte correctamente una transacción normal
    // en split (upstream PR #8467). date/amount/payee/notes/cleared/imported_id/imported_payee/
    // schedule/reconciled ya viven en la fila y no se tocan -- no hace falta copiarlos.
    await api.updateTransaction(transaction_id, { subtransactions: parts });
    const { row, settled } = await readBackSplit(api, transaction_id, parts.length);

    return {
      split: true,
      original_id: transaction_id,
      // El eco es lo LEÍDO. Si la escritura aún no se refleja se avisa en vez de
      // devolver los valores pedidos como si estuvieran guardados.
      ...(settled ? {} : { echo_pending: true, note: m.echoPending }),
      transaction: mapTxEcho(row ?? { ...orig, subtransactions: parts }, config.locale, config.currency),
    };
  },
};
