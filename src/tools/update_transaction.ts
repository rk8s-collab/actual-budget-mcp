import { z } from 'zod';
import { toCents } from '../core/money.js';
import { getTransactionById, mapTxEcho } from '../core/tx-read.js';
import type { ToolDef } from '../core/types.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato YYYY-MM-DD');

const input = {
  transaction_id: z.string().min(1),
  category_id: z.string().optional(),
  payee_name: z.string().optional().describe('Payee by name (resolved/created server-side)'),
  notes: z.string().max(1000).optional(),
  date: DATE.optional(),
  amount: z.number().optional().describe('Units (e.g. -45.50)'),
  cleared: z.boolean().optional(),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'update_transaction',
  description: 'Update fields of an existing transaction (category, payee, notes, date, amount, cleared). Amount in currency units. Returns the resulting transaction.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const fields: any = {};
    if (a.category_id !== undefined) fields.category = a.category_id;
    if (a.notes !== undefined) fields.notes = a.notes;
    if (a.date !== undefined) fields.date = a.date;
    if (a.amount !== undefined) fields.amount = toCents(a.amount);
    if (a.cleared !== undefined) fields.cleared = a.cleared;
    if (a.category_id === undefined && a.payee_name === undefined && a.notes === undefined
      && a.date === undefined && a.amount === undefined && a.cleared === undefined) {
      throw new Error('Debes indicar al menos un campo a actualizar (category_id, payee_name, notes, date, amount, cleared)');
    }
    const existing = await getTransactionById(api, a.transaction_id);
    if (!existing) throw new Error(`Transacción no encontrada: ${a.transaction_id}`);
    // La pre-lectura agrupada devuelve la fila PADRE cuando se le pasa el id de una parte:
    // existing.id !== a.transaction_id es el detector de hijo de split.
    if (existing.id !== a.transaction_id) {
      throw new Error(
        `La transacción ${a.transaction_id} es una parte de un split (padre ${existing.id}); edita el split completo con split_transaction o desde Actual`,
      );
    }
    if (existing.is_parent || (Array.isArray(existing.subtransactions) && existing.subtransactions.length > 0)) {
      if (a.amount !== undefined || a.category_id !== undefined) {
        throw new Error(
          `La transacción ${a.transaction_id} es el padre de un split: importe y categoría viven en las partes; usa split_transaction para redividirla (notas, fecha, cleared y pagador sí se pueden editar aquí)`,
        );
      }
    }
    // payee_name se resuelve a un id: el campo crudo payee_name lo rechaza conform().
    if (a.payee_name !== undefined) {
      const wantedName = a.payee_name!.trim().toLowerCase();
      const payees = await api.getPayees();
      const found = (payees as any[]).find((p) => (p.name ?? '').trim().toLowerCase() === wantedName);
      fields.payee = found ? found.id : await api.createPayee({ name: a.payee_name!.trim() });
    }
    await api.updateTransaction(a.transaction_id, fields);
    const updated = await getTransactionById(api, a.transaction_id);
    return { updated: true, transaction: mapTxEcho(updated ?? existing, config.locale, config.currency) };
  },
};
