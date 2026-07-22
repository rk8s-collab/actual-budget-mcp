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
    if (a.payee_name !== undefined) fields.payee_name = a.payee_name;
    if (a.notes !== undefined) fields.notes = a.notes;
    if (a.date !== undefined) fields.date = a.date;
    if (a.amount !== undefined) fields.amount = toCents(a.amount);
    if (a.cleared !== undefined) fields.cleared = a.cleared;
    if (Object.keys(fields).length === 0) {
      throw new Error('Debes indicar al menos un campo a actualizar (category_id, payee_name, notes, date, amount, cleared)');
    }
    const existing = await getTransactionById(api, a.transaction_id);
    if (!existing) throw new Error(`Transacción no encontrada: ${a.transaction_id}`);
    await api.updateTransaction(a.transaction_id, fields);
    const updated = await getTransactionById(api, a.transaction_id);
    return { updated: true, transaction: mapTxEcho(updated ?? existing, config.locale, config.currency) };
  },
};
