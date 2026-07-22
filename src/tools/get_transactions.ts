import { z } from 'zod';
import { moneyFields, toCents } from '../core/money.js';
import { ID, type ToolDef } from '../core/types.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato YYYY-MM-DD');

const input = {
  start_date: DATE.describe('Start date YYYY-MM-DD'),
  end_date: DATE.describe('End date YYYY-MM-DD'),
  account_id: ID.optional(),
  category_id: ID.optional(),
  search_text: z.string().optional().describe('Substring match on payee name or notes'),
  min_amount: z.number().optional().describe('Units, e.g. -500'),
  max_amount: z.number().optional(),
  uncategorized: z.boolean().default(false),
  include_transfers: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_transactions',
  description: 'Search transactions by date range with optional filters (account, category, text, amount range, uncategorized). Transfers excluded by default. Paginated (max 200).',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const filters: any[] = [{ date: { $gte: a.start_date, $lte: a.end_date } }, { is_parent: false }];
    if (!a.include_transfers) filters.push({ transfer_id: null });
    if (a.account_id) filters.push({ account: a.account_id });
    if (a.category_id) filters.push({ category: a.category_id });
    if (a.uncategorized) filters.push({ category: null, transfer_id: null });
    if (a.min_amount !== undefined) filters.push({ amount: { $gte: toCents(a.min_amount) } });
    if (a.max_amount !== undefined) filters.push({ amount: { $lte: toCents(a.max_amount) } });
    if (a.search_text) {
      filters.push({ $or: [{ 'payee.name': { $like: `%${a.search_text}%` } }, { notes: { $like: `%${a.search_text}%` } }] });
    }

    let countQ: any = api.q('transactions');
    for (const f of filters) countQ = countQ.filter(f);
    const { data: total } = await api.runQuery(countQ.calculate({ $count: 'id' }));

    let selQ: any = api.q('transactions');
    for (const f of filters) selQ = selQ.filter(f);
    const { data } = await api.runQuery(
      selQ
        .orderBy({ date: 'desc' })
        .limit(a.limit)
        .offset(a.offset)
        .select(['id', 'date', 'account.name', 'payee.name', 'category.name', 'amount', 'notes', 'transfer_id', 'is_parent', 'is_child', 'parent_id']),
    );

    const transactions = (data as any[]).map((t) => {
      const row: any = {
        id: t.id,
        date: t.date,
        account: t['account.name'] ?? 'Unknown',
        payee: t['payee.name'] ?? '',
        category: t['category.name'] ?? (t.transfer_id ? null : 'Uncategorized'),
        ...moneyFields(t.amount ?? 0, config.locale, config.currency),
      };
      if (t.notes) row.notes = t.notes;
      if (t.transfer_id) row.is_transfer = true;
      if (t.is_parent) row.is_split = true;
      if (t.is_child) { row.is_child = true; row.parent_id = t.parent_id; }
      return row;
    });

    return { transactions, total_count: typeof total === 'number' ? total : transactions.length, limit: a.limit, offset: a.offset };
  },
};
