import { z } from 'zod';
import { getCategoryIndex } from '../core/categories.js';
import { toCents, formatAmount } from '../core/money.js';
import { candidateIds, newIdFromDiff, getTransactionById, mapTxEcho } from '../core/tx-read.js';
import { ID, type ToolDef } from '../core/types.js';
import { activeMessages, msg } from '../core/messages.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: () => activeMessages().dateFormat });

const input = {
  account_id: ID,
  date: DATE,
  amount: z.number().describe('Units; negative = expense, positive = income'),
  payee_name: z.string().max(200).optional(),
  category_id: ID.optional(),
  notes: z.string().max(1000).optional(),
  cleared: z.boolean().optional(),
  splits: z.array(z.object({
    amount: z.number(),
    category_id: ID,
    notes: z.string().max(1000).optional(),
  })).min(2).max(20).optional().describe('Create already split (max 20 parts); parts must sum exactly to amount'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'create_transaction',
  title: 'Create transaction',
  description: 'Record a new transaction (expense or income) in an account. Amount in currency units. Optional splits create it already divided. Returns the created transaction.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    // Actual acepta cualquier id de categoría: si no existe, la transacción se
    // crea sin categoría y nadie se entera. Validamos antes de escribir.
    const wanted = [...(a.category_id ? [a.category_id] : []), ...(a.splits?.map((s) => s.category_id) ?? [])];
    if (wanted.length > 0) {
      const cats = await getCategoryIndex(api);
      for (const id of wanted) if (!cats.has(id)) throw new Error(m.categoryNotFound(id));
    }
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
          m.createSplitsMismatch(
            formatAmount(sum, config.locale, config.currency),
            formatAmount(cents, config.locale, config.currency),
          ),
        );
      }
      tx.subtransactions = parts;
    }
    // Fotografiamos los candidatos ANTES de escribir: la fila nueva se identifica por
    // diferencia de conjuntos, no por el orden implícito que devuelva Actual.
    const before = new Set(await candidateIds(api, a.account_id, a.date, cents));
    await api.addTransactions(a.account_id, [tx], { learnCategories: true, runTransfers: false });
    const { id: newId, ambiguous } = newIdFromDiff(before, await candidateIds(api, a.account_id, a.date, cents));
    const fresh = newId ? await getTransactionById(api, newId) : null;
    return {
      created: true,
      ...(ambiguous ? { note: m.ambiguousNewRow } : {}),
      transaction: mapTxEcho(fresh ?? { ...tx, id: newId ?? 'unknown', account: a.account_id }, config.locale, config.currency),
    };
  },
};
