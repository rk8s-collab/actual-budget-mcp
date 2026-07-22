import { z } from 'zod';
import { getCategoryIndex, categoryNotFound } from '../core/categories.js';
import { ID, type ToolDef } from '../core/types.js';

const input = {
  category_id: ID.describe('Category UUID (from get_categories)'),
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
    const cat = (await getCategoryIndex(api)).get(a.category_id);
    if (!cat) throw new Error(categoryNotFound(a.category_id));
    const name = cat.name;
    await api.updateNote(a.category_id, a.note);
    // api.getNote devuelve {id, note} | null, no un string.
    const stored = await api.getNote(a.category_id);
    return { updated: true, category_id: a.category_id, category_name: name, note: (stored as any)?.note ?? null };
  },
};
