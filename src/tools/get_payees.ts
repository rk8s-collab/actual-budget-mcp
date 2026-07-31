import { z } from 'zod';
import { getPayeeIndex } from '../core/payees.js';
import type { ToolDef } from '../core/types.js';

const input = {
  only_transfers: z.boolean().default(false).describe('Only payees that represent an account (used to turn a transaction into a transfer)'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_payees',
  title: 'List payees',
  description: 'Payees with their IDs. A payee with transfer_account_id set is the payee Actual uses to represent that account in a transfer.',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api }) => {
    const a = schema.parse(raw ?? {});
    const { all } = await getPayeeIndex(api);
    const payees = all
      .filter((p) => !a.only_transfers || p.transfer_acct !== null)
      .map((p) => ({ id: p.id, name: p.name, transfer_account_id: p.transfer_acct }));
    return { payees };
  },
};
