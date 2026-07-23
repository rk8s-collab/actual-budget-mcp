import { z } from 'zod';
import { getCategoryIndex } from '../core/categories.js';
import { readBackCategories } from '../core/tx-read.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  updates: z.array(z.object({
    transaction_id: ID,
    category_id: ID,
  })).min(1).max(50).describe('Max 50 per call; each item applies independently'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'categorize_transactions',
  description: 'Bulk-categorize transactions: [{transaction_id, category_id}] (max 50). Each update applies independently. The result names exactly which succeeded (verified by re-reading), which failed, and which were sent but could not be confirmed.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    // Pre-lectura por lote: detecta hijos/padres de split e ids inexistentes antes de escribir.
    const ids = a.updates.map((u) => u.transaction_id);
    const { data: rows } = await api.runQuery(
      api.q('transactions').filter({ id: { $oneof: ids } }).options({ splits: 'all' }).select(['id', 'is_child', 'is_parent']),
    );
    const info = new Map((rows as any[]).map((r) => [r.id, r]));
    // Actual no comprueba que la categoría exista: sin esto, un id inventado
    // dejaría la transacción sin categoría y la tool informaría de éxito.
    const cats = await getCategoryIndex(api);
    const m = msg(config);
    const written: any[] = [];
    const succeeded: any[] = [];
    const unconfirmed: any[] = [];
    const failed: any[] = [];
    for (const u of a.updates) {
      const meta = info.get(u.transaction_id);
      if (!meta) {
        failed.push({ transaction_id: u.transaction_id, error: m.txNotFoundItem });
        continue;
      }
      if (meta.is_child) {
        failed.push({ transaction_id: u.transaction_id, error: m.splitChildItem });
        continue;
      }
      if (meta.is_parent) {
        failed.push({ transaction_id: u.transaction_id, error: m.splitParentItem });
        continue;
      }
      const cat = cats.get(u.category_id);
      if (!cat) {
        failed.push({ transaction_id: u.transaction_id, error: m.categoryNotFound(u.category_id) });
        continue;
      }
      try {
        await api.updateTransaction(u.transaction_id, { category: u.category_id });
        written.push({ transaction_id: u.transaction_id, category_id: u.category_id, category_name: cat.name });
      } catch (err) {
        failed.push({ transaction_id: u.transaction_id, error: (err as Error).message ?? String(err) });
      }
    }

    // api.updateTransaction() resuelve ANTES de que la escritura aterrice (ver readBack),
    // así que "no lanzó" no prueba que la categoría se haya aplicado. Se confirma releyendo
    // el lote; lo que no se pueda confirmar no se cuenta como éxito.
    const settled = written.length > 0
      ? await readBackCategories(api, new Map(written.map((w) => [w.transaction_id, w.category_id])))
      : new Set<string>();
    for (const w of written) (settled.has(w.transaction_id) ? succeeded : unconfirmed).push(w);

    return {
      total: a.updates.length,
      success_count: succeeded.length,
      failure_count: failed.length,
      unconfirmed_count: unconfirmed.length,
      succeeded,
      failed,
      ...(unconfirmed.length > 0
        ? { unconfirmed, note: m.unconfirmedWrites }
        : {}),
    };
  },
};
