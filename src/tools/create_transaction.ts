import { z } from 'zod';
import { toCents, formatAmount } from '../core/money.js';
import { getTransactionById, mapTxEcho } from '../core/tx-read.js';
import { ID, type ToolDef } from '../core/types.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato YYYY-MM-DD');

const input = {
  account_id: ID,
  date: DATE,
  amount: z.number().describe('Units; negative = expense, positive = income'),
  payee_name: z.string().optional(),
  category_id: ID.optional(),
  notes: z.string().max(1000).optional(),
  cleared: z.boolean().optional(),
  splits: z.array(z.object({
    amount: z.number(),
    category_id: ID,
    notes: z.string().max(1000).optional(),
  })).min(2).optional().describe('Create already split; parts must sum exactly to amount'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'create_transaction',
  description: 'Record a new transaction (expense or income) in an account. Amount in currency units. Optional splits create it already divided. Returns the created transaction.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const cents = toCents(a.amount);
    const tx: any = { date: a.date, amount: cents };
    if (a.payee_name) tx.payee_name = a.payee_name;
    if (a.category_id) tx.category = a.category_id;
    if (a.notes) tx.notes = a.notes;
    if (a.cleared !== undefined) tx.cleared = a.cleared;
    if (a.splits) {
      const parts = a.splits.map((s) => ({ amount: toCents(s.amount), category: s.category_id, ...(s.notes ? { notes: s.notes } : {}) }));
      const sum = parts.reduce((s, p) => s + p.amount, 0);
      if (sum !== cents) {
        throw new Error(
          `Las partes difieren del total: suman ${formatAmount(sum, config.locale, config.currency)} y el importe es ${formatAmount(cents, config.locale, config.currency)}`,
        );
      }
      tx.subtransactions = parts;
    }
    await api.addTransactions(a.account_id, [tx], { learnCategories: true, runTransfers: false });
    const { data: candidates } = await api.runQuery(
      api.q('transactions')
        .filter({ account: a.account_id })
        .filter({ date: a.date })
        .filter({ amount: cents })
        .options({ splits: 'grouped' })
        .select(['id']),
    );
    const newId = (candidates as any[])[0]?.id;
    const fresh = newId ? await getTransactionById(api, newId) : null;
    return {
      created: true,
      transaction: mapTxEcho(fresh ?? { ...tx, id: newId ?? 'unknown', account: a.account_id }, config.locale, config.currency),
    };
  },
};
