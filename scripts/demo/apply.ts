/**
 * Applies a pure DemoDataset (Task 1.1, scripts/demo/dataset.ts) to a real Actual server
 * through @actual-app/api. This module performs I/O; the dataset itself does not.
 *
 * Caller is responsible for api.init()/runImport()/api.shutdown() around this call — see
 * scripts/demo/apply.integration.test.ts for the expected sequence.
 */
import type { DemoDataset } from './dataset.js';

// The @actual-app/api surface used here has no first-party TypeScript types for these calls,
// so we accept the module namespace loosely typed.
type ActualApi = typeof import('@actual-app/api');

// The dataset references categories, groups, and accounts by bare name (see dataset.ts).
// Duplicate names within any of these lists would make later name -> id lookups ambiguous:
// the second definition would silently overwrite the first in the id maps below, and
// transactions/budgets/rules would attach to the wrong entity. Fail fast instead.
function assertNoDuplicateNames(
  items: { name: string }[],
  label: string,
  reason: string,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.name)) {
      throw new Error(`Demo dataset invalid: duplicate ${label} name "${item.name}" — ${reason}`);
    }
    seen.add(item.name);
  }
}

function validateDataset(dataset: DemoDataset): void {
  assertNoDuplicateNames(
    dataset.categories,
    'category',
    'category names must be unique because transactions reference categories by name',
  );
  assertNoDuplicateNames(
    dataset.groups,
    'category group',
    'category group names must be unique because categories reference groups by name',
  );
  assertNoDuplicateNames(
    dataset.accounts,
    'account',
    'account names must be unique because transactions reference accounts by name',
  );
}

// Looks up a name in a name -> id map, throwing a clear error instead of returning
// `undefined` silently when the dataset references a name that was never defined.
function resolveRequired(map: Record<string, string>, name: string, kind: string, context: string): string {
  const id = map[name];
  if (id === undefined) {
    throw new Error(`Unknown ${kind} "${name}" referenced by ${context}`);
  }
  return id;
}

export async function applyDataset(api: ActualApi, dataset: DemoDataset): Promise<void> {
  validateDataset(dataset);

  // 1. Category groups + categories. A freshly-imported budget already seeds a default
  // "Income" group (with "Income" / "Starting Balances" categories) — reuse existing
  // groups/categories by name instead of creating duplicates, which the server rejects.
  const existingGroups = await api.getCategoryGroups();
  const groupId: Record<string, string> = {};
  const catId: Record<string, string> = {};
  for (const g of existingGroups) {
    groupId[g.name] = g.id;
    for (const c of g.categories ?? []) catId[c.name] = c.id;
  }

  for (const g of dataset.groups) {
    if (!(g.name in groupId)) {
      groupId[g.name] = await api.createCategoryGroup({ name: g.name, is_income: g.isIncome });
    }
  }

  for (const c of dataset.categories) {
    if (!(c.name in catId)) {
      catId[c.name] = await api.createCategory({
        name: c.name,
        group_id: groupId[c.group],
        is_income: c.isIncome,
      });
    }
  }

  // 2. Accounts. Accounts cannot be hard-deleted via the API (only closeAccount), so a reset
  // wipes everything else and reuses the existing accounts by name instead of re-creating them
  // (which would duplicate them). Reuse existing accounts by name; only create missing ones.
  const acctId: Record<string, string> = {};
  for (const existing of await api.getAccounts()) {
    acctId[existing.name] = existing.id;
  }
  for (const a of dataset.accounts) {
    if (!(a.name in acctId)) {
      acctId[a.name] = await api.createAccount({ name: a.name, offbudget: a.offBudget });
    }
  }

  // 3. Payees. Transfer payees are auto-created per account by the server — resolve them from
  // getPayees() rather than creating them. Only create the dataset's non-transfer payees.
  const payees = await api.getPayees();
  const acctIdToName: Record<string, string> = {};
  for (const [name, id] of Object.entries(acctId)) acctIdToName[id] = name;

  const transferPayeeIdByAccountName: Record<string, string> = {};
  for (const p of payees) {
    if (p.transfer_acct && acctIdToName[p.transfer_acct]) {
      transferPayeeIdByAccountName[acctIdToName[p.transfer_acct]] = p.id;
    }
  }

  const payeeId: Record<string, string> = {};
  for (const p of dataset.payees) {
    if (p.transferAccount !== undefined) continue; // resolved above, not created
    payeeId[p.name] = await api.createPayee({ name: p.name });
  }

  // 4. Transactions, grouped by account.
  const txnsByAccount = new Map<string, unknown[]>();
  for (const t of dataset.transactions) {
    resolveRequired(acctId, t.account, 'account', 'a transaction');

    const txn: Record<string, unknown> = {
      date: t.date,
      amount: t.amount,
    };

    if (t.transferAccount) {
      txn.payee = resolveRequired(
        transferPayeeIdByAccountName,
        t.transferAccount,
        'transfer account',
        'a transaction',
      );
    } else if (t.payee) {
      txn.payee = resolveRequired(payeeId, t.payee, 'payee', 'a transaction');
    }

    if (t.category != null) {
      txn.category = resolveRequired(catId, t.category, 'category', 'a transaction');
    }

    if (t.splits) {
      txn.subtransactions = t.splits.map((s) => ({
        amount: s.amount,
        category: s.category == null ? undefined : resolveRequired(catId, s.category, 'category', 'a split'),
      }));
    }

    const list = txnsByAccount.get(t.account) ?? [];
    list.push(txn);
    txnsByAccount.set(t.account, list);
  }

  for (const [accountName, txns] of txnsByAccount) {
    await api.addTransactions(acctId[accountName], txns, { runTransfers: true });
  }

  // 5. Budgets.
  for (const b of dataset.budgets) {
    await api.setBudgetAmount(b.month, resolveRequired(catId, b.category, 'category', 'a budget'), b.amount);
  }

  // 6. Rules — resolve id-typed condition/action values (category/account/payee) before
  // creating. String ops (e.g. payee "contains") keep their literal value.
  const idFieldResolvers: Record<string, Record<string, string>> = {
    category: catId,
    account: acctId,
    payee: payeeId,
  };

  const resolveIdValue = (field: string, op: string, value: unknown, context: string): unknown => {
    if (op !== 'set' && op !== 'is' && op !== 'isNot') return value; // literal string ops (contains, etc.)
    const resolver = idFieldResolvers[field];
    if (!resolver || typeof value !== 'string') return value;
    return resolveRequired(resolver, value, field, context);
  };

  for (const rule of dataset.rules) {
    await api.createRule({
      stage: rule.stage,
      conditionsOp: rule.conditionsOp,
      conditions: rule.conditions.map((c) => ({
        field: c.field,
        op: c.op,
        value: resolveIdValue(c.field, c.op, c.value, 'a rule condition'),
      })),
      actions: rule.actions.map((a) => ({
        field: a.field,
        op: a.op,
        value: resolveIdValue(a.field, a.op, a.value, 'a rule action'),
      })),
    });
  }

  // 7. Push everything to the server.
  await api.sync();
}
