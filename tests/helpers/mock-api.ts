import { vi } from 'vitest';
import type { Config } from '../../src/core/config.js';

export const testConfig: Config = {
  serverUrl: 'https://x', password: 'p', syncId: 's', dataDir: '/tmp/x',
  locale: 'en-US', currency: 'USD', syncTtlSeconds: 60, enableWrite: true, messagesLang: 'es',
};

/** Chainable stand-in for api.q(): records table + calls, returned as the query object. */
export function chainableQ() {
  const calls: Record<string, unknown[]> = {};
  const builder: any = { calls };
  for (const m of ['filter', 'select', 'orderBy', 'limit', 'offset', 'calculate', 'options', 'groupBy']) {
    builder[m] = vi.fn((arg: unknown) => { (calls[m] ??= []).push(arg); return builder; });
  }
  return builder;
}

export function mockApi(overrides: Record<string, unknown> = {}) {
  return {
    getAccounts: vi.fn(async () => []),
    getCategories: vi.fn(async () => []),
    getCategoryGroups: vi.fn(async () => []),
    getBudgetMonth: vi.fn(async () => ({})),
    getNote: vi.fn(async () => null),
    getPayees: vi.fn(async () => []),
    createPayee: vi.fn(async () => 'p-new'),
    q: vi.fn((table: string) => { const b = chainableQ(); b.table = table; return b; }),
    runQuery: vi.fn(async () => ({ data: [] })),
    updateTransaction: vi.fn(async () => []),
    addTransactions: vi.fn(async () => 'ok'),
    deleteTransaction: vi.fn(async () => undefined),
    createSchedule: vi.fn(async () => 'sched-id'),
    setBudgetAmount: vi.fn(async () => undefined),
    setBudgetCarryover: vi.fn(async () => undefined),
    batchBudgetUpdates: vi.fn(async (fn: () => Promise<void>) => { await fn(); }),
    updateNote: vi.fn(async () => undefined),
    ...overrides,
  };
}
