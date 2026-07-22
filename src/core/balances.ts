// balances.ts — saldos reales por cuenta.
/** Saldos de ejemplo por cuenta (suma de transacciones vía AQL) — balance_current
 *  solo lo rellena el bank-sync y es null en cuentas manuales. */
export async function getAccountBalances(api: any): Promise<Map<string, number>> {
  const { data } = await api.runQuery(
    api.q('transactions').groupBy('account').select(['account', { balance: { $sum: '$amount' } }]),
  );
  const balances = new Map<string, number>();
  for (const row of (data ?? []) as any[]) {
    balances.set(row.account, row.balance ?? 0);
  }
  return balances;
}
