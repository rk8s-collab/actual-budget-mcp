import { z } from 'zod';
import { getCategoryIndex } from '../core/categories.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  category_id: ID.describe('Category UUID (from get_categories)'),
  note: z.string().max(2000).describe('Note text; supports Actual goal templates like "#template 350". Empty string erases the note and requires clear: true'),
  clear: z.boolean().default(false).describe('Set to true to confirm erasing the existing note (required when note is empty)'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'update_category_note',
  // Sobrescribe la nota anterior (Actual solo guarda una por categoría): destructivo.
  description: 'Overwrite the note of a category (used by Actual for goal templates, e.g. "#template 350"). Replaces any existing note; returns the previous and the stored one.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    const cat = (await getCategoryIndex(api)).get(a.category_id);
    if (!cat) throw new Error(m.categoryNotFound(a.category_id));
    const name = cat.name;
    // api.getNote devuelve {id, note} | null, no un string.
    const before = ((await api.getNote(a.category_id)) as any)?.note ?? null;
    if (a.note === '' && !a.clear) {
      throw new Error(m.emptyNoteRequiresClear(name));
    }
    await api.updateNote(a.category_id, a.note);
    const stored = await api.getNote(a.category_id);
    return {
      updated: true,
      category_id: a.category_id,
      category_name: name,
      previous_note: before,
      note: (stored as any)?.note ?? null,
    };
  },
};
