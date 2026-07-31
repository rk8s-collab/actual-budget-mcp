import { z } from 'zod';
import { getCategoryIndex } from '../core/categories.js';
import { getPayeeIndex } from '../core/payees.js';
import { toCents } from '../core/money.js';
import { getTransactionById, mapTxEcho, readBack } from '../core/tx-read.js';
import { ID, type ToolDef } from '../core/types.js';
import { activeMessages, msg } from '../core/messages.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: () => activeMessages().dateFormat });

const input = {
  transaction_id: ID,
  category_id: ID.nullable().optional().describe('Category UUID; null clears the category (leaves the transaction uncategorized)'),
  payee_id: ID.optional().describe('Payee by id (from get_payees). Use payee_name instead to resolve or create one by name'),
  payee_name: z.string().max(200).optional().describe('Payee by name (resolved/created server-side)'),
  notes: z.string().max(1000).optional(),
  date: DATE.optional(),
  amount: z.number().optional().describe('Units (e.g. -45.50)'),
  cleared: z.boolean().optional(),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'update_transaction',
  title: 'Update transaction',
  description: 'Update fields of an existing transaction (category, payee, notes, date, amount, cleared). Amount in currency units. Pass category_id: null to leave it uncategorized, payee_id to set a known payee, or payee_name to resolve/create one. Returns the resulting transaction.',
  readOnly: false,
  // Sobrescribe los campos indicados de la transacción: destructivo (en MCP, false = solo aditivo).
  annotations: { destructiveHint: true, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const m = msg(config);
    const a = schema.parse(raw ?? {});
    const fields: any = {};
    // null is a value here (clear the category), undefined means "not provided":
    // the check has to be against undefined, never falsiness.
    if (a.category_id !== undefined) fields.category = a.category_id;
    if (a.notes !== undefined) fields.notes = a.notes;
    if (a.date !== undefined) fields.date = a.date;
    if (a.amount !== undefined) fields.amount = toCents(a.amount);
    if (a.cleared !== undefined) fields.cleared = a.cleared;
    if (a.category_id === undefined && a.payee_id === undefined && a.payee_name === undefined
      && a.notes === undefined && a.date === undefined && a.amount === undefined && a.cleared === undefined) {
      throw new Error(m.noFieldToUpdate);
    }
    if (a.payee_id !== undefined && a.payee_name !== undefined) throw new Error(m.payeeIdAndNameTogether);
    const existing = await getTransactionById(api, a.transaction_id);
    if (!existing) throw new Error(m.txNotFound(a.transaction_id));
    // La pre-lectura agrupada devuelve la fila PADRE cuando se le pasa el id de una parte:
    // existing.id !== a.transaction_id es el detector de hijo de split.
    if (existing.id !== a.transaction_id) {
      throw new Error(m.splitChild(a.transaction_id, existing.id));
    }
    if (existing.is_parent || (Array.isArray(existing.subtransactions) && existing.subtransactions.length > 0)) {
      if (a.amount !== undefined || a.category_id !== undefined) {
        throw new Error(m.splitParentAmount(a.transaction_id));
      }
    }
    // Actual acepta cualquier id de categoría con forma de UUID y deja el movimiento
    // sin categorizar en silencio: validamos antes de escribir. Sólo se consulta el
    // índice si realmente viene category_id.
    if (a.category_id !== undefined && a.category_id !== null) {
      const cats = await getCategoryIndex(api);
      if (!cats.has(a.category_id)) throw new Error(m.categoryNotFound(a.category_id));
    }
    // payee_id se valida contra el índice de pagadores: un id inventado escribiría
    // silenciosamente un pagador inexistente.
    if (a.payee_id !== undefined) {
      const { byId } = await getPayeeIndex(api);
      if (!byId.has(a.payee_id)) throw new Error(m.payeeIdNotFound(a.payee_id));
      fields.payee = a.payee_id;
    }
    // payee_name se resuelve a un id: el campo crudo payee_name lo rechaza conform().
    if (a.payee_name !== undefined) {
      const wantedName = a.payee_name!.trim().toLowerCase();
      const payees = await api.getPayees();
      const found = (payees as any[]).find((p) => (p.name ?? '').trim().toLowerCase() === wantedName);
      fields.payee = found ? found.id : await api.createPayee({ name: a.payee_name!.trim() });
    }
    await api.updateTransaction(a.transaction_id, fields);
    const { row, settled } = await readBack(api, a.transaction_id, fields);
    return {
      updated: true,
      // El eco es lo LEÍDO. Si la escritura aún no se refleja se avisa en vez de
      // devolver los valores pedidos como si estuvieran guardados.
      ...(settled ? {} : { echo_pending: true, note: m.echoPending }),
      transaction: mapTxEcho(row ?? existing, config.locale, config.currency),
    };
  },
};
