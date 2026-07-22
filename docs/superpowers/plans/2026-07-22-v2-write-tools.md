# Actual-MCP v2 — Plan 2: Write Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 8 write tools from `docs/superpowers/specs/2026-07-21-actual-mcp-v2-design.md` ("Tool catalog — write") on top of the Plan-1 core, plus the money-rounding decision and core hardening deferred from Plan 1's final review.

**Architecture:** Same ToolDef pattern as Plan 1 (`src/tools/*.ts`, registered in `src/tools/index.ts`, gated by `ENABLE_WRITE` via `collectTools`). New shared helper `src/core/tx-read.ts` for reading a transaction (grouped with subtransactions) to echo state after writes. Split = safe replace: create the split copy via `addTransactions` (the only API path that accepts `subtransactions` — verified against the real `api/transaction-update` handler, which does NOT handle subtransactions), then delete the original; create-first ordering means a failure can only ever leave a visible duplicate, never lose data.

**Tech Stack:** unchanged — TypeScript 6.x, Zod 4.x, `@modelcontextprotocol/sdk` 1.29.x, `@actual-app/api` 26.7+, Vitest.

## Global Constraints

- Write tools: `readOnly: false` → registered ONLY when `ENABLE_WRITE=true` (already enforced by `collectTools`; wrapper calls `ensureReady({forWrite:true})` which throws if sync fails — never write blind).
- All write INPUT amounts are in **units** (e.g. `120`, `60.50`); convert with `toCents` at the boundary. All OUTPUT amounts via `moneyFields` (units + formatted). Sum validations in integer cents.
- Every write returns the resulting state (the updated/created entity), echoing real data.
- NO delete tools in the catalog. (`split_transaction` uses `api.deleteTransaction` internally as part of atomic replace — documented, not exposed.)
- Tool names snake_case `^[a-zA-Z0-9_-]{1,64}$`. ESM `.js` import specifiers everywhere.
- Error shape (from the Plan-1 wrapper): throw plain `Error` with a clear Spanish-agnostic message, or `ZodError` for input problems — `server.ts` maps them to `{error:{code,message,hint}}`.
- All logging stderr only. Commits in Spanish, imperative, ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Verified API signatures (do not invent others):
  - `api.updateTransaction(id, fields: Partial<TransactionEntity>)` — fields NOT including subtransactions (unsupported in update).
  - `api.addTransactions(accountId, txs: Omit<ImportTransactionEntity,'account'>[], {learnCategories?, runTransfers?})` → `'ok'`; tx fields: `date, amount(cents), payee_name?, payee?, category?, notes?, cleared?, imported_id?, subtransactions?: [{amount, category?, notes?}]`.
  - `api.deleteTransaction(id)`.
  - `api.createSchedule(schedule: Omit<APIScheduleEntity,'id'>)` → `Promise<string>` (id). APIScheduleEntity: `{name, posts_transaction, payee?, account?, amount?, amountOp, date}` where `date` is `'YYYY-MM-DD'` or a RecurConfig `{frequency:'daily'|'weekly'|'monthly'|'yearly', start, interval?, endMode?, endOccurrences?, endDate?}`.
  - `api.setBudgetAmount(month, categoryId, cents)`, `api.setBudgetCarryover(month, categoryId, flag)`, `api.batchBudgetUpdates(func)`.
  - `api.getBudgetMonth(month)`, `api.getNote(id)`, `api.updateNote(id, note)`, `api.getCategoryGroups()`.
  - AQL: `api.q(table)` + `api.runQuery(query)`; field refs inside aggregates need `$` (`{$sum:'$amount'}`); `.options({splits:'grouped'})` returns parents with `subtransactions`.

---

### Task 1: money.ts — half-away-from-zero rounding

**Files:**
- Modify: `src/core/money.ts`
- Test: `tests/core/money.test.ts` (append)

**Interfaces:**
- Consumes/Produces: same exports (`toUnits`, `toCents`, `formatAmount`, `moneyFields`) — only rounding semantics change. Decision (Marco, 2026-07-22): half-away-from-zero, symmetric for negatives.

- [ ] **Step 1: Append failing tests** to `tests/core/money.test.ts`:

```ts
describe('half-away-from-zero (decisión 2026-07-22)', () => {
  it('rounds negative half cents away from zero', () => {
    expect(toCents(-0.015)).toBe(-2);   // Math.round daría -1
    expect(toCents(0.015)).toBe(2);
    expect(toCents(-0.025)).toBe(-3);   // Math.round daría -2
  });
  it('negative round-trip is stable', () => {
    expect(toCents(toUnits(-33333))).toBe(-33333);
  });
  it('does not disturb exact values', () => {
    expect(toCents(-19.99)).toBe(-1999);
    expect(toUnits(-2305)).toBe(-23.05);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/money.test.ts` — Expected: FAIL on the two negative-half cases.

- [ ] **Step 3: Implement** in `src/core/money.ts` — add helper and use it in both conversions:

```ts
// Redondeo half-away-from-zero: -1,5 → -2 (Math.round daría -1). Decisión 2026-07-22,
// necesario para splits proporcionales con importes negativos.
function roundHalfAwayFromZero(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

export function toUnits(cents: number): number {
  return roundHalfAwayFromZero(cents) / 100;
}

export function toCents(units: number): number {
  return roundHalfAwayFromZero(units * 100);
}
```

(`formatAmount` and `moneyFields` unchanged — they already delegate to `toUnits`.)

- [ ] **Step 4: Run** `npm test` — Expected: ALL pass (the Plan-1 positive cases, e.g. `toCents(0.1+0.2)===30`, still hold: |30.000000000000004| rounds to 30).

- [ ] **Step 5: Commit**

```bash
git add src/core/money.ts tests/core/money.test.ts
git commit -m "Cambiar redondeo a half-away-from-zero en money.ts (decisión pre-splits)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Core hardening (annotations, array guard, concurrency, registry test)

**Files:**
- Modify: `src/core/types.ts`, `src/core/server.ts`, `src/core/actual-client.ts`
- Test: `tests/core/server.test.ts`, `tests/core/actual-client.test.ts`, `tests/core/tool-registry.test.ts` (append)

**Interfaces:**
- Produces: `ToolDef.annotations?: { destructiveHint?: boolean; idempotentHint?: boolean }` — write tools set it per-tool; `server.ts` merges it over the defaults for non-readOnly tools. Read tools keep `{readOnlyHint:true}` untouched.

- [ ] **Step 1: Append failing tests**

`tests/core/server.test.ts`:

```ts
it('does not spread stale flags into array payloads', () => {
  const r = buildToolResult([{ a: 1 }], { stale: true, lastSynced: 'x' });
  expect(r.structuredContent).toEqual({ items: [{ a: 1 }], stale_data: true, last_synced: 'x' });
});
```

`tests/core/actual-client.test.ts` (uses the existing `mockApi`/`cfg` from that file):

```ts
it('does not double-init on concurrent first calls', async () => {
  const api = mockApi();
  const c = new ActualClient(api, cfg, () => 0);
  await Promise.all([c.ensureReady(), c.ensureReady()]);
  expect(api.init).toHaveBeenCalledTimes(1);
  expect(api.downloadBudget).toHaveBeenCalledTimes(1);
});
```

`tests/core/tool-registry.test.ts`:

```ts
it('validates names of write-gated tools even when filtered out', () => {
  expect(() => collectTools([mk('bad.write', false)], false)).toThrowError(/bad\.write/);
});
```

- [ ] **Step 2: Run** the three files — Expected: array-guard FAILS (current code spreads arrays), concurrency FAILS (double init), registry PASSES already (validate-before-filter exists) — keep it as regression lock.

- [ ] **Step 3: Implement**

`src/core/types.ts` — add to ToolDef:

```ts
  /** Solo tools de escritura: se fusiona sobre los defaults de server.ts */
  annotations?: { destructiveHint?: boolean; idempotentHint?: boolean };
```

`src/core/server.ts` — `buildToolResult` array guard (arrays get wrapped so stale flags never index-collide):

```ts
export function buildToolResult(
  payload: unknown,
  meta: { stale: boolean; lastSynced: string | null },
) {
  let body: any = payload;
  if (meta.stale) {
    const base = Array.isArray(payload) ? { items: payload } : (payload && typeof payload === 'object' ? payload : { value: payload });
    body = { ...base, stale_data: true, last_synced: meta.lastSynced };
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(body) }],
    structuredContent: body,
  };
}
```

and the registerTool annotations line becomes:

```ts
        annotations: tool.readOnly
          ? { readOnlyHint: true }
          : { readOnlyHint: false, destructiveHint: false, idempotentHint: false, ...(tool.annotations ?? {}) },
```

`src/core/actual-client.ts` — in-flight guard: add field `private initPromise: Promise<void> | null = null;` and replace the init branch body:

```ts
    if (!this.initialized) {
      if (!this.initPromise) {
        this.initPromise = (async () => {
          fs.mkdirSync(this.config.dataDir, { recursive: true });
          await this.api.init({
            dataDir: this.config.dataDir,
            serverURL: this.config.serverUrl,
            password: this.config.password,
          });
          await this.api.downloadBudget(this.config.syncId);
          this.initialized = true;
        })();
      }
      await this.initPromise;
    }
```

(the shared TTL block after it is unchanged and still performs the first `sync()`).

- [ ] **Step 4: Run** `npm test` — Expected: ALL pass (45 previous + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/server.ts src/core/actual-client.ts tests/core/
git commit -m "Endurecer core: annotations por tool, guard de arrays en stale y guard de concurrencia en init

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: tx-read.ts — shared transaction reader + mock extensions

**Files:**
- Create: `src/core/tx-read.ts`
- Modify: `tests/helpers/mock-api.ts`
- Test: `tests/core/tx-read.test.ts`

**Interfaces:**
- Produces:
  - `getTransactionById(api: any, id: string): Promise<any | null>` — AQL `q('transactions').filter({id}).options({splits:'grouped'}).select(['*'])`; returns the first row (grouped rows carry `subtransactions` for split parents) or null.
  - `mapTxEcho(raw: any, locale: string, currency: string): object` — compact echo `{id, date, account_id, payee, category_id, amount, amount_formatted, notes?, cleared?, splits?: [{amount, amount_formatted, category_id, notes?}]}` (write echoes keep IDs — the LLM just wrote with them; dotted names are not available on `select(['*'])` rows, so echoes use `payee` name if present on the raw row (`payee_name`) else the payee id).
  - `mockApi` gains: `updateTransaction`, `addTransactions`, `deleteTransaction`, `createSchedule`, `setBudgetAmount`, `setBudgetCarryover`, `batchBudgetUpdates` (implemented as `vi.fn(async (fn) => { await fn(); })`), `updateNote` — all `vi.fn(async () => ...)` with neutral defaults (`'ok'`, `undefined`, `'sched-id'`).

- [ ] **Step 1: Write failing tests** — `tests/core/tx-read.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getTransactionById, mapTxEcho } from '../../src/core/tx-read.js';
import { mockApi } from '../helpers/mock-api.js';

describe('getTransactionById', () => {
  it('queries by id with grouped splits and returns first row', async () => {
    const row = { id: 't1', date: '2026-07-01', account: 'a1', amount: -18000, subtransactions: [] };
    const api = mockApi({ runQuery: async () => ({ data: [row] }) });
    expect(await getTransactionById(api, 't1')).toEqual(row);
    const builder: any = (api.q as any).mock.results[0].value;
    expect(Object.assign({}, ...builder.calls.filter.flat())).toEqual({ id: 't1' });
    expect(builder.calls.options).toEqual([{ splits: 'grouped' }]);
  });
  it('returns null when not found', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [] }) });
    expect(await getTransactionById(api, 'nope')).toBeNull();
  });
});

describe('mapTxEcho', () => {
  it('maps cents to units and includes splits when present', () => {
    const echo: any = mapTxEcho({
      id: 't1', date: '2026-07-01', account: 'a1', payee: 'p1', category: null,
      amount: -18000, notes: 'ticket', cleared: true,
      subtransactions: [
        { amount: -12000, category: 'c1' },
        { amount: -6000, category: 'c2', notes: 'casa' },
      ],
    }, 'en-US', 'USD');
    expect(echo.amount).toBe(-180);
    expect(echo.splits).toHaveLength(2);
    expect(echo.splits[0]).toMatchObject({ amount: -120, category_id: 'c1' });
    expect(echo.splits[1].notes).toBe('casa');
  });
  it('omits splits/notes/cleared when absent', () => {
    const echo: any = mapTxEcho({ id: 't2', date: '2026-07-02', account: 'a1', amount: 500 }, 'en-US', 'USD');
    expect(echo).not.toHaveProperty('splits');
    expect(echo).not.toHaveProperty('notes');
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/core/tx-read.ts`:

```ts
import { moneyFields } from './money.js';

/** Lee una transacción por id con splits agrupados (parents llevan subtransactions). */
export async function getTransactionById(api: any, id: string): Promise<any | null> {
  const { data } = await api.runQuery(
    api.q('transactions').filter({ id }).options({ splits: 'grouped' }).select(['*']),
  );
  return (data as any[])[0] ?? null;
}

/** Echo compacto post-escritura: ids incluidos (el LLM acaba de usarlos). */
export function mapTxEcho(raw: any, locale: string, currency: string) {
  const echo: any = {
    id: raw.id,
    date: raw.date,
    account_id: raw.account,
    payee: raw.payee_name ?? raw.payee ?? null,
    category_id: raw.category ?? null,
    ...moneyFields(raw.amount ?? 0, locale, currency),
  };
  if (raw.notes) echo.notes = raw.notes;
  if (raw.cleared !== undefined) echo.cleared = !!raw.cleared;
  if (Array.isArray(raw.subtransactions) && raw.subtransactions.length > 0) {
    echo.splits = raw.subtransactions.map((s: any) => {
      const part: any = { category_id: s.category ?? null, ...moneyFields(s.amount ?? 0, locale, currency) };
      if (s.notes) part.notes = s.notes;
      return part;
    });
  }
  return echo;
}
```

`tests/helpers/mock-api.ts` — extend the returned object in `mockApi` (keep everything existing):

```ts
    updateTransaction: vi.fn(async () => []),
    addTransactions: vi.fn(async () => 'ok'),
    deleteTransaction: vi.fn(async () => undefined),
    createSchedule: vi.fn(async () => 'sched-id'),
    setBudgetAmount: vi.fn(async () => undefined),
    setBudgetCarryover: vi.fn(async () => undefined),
    batchBudgetUpdates: vi.fn(async (fn: () => Promise<void>) => { await fn(); }),
    updateNote: vi.fn(async () => undefined),
```

- [ ] **Step 4: Run** `npx vitest run tests/core/tx-read.test.ts` — Expected: PASS (4 tests). Then `npm test` all green.

- [ ] **Step 5: Commit**

```bash
git add src/core/tx-read.ts tests/core/tx-read.test.ts tests/helpers/mock-api.ts
git commit -m "Añadir tx-read: lectura agrupada por id y echo compacto para escrituras (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `update_transaction`

**Files:**
- Create: `src/tools/update_transaction.ts`
- Modify: `src/tools/index.ts` (append import + entry; keep the existing 8 — this registration pattern repeats in every tool task)
- Test: `tests/tools/update_transaction.test.ts`

**Interfaces:**
- Consumes: `toCents` (money), `getTransactionById`/`mapTxEcho` (tx-read), ToolDef.
- Produces output: `{ updated: true, transaction: <mapTxEcho> }`.

- [ ] **Step 1: Write failing test** — `tests/tools/update_transaction.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/update_transaction.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

describe('update_transaction', () => {
  it('converts amount to cents, passes only provided fields, echoes result', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ id: 't1', date: '2026-07-01', account: 'a1', category: 'c9', amount: -4550 }] }),
    });
    const r: any = await tool.handler(
      { transaction_id: 't1', category_id: 'c9', amount: -45.5 },
      { api, config: testConfig },
    );
    expect(api.updateTransaction).toHaveBeenCalledWith('t1', { category: 'c9', amount: -4550 });
    expect(r.updated).toBe(true);
    expect(r.transaction).toMatchObject({ id: 't1', category_id: 'c9', amount: -45.5 });
  });
  it('rejects when no field to update is provided', async () => {
    await expect(tool.handler({ transaction_id: 't1' }, { api: mockApi(), config: testConfig }))
      .rejects.toThrow(/campo/i);
  });
  it('errors clearly when the transaction does not exist', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [] }) });
    await expect(tool.handler({ transaction_id: 'nope', notes: 'x' }, { api, config: testConfig }))
      .rejects.toThrow(/nope/);
  });
  it('is write-gated', () => {
    expect(tool.readOnly).toBe(false);
    expect(tool.name).toBe('update_transaction');
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/tools/update_transaction.ts`:

```ts
import { z } from 'zod';
import { toCents } from '../core/money.js';
import { getTransactionById, mapTxEcho } from '../core/tx-read.js';
import type { ToolDef } from '../core/types.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato YYYY-MM-DD');

const input = {
  transaction_id: z.string().min(1),
  category_id: z.string().optional(),
  payee_name: z.string().optional().describe('Payee by name (resolved/created server-side)'),
  notes: z.string().max(1000).optional(),
  date: DATE.optional(),
  amount: z.number().optional().describe('Units (e.g. -45.50)'),
  cleared: z.boolean().optional(),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'update_transaction',
  description: 'Update fields of an existing transaction (category, payee, notes, date, amount, cleared). Amount in currency units. Returns the resulting transaction.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const fields: any = {};
    if (a.category_id !== undefined) fields.category = a.category_id;
    if (a.payee_name !== undefined) fields.payee_name = a.payee_name;
    if (a.notes !== undefined) fields.notes = a.notes;
    if (a.date !== undefined) fields.date = a.date;
    if (a.amount !== undefined) fields.amount = toCents(a.amount);
    if (a.cleared !== undefined) fields.cleared = a.cleared;
    if (Object.keys(fields).length === 0) {
      throw new Error('Debes indicar al menos un campo a actualizar (category_id, payee_name, notes, date, amount, cleared)');
    }
    const existing = await getTransactionById(api, a.transaction_id);
    if (!existing) throw new Error(`Transacción no encontrada: ${a.transaction_id}`);
    await api.updateTransaction(a.transaction_id, fields);
    const updated = await getTransactionById(api, a.transaction_id);
    return { updated: true, transaction: mapTxEcho(updated ?? existing, config.locale, config.currency) };
  },
};
```

Register in `src/tools/index.ts`: `import { tool as updateTransaction } from './update_transaction.js';` + append `updateTransaction` to `allTools`.

- [ ] **Step 4: Run** `npx vitest run tests/tools/update_transaction.test.ts` — Expected: PASS (4 tests). NOTE: the first test's `runQuery` mock returns the same row for the pre-check and the echo — assert on the echo mapping, not on call counts.

- [ ] **Step 5: Commit**

```bash
git add src/tools/update_transaction.ts src/tools/index.ts tests/tools/update_transaction.test.ts
git commit -m "Añadir update_transaction: edición con importes en unidades y echo real (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `categorize_transactions` (batch)

**Files:**
- Create: `src/tools/categorize_transactions.ts`
- Modify: `src/tools/index.ts` (Task 4 pattern)
- Test: `tests/tools/categorize_transactions.test.ts`

**Interfaces:**
- Produces output: `{ total, success_count, failure_count, succeeded: [{transaction_id, category_id}], failed: [{transaction_id, error}] }`. Max 50 per call; each item applied independently.

- [ ] **Step 1: Write failing test** — `tests/tools/categorize_transactions.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/categorize_transactions.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

describe('categorize_transactions', () => {
  it('applies each update independently and reports per-item results', async () => {
    const api = mockApi();
    (api.updateTransaction as any) = vi.fn(async (id: string) => {
      if (id === 't2') throw new Error('boom');
    });
    const r: any = await tool.handler(
      { updates: [
        { transaction_id: 't1', category_id: 'c1' },
        { transaction_id: 't2', category_id: 'c1' },
        { transaction_id: 't3', category_id: 'c2' },
      ] },
      { api, config: testConfig },
    );
    expect(r).toMatchObject({ total: 3, success_count: 2, failure_count: 1 });
    expect(r.succeeded.map((s: any) => s.transaction_id)).toEqual(['t1', 't3']);
    expect(r.failed[0]).toMatchObject({ transaction_id: 't2', error: 'boom' });
    expect(api.updateTransaction).toHaveBeenCalledWith('t1', { category: 'c1' });
  });
  it('rejects more than 50 updates', async () => {
    const updates = Array.from({ length: 51 }, (_, i) => ({ transaction_id: `t${i}`, category_id: 'c' }));
    await expect(tool.handler({ updates }, { api: mockApi(), config: testConfig })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/categorize_transactions.ts`:

```ts
import { z } from 'zod';
import type { ToolDef } from '../core/types.js';

const input = {
  updates: z.array(z.object({
    transaction_id: z.string().min(1),
    category_id: z.string().min(1),
  })).min(1).max(50).describe('Máx. 50 por llamada; cada item se aplica de forma independiente'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'categorize_transactions',
  description: 'Bulk-categorize transactions: [{transaction_id, category_id}] (max 50). Each update applies independently; the result names exactly which succeeded and which failed.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api }) => {
    const a = schema.parse(raw ?? {});
    const succeeded: any[] = [];
    const failed: any[] = [];
    for (const u of a.updates) {
      try {
        await api.updateTransaction(u.transaction_id, { category: u.category_id });
        succeeded.push({ transaction_id: u.transaction_id, category_id: u.category_id });
      } catch (err) {
        failed.push({ transaction_id: u.transaction_id, error: (err as Error).message ?? String(err) });
      }
    }
    return { total: a.updates.length, success_count: succeeded.length, failure_count: failed.length, succeeded, failed };
  },
};
```

Register in `src/tools/index.ts` (Task 4 pattern).

- [ ] **Step 4: Run** — Expected: PASS (2 tests). Full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/tools/categorize_transactions.ts src/tools/index.ts tests/tools/categorize_transactions.test.ts
git commit -m "Añadir categorize_transactions: categorización en lote con resultado por item (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `split_transaction` ⭐ (safe replace with subtransactions)

**Files:**
- Create: `src/tools/split_transaction.ts`
- Modify: `src/tools/index.ts` (Task 4 pattern)
- Test: `tests/tools/split_transaction.test.ts`

**Interfaces:**
- Consumes: `toCents`/`moneyFields`, `getTransactionById`/`mapTxEcho`.
- Produces output: `{ split: true, original_id, transaction: <mapTxEcho of the new grouped parent> }`.
- Semantics (spec amendment, verified against the real API): `subtransactions` only works on create/import, so splitting = **replace**: (1) read original; (2) validate (exists, not already split, not a transfer, sum matches); (3) `addTransactions` the split copy (carrying date, payee, notes, cleared; NOT imported_id to avoid dedup conflicts); (4) locate the new parent id via AQL (newest by sortId not available → filter account+date+amount and pick the id not equal to original); (5) `deleteTransaction(original)`; (6) echo new grouped state. Create-first ordering: a failure between (3) and (5) leaves a visible duplicate — the error message says exactly that and names both ids. Sum validation in integer cents; `adjust_last: true` computes the final part server-side.

- [ ] **Step 1: Write failing test** — `tests/tools/split_transaction.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/split_transaction.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const original = { id: 't1', date: '2026-07-10', account: 'a1', payee: 'p1', amount: -18000, notes: 'super', cleared: true, transfer_id: null, is_parent: false };
const newParent = { id: 't9', date: '2026-07-10', account: 'a1', payee: 'p1', amount: -18000, notes: 'super',
  subtransactions: [{ amount: -12000, category: 'c1' }, { amount: -6000, category: 'c2' }] };

function apiForSplit() {
  let call = 0;
  return mockApi({
    runQuery: vi.fn(async () => {
      call += 1;
      if (call === 1) return { data: [original] };                      // pre-read
      if (call === 2) return { data: [{ id: 't1' }, { id: 't9' }] };    // locate candidates
      return { data: [newParent] };                                     // echo grouped
    }),
  });
}

describe('split_transaction', () => {
  it('creates split copy, deletes original, echoes new state', async () => {
    const api = apiForSplit();
    const r: any = await tool.handler(
      { transaction_id: 't1', splits: [
        { amount: -120, category_id: 'c1' },
        { amount: -60, category_id: 'c2' },
      ] },
      { api, config: testConfig },
    );
    expect(api.addTransactions).toHaveBeenCalledWith('a1', [expect.objectContaining({
      date: '2026-07-10', amount: -18000, notes: 'super', cleared: true,
      subtransactions: [
        { amount: -12000, category: 'c1' },
        { amount: -6000, category: 'c2' },
      ],
    })], { learnCategories: false, runTransfers: false });
    expect(api.deleteTransaction).toHaveBeenCalledWith('t1');
    expect(r).toMatchObject({ split: true, original_id: 't1' });
    expect(r.transaction.splits).toHaveLength(2);
  });
  it('rejects when parts do not sum to the total, reporting the difference', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [original] }) });
    await expect(tool.handler(
      { transaction_id: 't1', splits: [{ amount: -120, category_id: 'c1' }, { amount: -50, category_id: 'c2' }] },
      { api, config: testConfig },
    )).rejects.toThrow(/-10|10,00|difieren/i);
    expect(api.addTransactions).not.toHaveBeenCalled();
  });
  it('adjust_last computes the remainder server-side', async () => {
    const api = apiForSplit();
    await tool.handler(
      { transaction_id: 't1', adjust_last: true, splits: [
        { amount: -120, category_id: 'c1' },
        { amount: 0, category_id: 'c2' },
      ] },
      { api, config: testConfig },
    );
    const sent = (api.addTransactions as any).mock.calls[0][1][0].subtransactions;
    expect(sent[1].amount).toBe(-6000); // -18000 - (-12000)
  });
  it('refuses transfers and already-split transactions', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [{ ...original, transfer_id: 'x' }] }) });
    await expect(tool.handler(
      { transaction_id: 't1', splits: [{ amount: -180, category_id: 'c1' }] },
      { api, config: testConfig },
    )).rejects.toThrow(/transferencia/i);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/split_transaction.ts`:

```ts
import { z } from 'zod';
import { toCents, formatAmount } from '../core/money.js';
import { getTransactionById, mapTxEcho } from '../core/tx-read.js';
import type { ToolDef } from '../core/types.js';

const input = {
  transaction_id: z.string().min(1),
  splits: z.array(z.object({
    amount: z.number().describe('Units; same sign as the original. With adjust_last, the LAST part may be 0 (computed server-side)'),
    category_id: z.string().min(1),
    notes: z.string().max(1000).optional(),
  })).min(2).describe('Parts of the split (min 2)'),
  adjust_last: z.boolean().default(false).describe('Compute the last part as the exact remainder'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'split_transaction',
  description: 'Split an existing transaction into parts with real subtransactions. Parts must sum exactly to the original amount (integer-cent validation); adjust_last=true computes the final part. Internally replaces the transaction (new id).',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const orig = await getTransactionById(api, a.transaction_id);
    if (!orig) throw new Error(`Transacción no encontrada: ${a.transaction_id}`);
    if (orig.transfer_id) throw new Error('No se puede dividir una transferencia entre cuentas');
    if (orig.is_parent || (Array.isArray(orig.subtransactions) && orig.subtransactions.length > 0)) {
      throw new Error('La transacción ya está dividida; edita sus partes en Actual o deshaz el split primero');
    }

    const totalCents = orig.amount ?? 0;
    const parts = a.splits.map((s) => ({ amount: toCents(s.amount), category: s.category_id, ...(s.notes ? { notes: s.notes } : {}) }));
    const partialSum = parts.slice(0, -1).reduce((s, p) => s + p.amount, 0);
    if (a.adjust_last) {
      parts[parts.length - 1].amount = totalCents - partialSum;
    }
    const sum = parts.reduce((s, p) => s + p.amount, 0);
    if (sum !== totalCents) {
      const diff = totalCents - sum;
      throw new Error(
        `Las partes difieren del total: suman ${formatAmount(sum, config.locale, config.currency)} y el movimiento es ${formatAmount(totalCents, config.locale, config.currency)} (faltan ${formatAmount(diff, config.locale, config.currency)}). Ajusta las partes o usa adjust_last=true`,
      );
    }

    // Crear primero, borrar después: un fallo intermedio deja un duplicado visible, nunca pérdida de datos.
    const copy: any = { date: orig.date, amount: totalCents, subtransactions: parts };
    if (orig.payee) copy.payee = orig.payee;
    if (orig.notes) copy.notes = orig.notes;
    if (orig.cleared !== undefined) copy.cleared = !!orig.cleared;
    await api.addTransactions(orig.account, [copy], { learnCategories: false, runTransfers: false });

    const { data: candidates } = await api.runQuery(
      api.q('transactions')
        .filter({ account: orig.account })
        .filter({ date: orig.date })
        .filter({ amount: totalCents })
        .options({ splits: 'grouped' })
        .select(['id']),
    );
    const newId = (candidates as any[]).map((c) => c.id).find((cid) => cid !== a.transaction_id);
    if (!newId) {
      throw new Error(`Split creado pero no localizado; el original ${a.transaction_id} NO se ha borrado — revisa duplicados en Actual`);
    }
    try {
      await api.deleteTransaction(a.transaction_id);
    } catch (err) {
      throw new Error(
        `Split creado como ${newId} pero no se pudo borrar el original ${a.transaction_id} (${(err as Error).message}); hay un duplicado visible en Actual — borra el original a mano`,
      );
    }
    const fresh = await getTransactionById(api, newId);
    return { split: true, original_id: a.transaction_id, transaction: mapTxEcho(fresh ?? { ...copy, id: newId, account: orig.account }, config.locale, config.currency) };
  },
};
```

Register in `src/tools/index.ts` (Task 4 pattern).

- [ ] **Step 4: Run** — Expected: PASS (4 tests). Full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/tools/split_transaction.ts src/tools/index.ts tests/tools/split_transaction.test.ts
git commit -m "Añadir split_transaction: división real con subtransacciones y reemplazo seguro (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `create_transaction`

**Files:**
- Create: `src/tools/create_transaction.ts`
- Modify: `src/tools/index.ts` (Task 4 pattern)
- Test: `tests/tools/create_transaction.test.ts`

**Interfaces:**
- Produces output: `{ created: true, transaction: <mapTxEcho> }`. Optional `splits` creates the transaction already split (one call). Locates the created row the same way as split (account+date+amount, newest candidate — here there is no "other id", take the first candidate).

- [ ] **Step 1: Write failing test** — `tests/tools/create_transaction.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/create_transaction.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

describe('create_transaction', () => {
  it('creates with payee_name and category, converts units to cents, echoes state', async () => {
    let call = 0;
    const api = mockApi({
      runQuery: vi.fn(async () => {
        call += 1;
        if (call === 1) return { data: [{ id: 'tNew' }] };
        return { data: [{ id: 'tNew', date: '2026-07-22', account: 'a1', payee_name: 'Mercadona', category: 'c1', amount: -2350 }] };
      }),
    });
    const r: any = await tool.handler(
      { account_id: 'a1', date: '2026-07-22', amount: -23.5, payee_name: 'Mercadona', category_id: 'c1' },
      { api, config: testConfig },
    );
    expect(api.addTransactions).toHaveBeenCalledWith('a1', [expect.objectContaining({
      date: '2026-07-22', amount: -2350, payee_name: 'Mercadona', category: 'c1',
    })], { learnCategories: true, runTransfers: false });
    expect(r.created).toBe(true);
    expect(r.transaction).toMatchObject({ id: 'tNew', amount: -23.5 });
  });
  it('creates already-split when splits are given and they sum to the total', async () => {
    let call = 0;
    const api = mockApi({
      runQuery: vi.fn(async () => {
        call += 1;
        if (call === 1) return { data: [{ id: 'tS' }] };
        return { data: [{ id: 'tS', date: '2026-07-22', account: 'a1', amount: -18000,
          subtransactions: [{ amount: -12000, category: 'c1' }, { amount: -6000, category: 'c2' }] }] };
      }),
    });
    const r: any = await tool.handler(
      { account_id: 'a1', date: '2026-07-22', amount: -180, payee_name: 'Super', splits: [
        { amount: -120, category_id: 'c1' }, { amount: -60, category_id: 'c2' },
      ] },
      { api, config: testConfig },
    );
    expect(r.transaction.splits).toHaveLength(2);
  });
  it('rejects splits that do not sum to the amount', async () => {
    const api = mockApi();
    await expect(tool.handler(
      { account_id: 'a1', date: '2026-07-22', amount: -180, splits: [
        { amount: -120, category_id: 'c1' }, { amount: -50, category_id: 'c2' },
      ] },
      { api, config: testConfig },
    )).rejects.toThrow(/difieren/i);
    expect(api.addTransactions).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/create_transaction.ts`:

```ts
import { z } from 'zod';
import { toCents, formatAmount } from '../core/money.js';
import { getTransactionById, mapTxEcho } from '../core/tx-read.js';
import type { ToolDef } from '../core/types.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato YYYY-MM-DD');

const input = {
  account_id: z.string().min(1),
  date: DATE,
  amount: z.number().describe('Units; negative = expense, positive = income'),
  payee_name: z.string().optional(),
  category_id: z.string().optional(),
  notes: z.string().max(1000).optional(),
  cleared: z.boolean().optional(),
  splits: z.array(z.object({
    amount: z.number(),
    category_id: z.string().min(1),
    notes: z.string().max(1000).optional(),
  })).min(2).optional().describe('Create already split; parts must sum exactly to amount'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'create_transaction',
  description: 'Record a new transaction (expense or income) in an account. Amount in currency units. Optional splits create it already divided. Returns the created transaction.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const cents = toCents(a.amount);
    const tx: any = { date: a.date, amount: cents };
    if (a.payee_name) tx.payee_name = a.payee_name;
    if (a.category_id) tx.category = a.category_id;
    if (a.notes) tx.notes = a.notes;
    if (a.cleared !== undefined) tx.cleared = a.cleared;
    if (a.splits) {
      const parts = a.splits.map((s) => ({ amount: toCents(s.amount), category: s.category_id, ...(s.notes ? { notes: s.notes } : {}) }));
      const sum = parts.reduce((s, p) => s + p.amount, 0);
      if (sum !== cents) {
        throw new Error(
          `Las partes difieren del total: suman ${formatAmount(sum, config.locale, config.currency)} y el importe es ${formatAmount(cents, config.locale, config.currency)}`,
        );
      }
      tx.subtransactions = parts;
    }
    await api.addTransactions(a.account_id, [tx], { learnCategories: true, runTransfers: false });
    const { data: candidates } = await api.runQuery(
      api.q('transactions')
        .filter({ account: a.account_id })
        .filter({ date: a.date })
        .filter({ amount: cents })
        .options({ splits: 'grouped' })
        .select(['id']),
    );
    const newId = (candidates as any[])[0]?.id;
    const fresh = newId ? await getTransactionById(api, newId) : null;
    return {
      created: true,
      transaction: mapTxEcho(fresh ?? { ...tx, id: newId ?? 'unknown', account: a.account_id }, config.locale, config.currency),
    };
  },
};
```

Register in `src/tools/index.ts` (Task 4 pattern).

- [ ] **Step 4: Run** — Expected: PASS (3 tests). Full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/tools/create_transaction.ts src/tools/index.ts tests/tools/create_transaction.test.ts
git commit -m "Añadir create_transaction con splits opcionales en la creación (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: `create_schedule`

**Files:**
- Create: `src/tools/create_schedule.ts`
- Modify: `src/tools/index.ts` (Task 4 pattern)
- Test: `tests/tools/create_schedule.test.ts`

**Interfaces:**
- Consumes: `api.createSchedule(schedule)` → id. Payees must be referenced by UUID here (createSchedule has no payee_name resolution): the tool accepts `payee_name` and resolves it against `api.getPayees()` (error listing close options if not found).
- Produces output: `{ created: true, schedule: { id, name, next_date?, amount, amount_formatted, recurrence } }`.

- [ ] **Step 1: Write failing test** — `tests/tools/create_schedule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/create_schedule.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const payees = [{ id: 'p1', name: 'Gimnasio Metropolitan' }, { id: 'p2', name: 'Netflix' }];

describe('create_schedule', () => {
  it('creates a monthly recurring schedule resolving payee by name', async () => {
    const api = mockApi({ getPayees: async () => payees });
    const r: any = await tool.handler(
      { name: 'Gimnasio', payee_name: 'gimnasio metropolitan', account_id: 'a1', amount: -35,
        recurrence: { frequency: 'monthly', start: '2026-08-01' } },
      { api, config: testConfig },
    );
    expect(api.createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Gimnasio',
      payee: 'p1',
      account: 'a1',
      amount: -3500,
      amountOp: 'is',
      posts_transaction: false,
      date: expect.objectContaining({ frequency: 'monthly', start: '2026-08-01' }),
    }));
    expect(r).toMatchObject({ created: true, schedule: { id: 'sched-id', amount: -35 } });
  });
  it('accepts a one-off date string', async () => {
    const api = mockApi({ getPayees: async () => payees });
    await tool.handler(
      { name: 'Pago único', payee_name: 'Netflix', account_id: 'a1', amount: -12.99, date: '2026-09-15' },
      { api, config: testConfig },
    );
    expect((api.createSchedule as any).mock.calls[0][0].date).toBe('2026-09-15');
  });
  it('requires exactly one of date or recurrence, and errors on unknown payee', async () => {
    const api = mockApi({ getPayees: async () => payees });
    await expect(tool.handler(
      { name: 'X', payee_name: 'Netflix', account_id: 'a1', amount: -1 },
      { api, config: testConfig },
    )).rejects.toThrow(/date|recurrence/i);
    await expect(tool.handler(
      { name: 'X', payee_name: 'NoExiste', account_id: 'a1', amount: -1, date: '2026-09-15' },
      { api, config: testConfig },
    )).rejects.toThrow(/NoExiste/);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/create_schedule.ts`:

```ts
import { z } from 'zod';
import { toCents, moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato YYYY-MM-DD');

const input = {
  name: z.string().min(1).describe('Unique display name'),
  payee_name: z.string().min(1).describe('Existing payee, matched case-insensitively'),
  account_id: z.string().min(1),
  amount: z.number().describe('Units; negative = expense'),
  date: DATE.optional().describe('One-off schedule on this date (alternative to recurrence)'),
  recurrence: z.object({
    frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    start: DATE,
    interval: z.number().int().min(1).optional().describe('Every N periods (default 1)'),
    end_date: DATE.optional(),
    end_occurrences: z.number().int().min(1).optional(),
  }).optional(),
  auto_post: z.boolean().default(false).describe('Post the transaction automatically when due'),
};
const schema = z.object(input).refine((v) => !!v.date !== !!v.recurrence, {
  message: 'Indica exactamente uno: date (puntual) o recurrence (recurrente)',
});

export const tool: ToolDef = {
  name: 'create_schedule',
  description: 'Create a recurring (or one-off) scheduled transaction in Actual. Amount in currency units. Payee resolved by name from existing payees.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const payees = await api.getPayees();
    const wanted = a.payee_name.trim().toLowerCase();
    const payee = (payees as any[]).find((p) => (p.name ?? '').trim().toLowerCase() === wanted);
    if (!payee) {
      const options = (payees as any[]).map((p) => p.name).filter((n) => (n ?? '').toLowerCase().includes(wanted.slice(0, 4))).slice(0, 5);
      throw new Error(`Pagador no encontrado: "${a.payee_name}"${options.length ? ` — ¿quizá: ${options.join(', ')}?` : ''}`);
    }

    let date: any;
    if (a.date) {
      date = a.date;
    } else {
      const r = a.recurrence!;
      date = { frequency: r.frequency, start: r.start };
      if (r.interval) date.interval = r.interval;
      if (r.end_date) { date.endMode = 'on_date'; date.endDate = r.end_date; }
      else if (r.end_occurrences) { date.endMode = 'after_n_occurrences'; date.endOccurrences = r.end_occurrences; }
      else date.endMode = 'never';
    }

    const id = await api.createSchedule({
      name: a.name,
      payee: payee.id,
      account: a.account_id,
      amount: toCents(a.amount),
      amountOp: 'is',
      posts_transaction: a.auto_post,
      date,
    });
    return {
      created: true,
      schedule: {
        id,
        name: a.name,
        ...moneyFields(toCents(a.amount), config.locale, config.currency),
        recurrence: a.date ? { one_off: a.date } : a.recurrence,
      },
    };
  },
};
```

Register in `src/tools/index.ts` (Task 4 pattern).

NOTE for implementer: the Zod `.refine` lives on the wrapping `z.object`, but `inputSchema` (raw shape) is what the SDK publishes — the refine only runs inside the handler's `schema.parse`. That is fine and matches how other tools validate.

- [ ] **Step 4: Run** — Expected: PASS (3 tests). Full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/tools/create_schedule.ts src/tools/index.ts tests/tools/create_schedule.test.ts
git commit -m "Añadir create_schedule: repetitivos con recurrencia y payee por nombre (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `set_budget` (batch)

**Files:**
- Create: `src/tools/set_budget.ts`
- Modify: `src/tools/index.ts` (Task 4 pattern)
- Test: `tests/tools/set_budget.test.ts`

**Interfaces:**
- Produces output: `{ total, success_count, failure_count, succeeded: [{month, category_id, amount, amount_formatted}], failed: [{month, category_id, error}] }`. Wrapped in `api.batchBudgetUpdates` for efficiency; per-op try/catch inside.

- [ ] **Step 1: Write failing test** — `tests/tools/set_budget.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/set_budget.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

describe('set_budget', () => {
  it('sets amounts (units→cents) and optional carryover, reporting per-op results', async () => {
    const api = mockApi();
    (api.setBudgetAmount as any) = vi.fn(async (_m: string, cat: string) => {
      if (cat === 'cBad') throw new Error('nope');
    });
    const r: any = await tool.handler(
      { operations: [
        { month: '2026-08', category_id: 'c1', amount: 350 },
        { month: '2026-08', category_id: 'cBad', amount: 100 },
        { month: '2026-08', category_id: 'c2', amount: 120.5, carryover: true },
      ] },
      { api, config: testConfig },
    );
    expect(api.batchBudgetUpdates).toHaveBeenCalledTimes(1);
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', 'c1', 35000);
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', 'c2', 12050);
    expect(api.setBudgetCarryover).toHaveBeenCalledWith('2026-08', 'c2', true);
    expect(r).toMatchObject({ total: 3, success_count: 2, failure_count: 1 });
    expect(r.failed[0]).toMatchObject({ category_id: 'cBad', error: 'nope' });
  });
  it('validates month format and op count (1-50)', async () => {
    await expect(tool.handler(
      { operations: [{ month: 'agosto', category_id: 'c1', amount: 1 }] },
      { api: mockApi(), config: testConfig },
    )).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/set_budget.ts`:

```ts
import { z } from 'zod';
import { toCents, moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes en formato YYYY-MM');

const input = {
  operations: z.array(z.object({
    month: MONTH,
    category_id: z.string().min(1),
    amount: z.number().min(0).describe('Units to budget for the category that month'),
    carryover: z.boolean().optional().describe('Enable/disable rollover of leftover balance'),
  })).min(1).max(50),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'set_budget',
  description: 'Assign budget amounts (units) to categories for given months — single cell or bulk (max 50 ops, e.g. applying a full monthly budget or copying a month). Per-operation results.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const succeeded: any[] = [];
    const failed: any[] = [];
    await api.batchBudgetUpdates(async () => {
      for (const op of a.operations) {
        try {
          const cents = toCents(op.amount);
          await api.setBudgetAmount(op.month, op.category_id, cents);
          if (op.carryover !== undefined) await api.setBudgetCarryover(op.month, op.category_id, op.carryover);
          succeeded.push({ month: op.month, category_id: op.category_id, ...moneyFields(cents, config.locale, config.currency) });
        } catch (err) {
          failed.push({ month: op.month, category_id: op.category_id, error: (err as Error).message ?? String(err) });
        }
      }
    });
    return { total: a.operations.length, success_count: succeeded.length, failure_count: failed.length, succeeded, failed };
  },
};
```

Register in `src/tools/index.ts` (Task 4 pattern).

- [ ] **Step 4: Run** — Expected: PASS (2 tests). Full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/tools/set_budget.ts src/tools/index.ts tests/tools/set_budget.test.ts
git commit -m "Añadir set_budget: asignación de presupuesto en lote con resultado por operación (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: `transfer_budget`

**Files:**
- Create: `src/tools/transfer_budget.ts`
- Modify: `src/tools/index.ts` (Task 4 pattern)
- Test: `tests/tools/transfer_budget.test.ts`

**Interfaces:**
- Produces output: `{ transferred: {amount, amount_formatted}, month, from: {category_id, name, budgeted}, to: {category_id, name, budgeted} }` where each `budgeted` is the NEW moneyFields value. Reads current budgeted via `api.getBudgetMonth(month)`; errors if either category id is not found in that month.

- [ ] **Step 1: Write failing test** — `tests/tools/transfer_budget.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/transfer_budget.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const month = {
  month: '2026-08',
  categoryGroups: [{ id: 'g1', name: 'Gastos', is_income: false, categories: [
    { id: 'c1', name: 'Alimentacion', budgeted: 35000 },
    { id: 'c2', name: 'Ocio', budgeted: 5000 },
  ] }],
};

describe('transfer_budget', () => {
  it('moves budget between categories and echoes new values', async () => {
    const api = mockApi({ getBudgetMonth: async () => month });
    const r: any = await tool.handler(
      { month: '2026-08', from_category_id: 'c1', to_category_id: 'c2', amount: 50 },
      { api, config: testConfig },
    );
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', 'c1', 30000);
    expect(api.setBudgetAmount).toHaveBeenCalledWith('2026-08', 'c2', 10000);
    expect(r.from.budgeted.amount).toBe(300);
    expect(r.to.budgeted.amount).toBe(100);
    expect(r.transferred.amount).toBe(50);
  });
  it('rejects non-positive amounts and unknown categories', async () => {
    const api = mockApi({ getBudgetMonth: async () => month });
    await expect(tool.handler(
      { month: '2026-08', from_category_id: 'c1', to_category_id: 'c2', amount: 0 },
      { api, config: testConfig },
    )).rejects.toThrow();
    await expect(tool.handler(
      { month: '2026-08', from_category_id: 'cX', to_category_id: 'c2', amount: 10 },
      { api, config: testConfig },
    )).rejects.toThrow(/cX/);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/transfer_budget.ts`:

```ts
import { z } from 'zod';
import { toCents, moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes en formato YYYY-MM');

const input = {
  month: MONTH,
  from_category_id: z.string().min(1),
  to_category_id: z.string().min(1),
  amount: z.number().positive().describe('Units to move'),
};
const schema = z.object(input).refine((v) => v.from_category_id !== v.to_category_id, {
  message: 'Las categorías de origen y destino deben ser distintas',
});

export const tool: ToolDef = {
  name: 'transfer_budget',
  description: 'Move budgeted money between two categories within a month. Returns both cells with their new budgeted values.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const cents = toCents(a.amount);
    const m = await api.getBudgetMonth(a.month);
    const cats = new Map<string, any>();
    for (const g of m.categoryGroups ?? []) for (const c of g.categories ?? []) cats.set(c.id, c);
    const from = cats.get(a.from_category_id);
    const to = cats.get(a.to_category_id);
    if (!from) throw new Error(`Categoría origen no encontrada en ${a.month}: ${a.from_category_id}`);
    if (!to) throw new Error(`Categoría destino no encontrada en ${a.month}: ${a.to_category_id}`);

    const newFrom = (from.budgeted ?? 0) - cents;
    const newTo = (to.budgeted ?? 0) + cents;
    await api.setBudgetAmount(a.month, a.from_category_id, newFrom);
    await api.setBudgetAmount(a.month, a.to_category_id, newTo);

    const fmt = (c: number) => moneyFields(c, config.locale, config.currency);
    return {
      transferred: fmt(cents),
      month: a.month,
      from: { category_id: from.id, name: from.name, budgeted: fmt(newFrom) },
      to: { category_id: to.id, name: to.name, budgeted: fmt(newTo) },
    };
  },
};
```

Register in `src/tools/index.ts` (Task 4 pattern).

- [ ] **Step 4: Run** — Expected: PASS (2 tests). Full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/tools/transfer_budget.ts src/tools/index.ts tests/tools/transfer_budget.test.ts
git commit -m "Añadir transfer_budget: mover presupuesto entre categorías con echo de celdas (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: `update_category_note`

**Files:**
- Create: `src/tools/update_category_note.ts`
- Modify: `src/tools/index.ts` (Task 4 pattern)
- Test: `tests/tools/update_category_note.test.ts`

**Interfaces:**
- Produces output: `{ updated: true, category_id, category_name, note }` — note echoed via `api.getNote` AFTER writing (real state, not input echo). Validates the category id against `api.getCategoryGroups()`.

- [ ] **Step 1: Write failing test** — `tests/tools/update_category_note.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/update_category_note.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const groups = [{ id: 'g1', name: 'Comida', is_income: false, categories: [{ id: 'c1', name: 'Alimentacion', hidden: false }] }];

describe('update_category_note', () => {
  it('writes the note and echoes the stored value', async () => {
    const api = mockApi({
      getCategoryGroups: async () => groups,
      getNote: async () => '#template 350',
    });
    const r: any = await tool.handler({ category_id: 'c1', note: '#template 350' }, { api, config: testConfig });
    expect(api.updateNote).toHaveBeenCalledWith('c1', '#template 350');
    expect(r).toMatchObject({ updated: true, category_id: 'c1', category_name: 'Alimentacion', note: '#template 350' });
  });
  it('rejects unknown category ids', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ category_id: 'cX', note: 'x' }, { api, config: testConfig }))
      .rejects.toThrow(/cX/);
    expect(api.updateNote).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/update_category_note.ts`:

```ts
import { z } from 'zod';
import type { ToolDef } from '../core/types.js';

const input = {
  category_id: z.string().min(1).describe('Category UUID (from get_categories)'),
  note: z.string().max(2000).describe('Note text; supports Actual goal templates like "#template 350"'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'update_category_note',
  description: 'Write the note of a category (used by Actual for goal templates, e.g. "#template 350"). Returns the stored note.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api }) => {
    const a = schema.parse(raw ?? {});
    const groups = await api.getCategoryGroups();
    let name: string | null = null;
    for (const g of groups) for (const c of g.categories ?? []) if (c.id === a.category_id) name = c.name;
    if (!name) throw new Error(`Categoría no encontrada: ${a.category_id} (usa get_categories para ver los ids)`);
    await api.updateNote(a.category_id, a.note);
    const stored = await api.getNote(a.category_id);
    return { updated: true, category_id: a.category_id, category_name: name, note: stored ?? a.note };
  },
};
```

Register in `src/tools/index.ts` (Task 4 pattern).

- [ ] **Step 4: Run** — Expected: PASS (2 tests). Full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/tools/update_category_note.ts src/tools/index.ts tests/tools/update_category_note.test.ts
git commit -m "Añadir update_category_note: notas y plantillas de objetivos (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Catalog gate, docs and close

**Files:**
- Modify: `tests/core/tool-registry.test.ts`, `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-07-21-actual-mcp-v2-design.md`
- Test: full suite

- [ ] **Step 1: Replace the Plan-1 catalog test** in `tests/core/tool-registry.test.ts` — the `catalog (plan 1)` describe becomes:

```ts
describe('catalog (plan 2)', () => {
  it('ships 8 read + 8 write tools, write-gated', () => {
    expect(allTools).toHaveLength(16);
    expect(allTools.filter((t) => t.readOnly)).toHaveLength(8);
    expect(collectTools(allTools, false)).toHaveLength(8);
    expect(collectTools(allTools, true)).toHaveLength(16);
    expect(collectTools(allTools, false).every((t) => t.readOnly)).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npm test` — Expected: ALL pass. Run `npm run build` — exit 0.

- [ ] **Step 3: Docs**

- `README.md`: add a "Herramientas de escritura" section after the read-tools table: list the 8 write tools with one-line descriptions, and a warning block: write tools require `ENABLE_WRITE=true` in the env of `claude_desktop_config.json`; amounts are given in units; `split_transaction` replaces the transaction (new id).
- `docs/superpowers/specs/2026-07-21-actual-mcp-v2-design.md`: in the `split_transaction` note, replace the sentence "Implemented with the official `subtransactions` API." with: "Implemented as safe replace via the official `subtransactions` create API (`addTransactions`), since the update API does not accept subtransactions: create the split copy first, then delete the original — a mid-failure can only leave a visible duplicate, never lose data. The split transaction gets a new id."
- `CLAUDE.md` "Estado y próximos pasos": Plan 2 completado — 16 tools (8+8), escritura tras ENABLE_WRITE; siguiente: activar ENABLE_WRITE en Claude Desktop tras la prueba manual, retirar `actual-budget-test`, y decidir publicación en GitHub (README bilingüe).

- [ ] **Step 4: Full gate**

```bash
npm test && npm run build
```

Manual verification (Marco, post-merge, NOT executed by the implementer): set `ENABLE_WRITE=true` in Claude Desktop, restart, and exercise: categorize an uncategorized transaction, split a real supermarket ticket, `set_budget` from `get_budget_averages`, create a schedule — checking each result in the Actual UI.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Cerrar Plan 2: catálogo 8+8 con gating, docs y spec de split actualizado

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
