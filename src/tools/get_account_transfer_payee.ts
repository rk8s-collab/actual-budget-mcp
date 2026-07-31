import { z } from 'zod';
import { getPayeeIndex } from '../core/payees.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  account_id: ID.describe('Account UUID (from get_accounts)'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_account_transfer_payee',
  title: 'Get account transfer payee',
  description: 'The payee that represents an account in a transfer. Shortcut over get_payees for the common case; set_transaction_transfer resolves it on its own, so this is mainly for inspection.',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    const accounts = (await api.getAccounts()) ?? [];
    if (!(accounts as any[]).some((acc) => acc.id === a.account_id)) {
      throw new Error(m.accountNotFound(a.account_id));
    }
    const { byTransferAccount } = await getPayeeIndex(api);
    const payee = byTransferAccount.get(a.account_id);
    if (!payee) throw new Error(m.transferPayeeNotFound(a.account_id));
    return { payee: { id: payee.id, name: payee.name, transfer_account_id: payee.transfer_acct } };
  },
};
