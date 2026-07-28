import { describe, it, expect, vi } from 'vitest';
import { applyDataset } from './apply.js';
import type { DemoDataset } from './dataset.js';

/**
 * Stub whose every method throws. Used to prove the duplicate-name guard in
 * applyDataset() rejects BEFORE any api call is made (fail-fast), not after
 * some partial work has already happened against the server.
 */
function throwingApiStub(): any {
  const fail = (name: string) => vi.fn(() => {
    throw new Error(`api.${name} should not have been called — the guard must run first`);
  });
  return {
    getCategoryGroups: fail('getCategoryGroups'),
    createCategoryGroup: fail('createCategoryGroup'),
    createCategory: fail('createCategory'),
    createAccount: fail('createAccount'),
    getPayees: fail('getPayees'),
    createPayee: fail('createPayee'),
    addTransactions: fail('addTransactions'),
    setBudgetAmount: fail('setBudgetAmount'),
    createRule: fail('createRule'),
    sync: fail('sync'),
  };
}

describe('applyDataset — duplicate name guard (Finding 1)', () => {
  it('rejects a dataset with the same category name in two different groups, before any api call', async () => {
    const dataset: DemoDataset = {
      accounts: [{ name: 'Checking', offBudget: false }],
      groups: [
        { name: 'GroupA', isIncome: false },
        { name: 'GroupB', isIncome: false },
      ],
      categories: [
        { name: 'Rent', group: 'GroupA', isIncome: false },
        { name: 'Rent', group: 'GroupB', isIncome: false }, // duplicate name, different group
      ],
      payees: [],
      transactions: [],
      budgets: [],
      rules: [],
    };

    await expect(applyDataset(throwingApiStub(), dataset)).rejects.toThrow(/duplicate category name/i);
  });

  it('accepts a dataset with no duplicate names (guard does not reject valid input)', async () => {
    // Kept deliberately empty so the only api calls applyDataset needs to make are the
    // read-then-sync calls below — no server-side create semantics to fake.
    const dataset: DemoDataset = {
      accounts: [],
      groups: [],
      categories: [],
      payees: [],
      transactions: [],
      budgets: [],
      rules: [],
    };

    const api: any = {
      getCategoryGroups: vi.fn(async () => []),
      getPayees: vi.fn(async () => []),
      sync: vi.fn(async () => undefined),
    };

    await expect(applyDataset(api, dataset)).resolves.toBeUndefined();
  });
});
