import { z } from 'zod';
import type { ToolDef } from '../core/types.js';

const input = {
  category_id: z.string().min(1).describe('Category UUID (from get_categories)'),
  note: z.string().max(2000).describe('Note text; supports Actual goal templates like "#template 350"'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'update_category_note',
  description: 'Write the note of a category (used by Actual for goal templates, e.g. "#template 350"). Returns the stored note.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api }) => {
    const a = schema.parse(raw ?? {});
    const groups = await api.getCategoryGroups();
    let name: string | null = null;
    for (const g of groups) for (const c of g.categories ?? []) if (c.id === a.category_id) name = c.name;
    if (!name) throw new Error(`Categoría no encontrada: ${a.category_id} (usa get_categories para ver los ids)`);
    await api.updateNote(a.category_id, a.note);
    const stored = await api.getNote(a.category_id);
    return { updated: true, category_id: a.category_id, category_name: name, note: stored ?? a.note };
  },
};
