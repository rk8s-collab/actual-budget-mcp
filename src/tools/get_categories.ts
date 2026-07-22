import { z } from 'zod';
import type { ToolDef } from '../core/types.js';

const input = {
  include_hidden: z.boolean().default(false).describe('Include hidden categories'),
  include_notes: z.boolean().default(false).describe('Include category notes (templates/goals)'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_categories',
  description: 'Category groups and categories with their IDs (IDs are required by write tools).',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api }) => {
    const args = schema.parse(raw ?? {});
    const groups = await api.getCategoryGroups();
    const out = [];
    for (const g of groups) {
      const cats = [];
      for (const c of g.categories ?? []) {
        if (!args.include_hidden && c.hidden) continue;
        const row: any = { id: c.id, name: c.name, hidden: !!c.hidden };
        if (args.include_notes) {
          // api.getNote devuelve {id, note} | null, no un string.
          const stored = await api.getNote(c.id);
          const note = (stored as any)?.note ?? null;
          if (note) row.note = note;
        }
        cats.push(row);
      }
      out.push({ id: g.id, name: g.name, is_income: !!g.is_income, categories: cats });
    }
    return { groups: out };
  },
};
