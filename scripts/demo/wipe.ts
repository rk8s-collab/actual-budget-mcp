/**
 * Wipes everything reviewers/tests could have added to the demo budget, so a subsequent
 * applyDataset() re-apply restores the exact seed state (see scripts/demo/apply.ts).
 *
 * Accounts (and their auto-created transfer payees) are intentionally NOT removed here: the
 * API only exposes closeAccount (not a hard delete), and the tools this demo exercises expose
 * no account management. applyDataset() reuses existing accounts by name, so keeping them is
 * what makes reset idempotent without duplicating accounts.
 *
 * Order matters — dependents are deleted before what they depend on:
 *   1. Transactions (deleting a parent removes its splits too)
 *   2. Rules
 *   3. Categories (safe once transactions are gone — no transferCategoryId needed)
 *   4. Category groups
 *   5. Non-transfer payees (transfer payees belong to accounts we keep)
 */
type ActualApi = typeof import('@actual-app/api');

export async function wipeBudgetContents(api: ActualApi): Promise<void> {
  // 1. Transactions.
  const { data: txns } = await api.runQuery(
    api.q('transactions').select(['id']).options({ splits: 'none' }),
  );
  for (const row of txns as { id: string }[]) {
    await api.deleteTransaction(row.id);
  }

  // 2. Rules.
  for (const r of await api.getRules()) {
    await api.deleteRule(r.id);
  }

  // 3. Categories.
  for (const c of await api.getCategories()) {
    await api.deleteCategory(c.id);
  }

  // 4. Category groups.
  for (const g of await api.getCategoryGroups()) {
    await api.deleteCategoryGroup(g.id);
  }

  // 5. Non-transfer payees.
  for (const p of await api.getPayees()) {
    if (!p.transfer_acct) await api.deletePayee(p.id);
  }
}
