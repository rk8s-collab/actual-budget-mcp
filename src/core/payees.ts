// payees.ts — payee index.
//
// Actual creates one hidden "transfer payee" per account, marked by transfer_acct.
// Pointing a transaction at one is what turns it into a transfer, so the lookup
// account -> transfer payee is the core of set_transaction_transfer.

export interface PayeeInfo {
  id: string;
  name: string;
  transfer_acct: string | null;
}

export async function getPayeeIndex(api: any): Promise<{
  byId: Map<string, PayeeInfo>;
  byTransferAccount: Map<string, PayeeInfo>;
  all: PayeeInfo[];
}> {
  const raw = (await api.getPayees()) ?? [];
  const all: PayeeInfo[] = (raw as any[]).map((p) => ({
    id: p.id,
    name: p.name,
    transfer_acct: p.transfer_acct ?? null,
  }));
  const byId = new Map<string, PayeeInfo>();
  const byTransferAccount = new Map<string, PayeeInfo>();
  for (const p of all) {
    byId.set(p.id, p);
    if (p.transfer_acct) byTransferAccount.set(p.transfer_acct, p);
  }
  return { byId, byTransferAccount, all };
}
