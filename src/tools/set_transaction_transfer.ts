import { z } from 'zod';
import { getPayeeIndex } from '../core/payees.js';
import { getTransactionById, mapTxEcho, readBack } from '../core/tx-read.js';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  transaction_id: ID.describe('Transaction UUID to convert (from get_transactions)'),
  target_account_id: ID.describe('Account UUID the money moves to/from (from get_accounts)'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'set_transaction_transfer',
  title: 'Turn transaction into transfer',
  description: 'Turn an ordinary transaction into a transfer with another account, by pointing it at that account transfer payee. Actual creates and links the matching transaction on the other account, and clears the category on both when the two accounts are on the same side of the budget (both on-budget or both off-budget). If the transaction is already a transfer, it is re-pointed to the new destination. Returns the transaction and the id of the linked counterpart.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);

    const accounts = (await api.getAccounts()) ?? [];
    if (!(accounts as any[]).some((acc) => acc.id === a.target_account_id)) {
      throw new Error(m.accountNotFound(a.target_account_id));
    }

    const existing = await getTransactionById(api, a.transaction_id);
    if (!existing) throw new Error(m.txNotFound(a.transaction_id));
    // Grouped reads return the PARENT row when given a child id: that mismatch is
    // the split-child detector, same as in update_transaction.
    if (existing.id !== a.transaction_id) throw new Error(m.splitChild(a.transaction_id, existing.id));
    if (existing.is_parent || (Array.isArray(existing.subtransactions) && existing.subtransactions.length > 0)) {
      // transfer.onUpdate removes the transfer for a parent instead of adding one.
      throw new Error(m.cannotTransferSplitParent(a.transaction_id));
    }
    if (existing.account === a.target_account_id) throw new Error(m.transferSameAccount);

    const { byTransferAccount } = await getPayeeIndex(api);
    const payee = byTransferAccount.get(a.target_account_id);
    if (!payee) throw new Error(m.transferPayeeNotFound(a.target_account_id));

    const fields = { payee: payee.id };
    await api.updateTransaction(a.transaction_id, fields);
    const { row, settled } = await readBack(api, a.transaction_id, fields);
    const sync = await syncAfterWrite(api);
    return {
      updated: true,
      ...(settled ? {} : { echo_pending: true, note: m.echoPending }),
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      target_account_id: a.target_account_id,
      // Present => Actual linked the counterpart leg. Reported as read, never assumed.
      transfer_id: row?.transfer_id ?? null,
      transaction: mapTxEcho(row ?? existing, config.locale, config.currency),
    };
  },
};
