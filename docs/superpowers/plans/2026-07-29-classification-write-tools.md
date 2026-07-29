# Classification Write Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 13 tools that reshape the classification surface of an Actual budget — category groups, categories, transfer payees and rules — plus two new inputs on `update_transaction`, taking the catalogue from 16 to 29 tools.

**Architecture:** Every tool follows the shape already established in `src/tools/`: one file per tool exporting a `ToolDef`, Zod input schema built at module load with deferred i18n messages, UUID validation on every id, amounts crossing the boundary in currency units, and an echo of the affected object so calls chain. Three new `src/core/` modules carry the shared work: `write-sync.ts` (post-write `api.sync()`), `taxonomy.ts` (group index + transaction counting for the delete guards) and `payees.ts` (payee index by id and by transfer account). Rules get their own schema module, `src/core/rule-schema.ts`, because the shape is large and needs unit↔cent conversion in both directions.

**Tech Stack:** TypeScript 6.x (ESM, `.js` import specifiers), Zod 4, `@actual-app/api` 26.7, Vitest with a mocked API, MCP SDK 1.29.

## Global Constraints

- **Language.** Code, comments in new `src/` files, tool `title`/`description`, and this plan are in **English**. Runtime user-facing messages live in `src/core/messages.ts` in **both** `es` and `en`. The repo is public.
- **Gating.** Mutations declare `readOnly: false` and are registered only when `ENABLE_WRITE` is on. The three new reads (`get_payees`, `get_account_transfer_payee`, `get_rules`) declare `readOnly: true`.
- **Tool names** match `^[a-zA-Z0-9_-]{1,64}$` (enforced by `collectTools`). Reads use the repo's `get_*` convention, never `list_*`.
- **Ids** validate with `ID` from `src/core/types.ts` (strict UUID). This is not cosmetic: the AQL compiler interpolates `id`-typed values into SQL unescaped.
- **Money** crosses the boundary in currency units and converts only through `src/core/money.ts` (`toCents`/`toUnits`/`moneyFields`). Never hand cents to the model, never let the model do the division.
- **Messages.** Every user-facing error string is a key in `src/core/messages.ts` with an `es` and an `en` variant. `es` is the reference type; `const en: Messages` makes the compiler demand every key with the same arity. Never inline a literal in a tool.
- **Deferred schema messages.** Any `.regex()`, `.uuid()`, `.refine()` or `.enum()` message is written as `{ error: () => activeMessages().someKey }`. A static detector in `tests/core/messages.test.ts` fails the build otherwise.
- **`manifest.json` ↔ code.** `tests/bundle/manifest.test.ts` asserts that the manifest advertises **exactly** the registered tools. Any task that adds a tool to `src/tools/index.ts` must add it to `manifest.json` **in the same commit**, or the suite goes red.
- **Version bump** `2.1.0` → `2.2.0` in `package.json` **and** `manifest.json`, in lock-step, once, in the final task.
- **TDD.** Test first, watch it fail, then implement. Commit at the end of every task.
- **Existing write tools are not retrofitted.** The 8 shipped write tools keep their current behaviour (no post-write sync). Only new tools adopt `syncAfterWrite`.

## Verified API facts (read from `@actual-app/core` 26.7 source, not assumed)

These were confirmed by reading the installed dependency's source. They shape the code below; the empirical tasks confirm them at runtime.

| Fact | Evidence |
|---|---|
| `api.updateTransaction(id, { payee })` where the payee is a transfer payee **does auto-create and link the counterpart leg**. `batchUpdateTransactions` defaults `runTransfers = true`, and `api/transaction-update` does not override it; `transfer.onUpdate` then calls `addTransfer`, which inserts the opposite-signed row and cross-links `transfer_id` on both. | `server/transactions/index.ts:46` (default), `server/api.ts:574`, `server/transactions/transfer.ts:154` |
| Creating a transfer **clears the category on both legs** when both accounts are on-budget or both are off-budget. | `server/transactions/transfer.ts:24` (`clearCategory`) |
| Re-pointing an existing transfer to another account **moves the existing counterpart**, it does not create a second one. | `transfer.ts:120` (`updateTransfer`) |
| A **split parent cannot become a transfer**: `addTransfer` returns `null` for `is_parent`, and `onUpdate` calls `removeTransfer` instead. | `transfer.ts:47`, `transfer.ts:154` |
| `deleteCategoryGroup(id, transferCategoryId?)` **deletes every child category**, and with a transfer target first moves their budget amounts and remaps their transactions. Without a target, transactions keep pointing at deleted categories. | `server/budget/app.ts:461`, `server/db/index.ts:426` |
| Actual **does not expose** its own `isCategoryTransferRequired` check through the public API. The "this category has transactions" guard has to be computed by us with AQL. | `server/budget/app.ts:484` is registered as `must-category-transfer`, absent from `@actual-app/api` `methods.d.ts` |
| **`api.updateCategory` and `api.updateCategoryGroup` do NOT merge with the stored record.** `fields` is passed straight through, and the layer below dereferences `name` (`category.name.trim()`, `group.name.toUpperCase()`). Sending only `{ hidden: true }` throws a `TypeError`. **Both update tools must read the current record and send a merged object.** | `server/api.ts:713` and `:680` (no merge), `server/budget/app.ts:332` and `server/db/index.ts:391` (dereference) |
| Rule condition fields are exactly `account, amount, category, category_group, date, notes, payee, imported_payee, saved, cleared, reconciled, transfer`. `payee_name` and `parent` appear in `FieldValueTypes` but **not** in the condition union. | `core/@types/src/types/models/rule.d.ts` |
| `oneOf`/`notOneOf` take an **array** value; `isbetween` takes `{ num1, num2 }`. | same file, `BaseConditionEntity` |

## File Structure

**New core modules**

| File | Responsibility |
|---|---|
| `src/core/write-sync.ts` | `syncAfterWrite(api)` — pushes the write to the server, never throws. |
| `src/core/taxonomy.ts` | Category-group index and the AQL transaction count behind the delete guards. |
| `src/core/payees.ts` | Payee index by id and by `transfer_acct`. |
| `src/core/rule-schema.ts` | Zod shape for a rule + `ruleToApi` / `ruleFromApi` (unit↔cent). |

**New tools** — `src/tools/<name>.ts`, one per tool, each with `tests/tools/<name>.test.ts`:
`create_category_group`, `update_category_group`, `delete_category_group`, `create_category`, `update_category`, `delete_category`, `get_payees`, `get_account_transfer_payee`, `set_transaction_transfer`, `get_rules`, `create_rule`, `update_rule`, `delete_rule`.

**Modified:** `src/core/messages.ts` (new keys, both languages), `src/tools/index.ts` (registration), `src/tools/update_transaction.ts` (two new inputs), `tests/helpers/mock-api.ts` (new API methods), `tests/core/messages.test.ts` (detector covers `src/core/rule-schema.ts`), `manifest.json`, `package.json`, `README.md`, `README.es.md`.

---

## Phase 1 — Taxonomy

### Task 1: `syncAfterWrite` helper

Every new mutation pushes its write to the server before returning. It must not turn a successful local write into a reported failure when the network hiccups, so it reports instead of throwing — the same honesty the repo already applies with `echo_pending`.

**Files:**
- Create: `src/core/write-sync.ts`
- Create: `tests/core/write-sync.test.ts`
- Modify: `src/core/messages.ts` (add `syncPending`)
- Modify: `tests/helpers/mock-api.ts` (add `sync`)

**Interfaces:**
- Produces: `syncAfterWrite(api: any): Promise<{ synced: boolean; error?: string }>` — every later mutation task calls this after its write and spreads `...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) })` into its result.
- Produces: message key `syncPending(cause: string)`.

- [ ] **Step 1: Add the message key to both catalogues**

In `src/core/messages.ts`, inside the `const es = {` block, in the "Guardas de estado y consistencia de escritura" section, after `unconfirmedWrites`:

```ts
  syncPending: (cause: string) =>
    `El cambio se guardó en la copia local pero no se pudo sincronizar con el servidor (${cause}); ` +
    'se reintentará en la siguiente consulta. Si el error persiste, revisa la conexión con Actual',
```

And the matching entry in `const en: Messages = {`, same position:

```ts
  syncPending: (cause: string) =>
    `The change was saved to the local copy but could not be synced to the server (${cause}); ` +
    'it will be retried on the next query. If the error persists, check the connection to Actual',
```

- [ ] **Step 2: Add `sync` to the mock API**

In `tests/helpers/mock-api.ts`, inside the object returned by `mockApi`, after `updateNote`:

```ts
    sync: vi.fn(async () => undefined),
```

- [ ] **Step 3: Write the failing test**

Create `tests/core/write-sync.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { syncAfterWrite } from '../../src/core/write-sync.js';
import { mockApi } from '../helpers/mock-api.js';

describe('syncAfterWrite', () => {
  it('syncs and reports success', async () => {
    const api = mockApi();
    const r = await syncAfterWrite(api);
    expect(api.sync).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ synced: true });
  });

  it('reports the failure instead of throwing — the write already landed locally', async () => {
    const api = mockApi({ sync: async () => { throw new Error('offline'); } });
    const r = await syncAfterWrite(api);
    expect(r.synced).toBe(false);
    expect(r.error).toContain('offline');
  });

  it('survives a non-Error rejection', async () => {
    const api = mockApi({ sync: async () => { throw 'plain string'; } });
    const r = await syncAfterWrite(api);
    expect(r.synced).toBe(false);
    expect(typeof r.error).toBe('string');
  });
});
```

- [ ] **Step 4: Run the test and confirm it fails**

Run: `npx vitest run tests/core/write-sync.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/write-sync.js"`.

- [ ] **Step 5: Implement**

Create `src/core/write-sync.ts`:

```ts
// write-sync.ts — post-write sync for the classification tools.
//
// The eight write tools shipped before this rely on the local read-back probe
// and on the next ensureReady() sync. The tools added on top of them push the
// change themselves, so a caller that writes and immediately asks another
// client to read sees it.
//
// It never throws: the write has already landed in the local copy by the time
// this runs, so a failed sync is a delay, not a failed write. Reporting it as
// an exception would tell the user their change was lost when it was not.

export async function syncAfterWrite(api: any): Promise<{ synced: boolean; error?: string }> {
  try {
    await api.sync();
    return { synced: true };
  } catch (err) {
    return { synced: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `npx vitest run tests/core/write-sync.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS — 227 existing + 3 new = 230.

- [ ] **Step 8: Commit**

```bash
git add src/core/write-sync.ts tests/core/write-sync.test.ts src/core/messages.ts tests/helpers/mock-api.ts
git commit -m "feat(core): syncAfterWrite pushes a write without failing it on sync errors"
```

---

### Task 2: Category-group index and the delete-guard counter

**Files:**
- Create: `src/core/taxonomy.ts`
- Create: `tests/core/taxonomy.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface GroupInfo { id: string; name: string; is_income: boolean; hidden: boolean; categoryIds: string[] }`
  - `getGroupIndex(api: any): Promise<Map<string, GroupInfo>>`
  - `countTransactionsForCategories(api: any, categoryIds: string[]): Promise<number>`

Tasks 3–6 use both. `getCategoryIndex` from `src/core/categories.ts` already exists and is reused unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/core/taxonomy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getGroupIndex, countTransactionsForCategories } from '../../src/core/taxonomy.js';
import { mockApi } from '../helpers/mock-api.js';

const G1 = '11111111-1111-4111-8111-111111111111';
const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';

const groups = [
  { id: G1, name: 'Housing', is_income: false, hidden: false, categories: [
    { id: C1, name: 'Rent', hidden: false },
    { id: C2, name: 'Utilities', hidden: true },
  ] },
];

describe('getGroupIndex', () => {
  it('indexes groups by id with their child category ids', async () => {
    const idx = await getGroupIndex(mockApi({ getCategoryGroups: async () => groups }));
    expect(idx.get(G1)).toEqual({
      id: G1, name: 'Housing', is_income: false, hidden: false, categoryIds: [C1, C2],
    });
  });

  it('tolerates a group with no categories array', async () => {
    const api = mockApi({ getCategoryGroups: async () => [{ id: G1, name: 'Empty' }] });
    const idx = await getGroupIndex(api);
    expect(idx.get(G1)!.categoryIds).toEqual([]);
    expect(idx.get(G1)!.is_income).toBe(false);
    expect(idx.get(G1)!.hidden).toBe(false);
  });
});

describe('countTransactionsForCategories', () => {
  it('counts through a single AQL query including split children', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }) });
    const n = await countTransactionsForCategories(api, [C1, C2]);
    expect(n).toBe(3);
    const q = api.q.mock.results[0].value;
    expect(q.table).toBe('transactions');
    expect(q.calls.filter[0]).toEqual({ category: { $oneof: [C1, C2] } });
    // Split children carry their own category: 'grouped' would hide them behind the parent.
    expect(q.calls.options[0]).toEqual({ splits: 'all' });
  });

  it('does not query at all for an empty id list', async () => {
    const api = mockApi();
    expect(await countTransactionsForCategories(api, [])).toBe(0);
    expect(api.runQuery).not.toHaveBeenCalled();
  });

  it('treats a null data set as zero', async () => {
    const api = mockApi({ runQuery: async () => ({ data: null }) });
    expect(await countTransactionsForCategories(api, [C1])).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/core/taxonomy.test.ts`
Expected: FAIL — cannot resolve `../../src/core/taxonomy.js`.

- [ ] **Step 3: Implement**

Create `src/core/taxonomy.ts`:

```ts
// taxonomy.ts — category groups, and the counter behind the delete guards.
//
// Actual has its own "must this category be transferred before deleting?" check
// (must-category-transfer) but it is not exposed through @actual-app/api, so the
// guard is computed here. Deleting a category without a destination leaves its
// transactions pointing at a deleted row, which reads as uncategorized money.

export interface GroupInfo {
  id: string;
  name: string;
  is_income: boolean;
  hidden: boolean;
  categoryIds: string[];
}

/** Indexes api.getCategoryGroups() by group id. */
export async function getGroupIndex(api: any): Promise<Map<string, GroupInfo>> {
  const groups = await api.getCategoryGroups();
  const idx = new Map<string, GroupInfo>();
  for (const g of groups ?? []) {
    idx.set(g.id, {
      id: g.id,
      name: g.name,
      is_income: !!g.is_income,
      hidden: !!g.hidden,
      categoryIds: (g.categories ?? []).map((c: any) => c.id),
    });
  }
  return idx;
}

/** How many transactions reference any of these categories. */
export async function countTransactionsForCategories(api: any, categoryIds: string[]): Promise<number> {
  if (categoryIds.length === 0) return 0;
  const { data } = await api.runQuery(
    api.q('transactions')
      .filter({ category: { $oneof: categoryIds } })
      // 'all' and not 'grouped': the category of a split lives on its children,
      // and grouped rolls them up into the parent, which has no category.
      .options({ splits: 'all' })
      .select(['id']),
  );
  return (data as any[] | null)?.length ?? 0;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/core/taxonomy.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — 235.

- [ ] **Step 6: Commit**

```bash
git add src/core/taxonomy.ts tests/core/taxonomy.test.ts
git commit -m "feat(core): category-group index and transaction counter for delete guards"
```

---

### Task 3: `create_category_group` and `update_category_group`

Two tools, one commit: they share the messages and the group index, and a reviewer would accept or reject them together.

**Files:**
- Create: `src/tools/create_category_group.ts`, `src/tools/update_category_group.ts`
- Create: `tests/tools/create_category_group.test.ts`, `tests/tools/update_category_group.test.ts`
- Modify: `src/core/messages.ts`, `src/tools/index.ts`, `tests/helpers/mock-api.ts`, `manifest.json`

**Interfaces:**
- Consumes: `syncAfterWrite` (Task 1), `getGroupIndex` (Task 2).
- Produces: message keys `categoryGroupNotFound(id)`, `noGroupFieldToUpdate`; tools named `create_category_group` and `update_category_group`.

- [ ] **Step 1: Add the message keys**

In `src/core/messages.ts`, `const es`, in the "No encontrado" section right after `categoryNotFound`:

```ts
  categoryGroupNotFound: (id: string) => `grupo de categorías inexistente: ${id} (usa get_categories para ver los ids válidos)`,
```

and in the "Formato y validación de entrada" section right after `noFieldToUpdate`:

```ts
  noGroupFieldToUpdate: 'Debes indicar al menos un campo a actualizar (name, hidden)',
```

In `const en: Messages`, same positions:

```ts
  categoryGroupNotFound: (id: string) => `unknown category group: ${id} (use get_categories to list valid ids)`,
```

```ts
  noGroupFieldToUpdate: 'You must specify at least one field to update (name, hidden)',
```

- [ ] **Step 2: Add the API methods to the mock**

In `tests/helpers/mock-api.ts`, after `sync`:

```ts
    createCategoryGroup: vi.fn(async () => 'new-group-id'),
    updateCategoryGroup: vi.fn(async () => undefined),
```

- [ ] **Step 3: Write the failing tests**

Create `tests/tools/create_category_group.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/create_category_group.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const NEW = '44444444-4444-4444-8444-444444444444';

describe('create_category_group', () => {
  it('creates the group and echoes it', async () => {
    const api = mockApi({ createCategoryGroup: async () => NEW });
    const r: any = await tool.handler({ name: 'Savings & Investment' }, { api, config: testConfig });
    expect(api.createCategoryGroup).toHaveBeenCalledWith({ name: 'Savings & Investment', is_income: false });
    expect(r).toEqual({ created: true, group: { id: NEW, name: 'Savings & Investment', is_income: false } });
  });

  it('passes is_income through', async () => {
    const api = mockApi({ createCategoryGroup: async () => NEW });
    const r: any = await tool.handler({ name: 'Salary', is_income: true }, { api, config: testConfig });
    expect(api.createCategoryGroup).toHaveBeenCalledWith({ name: 'Salary', is_income: true });
    expect(r.group.is_income).toBe(true);
  });

  it('syncs after writing', async () => {
    const api = mockApi({ createCategoryGroup: async () => NEW });
    await tool.handler({ name: 'X' }, { api, config: testConfig });
    expect(api.sync).toHaveBeenCalledTimes(1);
  });

  it('reports a failed sync without failing the creation', async () => {
    const api = mockApi({
      createCategoryGroup: async () => NEW,
      sync: async () => { throw new Error('offline'); },
    });
    const r: any = await tool.handler({ name: 'X' }, { api, config: testConfig });
    expect(r.created).toBe(true);
    expect(r.sync_pending).toBe(true);
    expect(r.note).toContain('offline');
  });

  it('rejects an empty name before touching the API', async () => {
    const api = mockApi();
    await expect(tool.handler({ name: '' }, { api, config: testConfig })).rejects.toThrow();
    expect(api.createCategoryGroup).not.toHaveBeenCalled();
  });

  it('is a write tool', () => {
    expect(tool.readOnly).toBe(false);
  });
});
```

Create `tests/tools/update_category_group.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/update_category_group.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const G1 = '11111111-1111-4111-8111-111111111111';
const GX = '99999999-9999-4999-8999-999999999999';
const groups = [{ id: G1, name: 'Housing', is_income: false, hidden: false, categories: [] }];

describe('update_category_group', () => {
  it('renames the group', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    const r: any = await tool.handler({ id: G1, name: 'Home' }, { api, config: testConfig });
    expect(api.updateCategoryGroup).toHaveBeenCalledWith(G1, { name: 'Home', is_income: false, hidden: false });
    expect(r).toMatchObject({ updated: true, group: { id: G1, name: 'Home', hidden: false } });
  });

  it('sends the stored name when only hidden changes — a partial update crashes Actual', async () => {
    // api/category-group-update passes fields straight through and the layer below
    // does group.name.toUpperCase(): omitting name is a TypeError, not a no-op.
    const api = mockApi({ getCategoryGroups: async () => groups });
    await tool.handler({ id: G1, hidden: true }, { api, config: testConfig });
    expect(api.updateCategoryGroup).toHaveBeenCalledWith(G1, { name: 'Housing', is_income: false, hidden: true });
  });

  it('rejects an unknown group id before writing', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ id: GX, name: 'x' }, { api, config: testConfig })).rejects.toThrow(GX);
    expect(api.updateCategoryGroup).not.toHaveBeenCalled();
  });

  it('demands at least one field to change', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ id: G1 }, { api, config: testConfig })).rejects.toThrow(/name, hidden/);
    expect(api.updateCategoryGroup).not.toHaveBeenCalled();
  });

  it('syncs after writing', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await tool.handler({ id: G1, name: 'Home' }, { api, config: testConfig });
    expect(api.sync).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npx vitest run tests/tools/create_category_group.test.ts tests/tools/update_category_group.test.ts`
Expected: FAIL — both source modules unresolved.

- [ ] **Step 5: Implement `create_category_group`**

Create `src/tools/create_category_group.ts`:

```ts
import { z } from 'zod';
import { syncAfterWrite } from '../core/write-sync.js';
import type { ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  name: z.string().min(1).max(100).describe('Group name, e.g. "Savings & Investment"'),
  is_income: z.boolean().default(false).describe('Income group (holds income categories) instead of a spending group'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'create_category_group',
  title: 'Create category group',
  description: 'Create a new category group (the top-level buckets that hold categories). Returns the created group with its id, ready to pass to create_category.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    const id = await api.createCategoryGroup({ name: a.name, is_income: a.is_income });
    const sync = await syncAfterWrite(api);
    return {
      created: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      group: { id, name: a.name, is_income: a.is_income },
    };
  },
};
```

- [ ] **Step 6: Implement `update_category_group`**

Create `src/tools/update_category_group.ts`:

```ts
import { z } from 'zod';
import { getGroupIndex } from '../core/taxonomy.js';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  id: ID.describe('Category group UUID (from get_categories)'),
  name: z.string().min(1).max(100).optional().describe('New name'),
  hidden: z.boolean().optional().describe('true archives the group and its categories without deleting anything'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'update_category_group',
  title: 'Update category group',
  description: 'Rename a category group or archive it (hidden: true). Archiving is the non-destructive alternative to delete_category_group: nothing is lost and past transactions keep their categories.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    if (a.name === undefined && a.hidden === undefined) throw new Error(m.noGroupFieldToUpdate);
    const group = (await getGroupIndex(api)).get(a.id);
    if (!group) throw new Error(m.categoryGroupNotFound(a.id));
    // Actual does NOT merge: api/category-group-update forwards `fields` as-is and
    // the layer below reads group.name.toUpperCase(). Sending only { hidden } throws.
    const fields = {
      name: a.name ?? group.name,
      is_income: group.is_income,
      hidden: a.hidden ?? group.hidden,
    };
    await api.updateCategoryGroup(a.id, fields);
    const sync = await syncAfterWrite(api);
    return {
      updated: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      group: { id: a.id, name: fields.name, is_income: fields.is_income, hidden: fields.hidden },
    };
  },
};
```

- [ ] **Step 7: Register both tools**

In `src/tools/index.ts`, add the imports after `updateCategoryNote`:

```ts
import { tool as createCategoryGroup } from './create_category_group.js';
import { tool as updateCategoryGroup } from './update_category_group.js';
```

and append them to the exported array:

```ts
export const allTools: ToolDef[] = [getAccounts, getNetWorth, getCategories, getTransactions, getSpendingSummary, getBudgetMonth, getBudgetAverages, getSchedules, updateTransaction, categorizeTransactions, splitTransaction, createTransaction, createSchedule, setBudget, transferBudget, updateCategoryNote, createCategoryGroup, updateCategoryGroup];
```

- [ ] **Step 8: Declare both tools in the manifest**

In `manifest.json`, append to the `tools` array:

```json
    { "name": "create_category_group", "description": "Create a category group" },
    { "name": "update_category_group", "description": "Rename or archive a category group" }
```

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS — 246. In particular `manifest ↔ code consistency` stays green, which proves the manifest and `allTools` agree.

- [ ] **Step 10: Type-check and build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 11: Commit**

```bash
git add src/tools/create_category_group.ts src/tools/update_category_group.ts tests/tools/create_category_group.test.ts tests/tools/update_category_group.test.ts src/core/messages.ts src/tools/index.ts tests/helpers/mock-api.ts manifest.json
git commit -m "feat(tools): create_category_group and update_category_group"
```

---

### Task 4: `create_category` and `update_category`

**Files:**
- Create: `src/tools/create_category.ts`, `src/tools/update_category.ts`
- Create: `tests/tools/create_category.test.ts`, `tests/tools/update_category.test.ts`
- Modify: `src/core/messages.ts`, `src/tools/index.ts`, `tests/helpers/mock-api.ts`, `manifest.json`

**Interfaces:**
- Consumes: `syncAfterWrite`, `getGroupIndex`, and `getCategoryIndex` from `src/core/categories.ts` (existing: returns `Map<string, { id, name, group, is_income }>`).
- Produces: message key `noCategoryFieldToUpdate`; tools `create_category`, `update_category`.

- [ ] **Step 1: Add the message key**

In `src/core/messages.ts`, `const es`, right after `noGroupFieldToUpdate`:

```ts
  noCategoryFieldToUpdate: 'Debes indicar al menos un campo a actualizar (name, group_id, hidden)',
```

and in `const en: Messages`:

```ts
  noCategoryFieldToUpdate: 'You must specify at least one field to update (name, group_id, hidden)',
```

- [ ] **Step 2: Add the API methods to the mock**

In `tests/helpers/mock-api.ts`, after `updateCategoryGroup`:

```ts
    createCategory: vi.fn(async () => 'new-category-id'),
    updateCategory: vi.fn(async () => undefined),
```

- [ ] **Step 3: Write the failing tests**

Create `tests/tools/create_category.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/create_category.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const G1 = '11111111-1111-4111-8111-111111111111';
const GX = '99999999-9999-4999-8999-999999999999';
const NEW = '55555555-5555-4555-8555-555555555555';
const groups = [{ id: G1, name: 'Taxes', is_income: false, hidden: false, categories: [] }];

describe('create_category', () => {
  it('creates the category inside an existing group', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, createCategory: async () => NEW });
    const r: any = await tool.handler({ name: 'VAT', group_id: G1 }, { api, config: testConfig });
    expect(api.createCategory).toHaveBeenCalledWith({ name: 'VAT', group_id: G1, is_income: false });
    expect(r).toMatchObject({ created: true, category: { id: NEW, name: 'VAT', group_id: G1 } });
  });

  it('refuses an unknown group id before writing', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ name: 'VAT', group_id: GX }, { api, config: testConfig })).rejects.toThrow(GX);
    expect(api.createCategory).not.toHaveBeenCalled();
  });

  it('syncs after writing', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, createCategory: async () => NEW });
    await tool.handler({ name: 'VAT', group_id: G1 }, { api, config: testConfig });
    expect(api.sync).toHaveBeenCalledTimes(1);
  });
});
```

Create `tests/tools/update_category.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/update_category.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '66666666-6666-4666-8666-666666666666';
const GX = '99999999-9999-4999-8999-999999999999';
const C1 = '22222222-2222-4222-8222-222222222222';
const CX = '88888888-8888-4888-8888-888888888888';

const groups = [
  { id: G1, name: 'Housing', is_income: false, hidden: false, categories: [{ id: C1, name: 'Rent', hidden: false, is_income: false }] },
  { id: G2, name: 'Savings', is_income: false, hidden: false, categories: [] },
];

describe('update_category', () => {
  it('renames the category, keeping its group', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    const r: any = await tool.handler({ id: C1, name: 'Mortgage' }, { api, config: testConfig });
    expect(api.updateCategory).toHaveBeenCalledWith(C1, { name: 'Mortgage', group_id: G1, is_income: false, hidden: false });
    expect(r).toMatchObject({ updated: true, category: { id: C1, name: 'Mortgage', group_id: G1 } });
  });

  it('moves the category to another group', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    const r: any = await tool.handler({ id: C1, group_id: G2 }, { api, config: testConfig });
    expect(api.updateCategory).toHaveBeenCalledWith(C1, { name: 'Rent', group_id: G2, is_income: false, hidden: false });
    expect(r.category.group_id).toBe(G2);
  });

  it('sends the stored name when only hidden changes — a partial update crashes Actual', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await tool.handler({ id: C1, hidden: true }, { api, config: testConfig });
    expect(api.updateCategory).toHaveBeenCalledWith(C1, { name: 'Rent', group_id: G1, is_income: false, hidden: true });
  });

  it('rejects an unknown category id', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ id: CX, name: 'x' }, { api, config: testConfig })).rejects.toThrow(CX);
    expect(api.updateCategory).not.toHaveBeenCalled();
  });

  it('rejects a move into an unknown group', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ id: C1, group_id: GX }, { api, config: testConfig })).rejects.toThrow(GX);
    expect(api.updateCategory).not.toHaveBeenCalled();
  });

  it('demands at least one field to change', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    await expect(tool.handler({ id: C1 }, { api, config: testConfig })).rejects.toThrow(/group_id/);
  });
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npx vitest run tests/tools/create_category.test.ts tests/tools/update_category.test.ts`
Expected: FAIL — modules unresolved.

- [ ] **Step 5: Implement `create_category`**

Create `src/tools/create_category.ts`:

```ts
import { z } from 'zod';
import { getGroupIndex } from '../core/taxonomy.js';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  name: z.string().min(1).max(100).describe('Category name, e.g. "VAT"'),
  group_id: ID.describe('Category group UUID the category belongs to (from get_categories or create_category_group)'),
  is_income: z.boolean().default(false).describe('Income category instead of a spending one'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'create_category',
  title: 'Create category',
  description: 'Create a category inside an existing category group. Returns the created category with its id, ready for categorize_transactions or set_budget.',
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    // Actual accepts any UUID-shaped group id and would strand the category:
    // validate before writing, the same way the other write tools do.
    if (!(await getGroupIndex(api)).has(a.group_id)) throw new Error(m.categoryGroupNotFound(a.group_id));
    const id = await api.createCategory({ name: a.name, group_id: a.group_id, is_income: a.is_income });
    const sync = await syncAfterWrite(api);
    return {
      created: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      category: { id, name: a.name, group_id: a.group_id, is_income: a.is_income },
    };
  },
};
```

- [ ] **Step 6: Implement `update_category`**

`getCategoryIndex` returns the group *name*, not its id, so this tool walks `getCategoryGroups()` itself to recover both the stored fields and the owning group id.

Create `src/tools/update_category.ts`:

```ts
import { z } from 'zod';
import { getGroupIndex } from '../core/taxonomy.js';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  id: ID.describe('Category UUID (from get_categories)'),
  name: z.string().min(1).max(100).optional().describe('New name'),
  group_id: ID.optional().describe('Move the category to this category group'),
  hidden: z.boolean().optional().describe('true archives the category without deleting anything'),
};
const schema = z.object(input);

/** The stored category plus the id of the group that owns it. */
async function findCategory(api: any, id: string): Promise<{ name: string; group_id: string; is_income: boolean; hidden: boolean } | null> {
  for (const g of (await api.getCategoryGroups()) ?? []) {
    for (const c of g.categories ?? []) {
      if (c.id === id) {
        return { name: c.name, group_id: g.id, is_income: !!c.is_income, hidden: !!c.hidden };
      }
    }
  }
  return null;
}

export const tool: ToolDef = {
  name: 'update_category',
  title: 'Update category',
  description: 'Rename a category, move it to another group, or archive it (hidden: true). Archiving is the non-destructive alternative to delete_category: past transactions keep their category.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    if (a.name === undefined && a.group_id === undefined && a.hidden === undefined) {
      throw new Error(m.noCategoryFieldToUpdate);
    }
    const current = await findCategory(api, a.id);
    if (!current) throw new Error(m.categoryNotFound(a.id));
    if (a.group_id !== undefined && !(await getGroupIndex(api)).has(a.group_id)) {
      throw new Error(m.categoryGroupNotFound(a.group_id));
    }
    // Same trap as update_category_group: Actual forwards `fields` unmerged and
    // then does category.name.trim(), so the full record has to travel.
    const fields = {
      name: a.name ?? current.name,
      group_id: a.group_id ?? current.group_id,
      is_income: current.is_income,
      hidden: a.hidden ?? current.hidden,
    };
    await api.updateCategory(a.id, fields);
    const sync = await syncAfterWrite(api);
    return {
      updated: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      category: { id: a.id, ...fields },
    };
  },
};
```

- [ ] **Step 7: Register and declare**

In `src/tools/index.ts` add the imports and append `createCategory, updateCategory` to `allTools`. In `manifest.json` append:

```json
    { "name": "create_category", "description": "Create a category inside a group" },
    { "name": "update_category", "description": "Rename, move or archive a category" }
```

- [ ] **Step 8: Run the suite and build**

Run: `npm test && npm run build`
Expected: PASS — 255, no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add src/tools/create_category.ts src/tools/update_category.ts tests/tools/create_category.test.ts tests/tools/update_category.test.ts src/core/messages.ts src/tools/index.ts tests/helpers/mock-api.ts manifest.json
git commit -m "feat(tools): create_category and update_category"
```

---

### Task 5: `delete_category` and `delete_category_group`

The two destructive tools, with both guards: confirmation and reassignment.

**Files:**
- Create: `src/tools/delete_category.ts`, `src/tools/delete_category_group.ts`
- Create: `tests/tools/delete_category.test.ts`, `tests/tools/delete_category_group.test.ts`
- Modify: `src/core/messages.ts`, `src/tools/index.ts`, `tests/helpers/mock-api.ts`, `manifest.json`

**Interfaces:**
- Consumes: `syncAfterWrite`, `getGroupIndex`, `countTransactionsForCategories`, `getCategoryIndex`.
- Produces: message keys `deleteCategoryNeedsConfirmation(name)`, `deleteGroupNeedsConfirmation(name, categoryCount)`, `deleteCategoryNeedsTarget(name, txCount)`, `deleteGroupNeedsTarget(name, txCount)`, `cannotReassignToSelf`.

- [ ] **Step 1: Add the message keys**

In `src/core/messages.ts`, `const es`, in the "Guardas de estado y consistencia de escritura" section after `unconfirmedWrites`:

```ts
  deleteCategoryNeedsConfirmation: (name: string) =>
    `Borrar la categoría "${name}" es irreversible. Vuelve a llamar con confirm_delete: true si estás seguro, ` +
    'o archívala sin perder nada con update_category(hidden: true)',
  deleteGroupNeedsConfirmation: (name: string, categoryCount: number) =>
    `Borrar el grupo "${name}" es irreversible y se lleva por delante sus ${categoryCount} categorías. ` +
    'Vuelve a llamar con confirm_delete: true si estás seguro, o archívalo sin perder nada con ' +
    'update_category_group(hidden: true)',
  deleteCategoryNeedsTarget: (name: string, txCount: number) =>
    `La categoría "${name}" tiene ${txCount} transacciones. Indica transfer_category_id con la categoría a la que ` +
    'reasignarlas; si se borra sin destino, esas transacciones quedan sin categoría',
  deleteGroupNeedsTarget: (name: string, txCount: number) =>
    `Las categorías del grupo "${name}" tienen ${txCount} transacciones. Indica transfer_category_id con la ` +
    'categoría (de OTRO grupo) a la que reasignarlas; si se borra sin destino, esas transacciones quedan sin categoría',
  cannotReassignToSelf: 'transfer_category_id no puede ser una de las categorías que se están borrando',
```

and in `const en: Messages`, same positions:

```ts
  deleteCategoryNeedsConfirmation: (name: string) =>
    `Deleting the category "${name}" cannot be undone. Call again with confirm_delete: true if you are sure, ` +
    'or archive it losing nothing with update_category(hidden: true)',
  deleteGroupNeedsConfirmation: (name: string, categoryCount: number) =>
    `Deleting the group "${name}" cannot be undone and takes its ${categoryCount} categories with it. ` +
    'Call again with confirm_delete: true if you are sure, or archive it losing nothing with ' +
    'update_category_group(hidden: true)',
  deleteCategoryNeedsTarget: (name: string, txCount: number) =>
    `The category "${name}" has ${txCount} transactions. Pass transfer_category_id with the category to reassign ` +
    'them to; deleting without a destination leaves those transactions uncategorized',
  deleteGroupNeedsTarget: (name: string, txCount: number) =>
    `The categories in group "${name}" have ${txCount} transactions. Pass transfer_category_id with the category ` +
    '(from ANOTHER group) to reassign them to; deleting without a destination leaves those transactions uncategorized',
  cannotReassignToSelf: 'transfer_category_id cannot be one of the categories being deleted',
```

- [ ] **Step 2: Add the API methods to the mock**

In `tests/helpers/mock-api.ts`, after `updateCategory`:

```ts
    deleteCategory: vi.fn(async () => undefined),
    deleteCategoryGroup: vi.fn(async () => undefined),
```

- [ ] **Step 3: Write the failing tests**

Create `tests/tools/delete_category.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/delete_category.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';
const CX = '88888888-8888-4888-8888-888888888888';
const groups = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Housing', is_income: false, categories: [
  { id: C1, name: 'Traspaso', hidden: false },
  { id: C2, name: 'Rent', hidden: false },
] }];

const empty = { data: [] };
const three = { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };

describe('delete_category', () => {
  it('refuses without confirm_delete and points at the archive alternative', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => empty });
    await expect(tool.handler({ id: C1 }, { api, config: testConfig }))
      .rejects.toThrow(/update_category\(hidden: true\)/);
    expect(api.deleteCategory).not.toHaveBeenCalled();
  });

  it('deletes an unused category once confirmed', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => empty });
    const r: any = await tool.handler({ id: C1, confirm_delete: true }, { api, config: testConfig });
    expect(api.deleteCategory).toHaveBeenCalledWith(C1, undefined);
    expect(r).toMatchObject({ deleted: true, category: { id: C1, name: 'Traspaso' }, transactions_reassigned: 0 });
  });

  it('refuses to strand transactions when no destination is given', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => three });
    await expect(tool.handler({ id: C1, confirm_delete: true }, { api, config: testConfig }))
      .rejects.toThrow(/3 transactions|3 transacciones/);
    expect(api.deleteCategory).not.toHaveBeenCalled();
  });

  it('reassigns transactions to the destination category', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => three });
    const r: any = await tool.handler({ id: C1, confirm_delete: true, transfer_category_id: C2 }, { api, config: testConfig });
    expect(api.deleteCategory).toHaveBeenCalledWith(C1, C2);
    expect(r.transactions_reassigned).toBe(3);
    expect(r.reassigned_to).toMatchObject({ id: C2, name: 'Rent' });
  });

  it('rejects an unknown destination category', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => three });
    await expect(tool.handler({ id: C1, confirm_delete: true, transfer_category_id: CX }, { api, config: testConfig }))
      .rejects.toThrow(CX);
    expect(api.deleteCategory).not.toHaveBeenCalled();
  });

  it('rejects reassigning a category to itself', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => three });
    await expect(tool.handler({ id: C1, confirm_delete: true, transfer_category_id: C1 }, { api, config: testConfig }))
      .rejects.toThrow(/transfer_category_id/);
    expect(api.deleteCategory).not.toHaveBeenCalled();
  });

  it('rejects an unknown category id', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => empty });
    await expect(tool.handler({ id: CX, confirm_delete: true }, { api, config: testConfig })).rejects.toThrow(CX);
  });

  it('is flagged destructive', () => {
    expect(tool.annotations?.destructiveHint).toBe(true);
  });
});
```

Create `tests/tools/delete_category_group.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/delete_category_group.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '66666666-6666-4666-8666-666666666666';
const GX = '99999999-9999-4999-8999-999999999999';
const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';
const OTHER = '77777777-7777-4777-8777-777777777777';

const groups = [
  { id: G1, name: 'Legacy', is_income: false, categories: [
    { id: C1, name: 'Traspaso', hidden: false },
    { id: C2, name: 'Profesora', hidden: false },
  ] },
  { id: G2, name: 'Living', is_income: false, categories: [{ id: OTHER, name: 'Misc', hidden: false }] },
];

const empty = { data: [] };
const two = { data: [{ id: 'a' }, { id: 'b' }] };

describe('delete_category_group', () => {
  it('refuses without confirm_delete and says how many categories go with it', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => empty });
    await expect(tool.handler({ id: G1 }, { api, config: testConfig }))
      .rejects.toThrow(/2/);
    expect(api.deleteCategoryGroup).not.toHaveBeenCalled();
  });

  it('deletes an empty-of-transactions group once confirmed', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => empty });
    const r: any = await tool.handler({ id: G1, confirm_delete: true }, { api, config: testConfig });
    expect(api.deleteCategoryGroup).toHaveBeenCalledWith(G1, undefined);
    expect(r).toMatchObject({ deleted: true, group: { id: G1, name: 'Legacy' }, categories_deleted: 2, transactions_reassigned: 0 });
  });

  it('refuses to strand the child categories transactions', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => two });
    await expect(tool.handler({ id: G1, confirm_delete: true }, { api, config: testConfig }))
      .rejects.toThrow(/transfer_category_id/);
    expect(api.deleteCategoryGroup).not.toHaveBeenCalled();
  });

  it('reassigns to a category outside the group', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => two });
    const r: any = await tool.handler({ id: G1, confirm_delete: true, transfer_category_id: OTHER }, { api, config: testConfig });
    expect(api.deleteCategoryGroup).toHaveBeenCalledWith(G1, OTHER);
    expect(r.transactions_reassigned).toBe(2);
  });

  it('rejects a destination that is inside the group being deleted', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => two });
    await expect(tool.handler({ id: G1, confirm_delete: true, transfer_category_id: C2 }, { api, config: testConfig }))
      .rejects.toThrow(/transfer_category_id/);
    expect(api.deleteCategoryGroup).not.toHaveBeenCalled();
  });

  it('rejects an unknown group id', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups, runQuery: async () => empty });
    await expect(tool.handler({ id: GX, confirm_delete: true }, { api, config: testConfig })).rejects.toThrow(GX);
  });
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npx vitest run tests/tools/delete_category.test.ts tests/tools/delete_category_group.test.ts`
Expected: FAIL — modules unresolved.

- [ ] **Step 5: Implement `delete_category`**

Create `src/tools/delete_category.ts`:

```ts
import { z } from 'zod';
import { getCategoryIndex } from '../core/categories.js';
import { countTransactionsForCategories } from '../core/taxonomy.js';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  id: ID.describe('Category UUID to delete (from get_categories)'),
  confirm_delete: z.boolean().default(false).describe('Must be true to actually delete. Deleting cannot be undone; consider update_category(hidden: true) to archive instead'),
  transfer_category_id: ID.optional().describe('Category the deleted category transactions are reassigned to. Required when the category has transactions'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'delete_category',
  title: 'Delete category',
  description: 'Permanently delete a category. Requires confirm_delete: true. If the category has transactions, transfer_category_id is mandatory and Actual reassigns them to it. To keep the history, archive with update_category(hidden: true) instead.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    const cats = await getCategoryIndex(api);
    const cat = cats.get(a.id);
    if (!cat) throw new Error(m.categoryNotFound(a.id));
    if (!a.confirm_delete) throw new Error(m.deleteCategoryNeedsConfirmation(cat.name));

    const txCount = await countTransactionsForCategories(api, [a.id]);
    if (a.transfer_category_id !== undefined) {
      if (a.transfer_category_id === a.id) throw new Error(m.cannotReassignToSelf);
      if (!cats.has(a.transfer_category_id)) throw new Error(m.categoryNotFound(a.transfer_category_id));
    } else if (txCount > 0) {
      // Actual would delete it anyway and leave the rows pointing at a dead id.
      throw new Error(m.deleteCategoryNeedsTarget(cat.name, txCount));
    }

    await api.deleteCategory(a.id, a.transfer_category_id);
    const sync = await syncAfterWrite(api);
    const target = a.transfer_category_id ? cats.get(a.transfer_category_id)! : null;
    return {
      deleted: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      category: { id: a.id, name: cat.name },
      transactions_reassigned: a.transfer_category_id ? txCount : 0,
      ...(target ? { reassigned_to: { id: target.id, name: target.name } } : {}),
    };
  },
};
```

- [ ] **Step 6: Implement `delete_category_group`**

Create `src/tools/delete_category_group.ts`:

```ts
import { z } from 'zod';
import { getCategoryIndex } from '../core/categories.js';
import { getGroupIndex, countTransactionsForCategories } from '../core/taxonomy.js';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  id: ID.describe('Category group UUID to delete (from get_categories)'),
  confirm_delete: z.boolean().default(false).describe('Must be true to actually delete. Deleting a group also deletes every category inside it and cannot be undone'),
  transfer_category_id: ID.optional().describe('Category (in another group) the transactions of the deleted categories are reassigned to. Required when those categories have transactions'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'delete_category_group',
  title: 'Delete category group',
  description: 'Permanently delete a category group AND every category inside it. Requires confirm_delete: true. If those categories have transactions, transfer_category_id is mandatory — pass a category from another group and Actual reassigns them to it. To keep the history, archive with update_category_group(hidden: true) instead.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    const group = (await getGroupIndex(api)).get(a.id);
    if (!group) throw new Error(m.categoryGroupNotFound(a.id));
    if (!a.confirm_delete) throw new Error(m.deleteGroupNeedsConfirmation(group.name, group.categoryIds.length));

    const txCount = await countTransactionsForCategories(api, group.categoryIds);
    const cats = await getCategoryIndex(api);
    if (a.transfer_category_id !== undefined) {
      // A destination inside the group is about to be deleted too: the reassignment
      // would point at a dead category.
      if (group.categoryIds.includes(a.transfer_category_id)) throw new Error(m.cannotReassignToSelf);
      if (!cats.has(a.transfer_category_id)) throw new Error(m.categoryNotFound(a.transfer_category_id));
    } else if (txCount > 0) {
      throw new Error(m.deleteGroupNeedsTarget(group.name, txCount));
    }

    await api.deleteCategoryGroup(a.id, a.transfer_category_id);
    const sync = await syncAfterWrite(api);
    const target = a.transfer_category_id ? cats.get(a.transfer_category_id)! : null;
    return {
      deleted: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      group: { id: a.id, name: group.name },
      categories_deleted: group.categoryIds.length,
      transactions_reassigned: a.transfer_category_id ? txCount : 0,
      ...(target ? { reassigned_to: { id: target.id, name: target.name } } : {}),
    };
  },
};
```

- [ ] **Step 7: Register and declare**

In `src/tools/index.ts` add both imports and append `deleteCategoryGroup, deleteCategory` to `allTools`. In `manifest.json` append:

```json
    { "name": "delete_category_group", "description": "Delete a category group and its categories (guarded)" },
    { "name": "delete_category", "description": "Delete a category, reassigning its transactions (guarded)" }
```

- [ ] **Step 8: Run the suite and build**

Run: `npm test && npm run build`
Expected: PASS — 269 (Phase 1 complete: 6 new tools, 22 registered).

- [ ] **Step 9: Commit**

```bash
git add src/tools/delete_category.ts src/tools/delete_category_group.ts tests/tools/delete_category.test.ts tests/tools/delete_category_group.test.ts src/core/messages.ts src/tools/index.ts tests/helpers/mock-api.ts manifest.json
git commit -m "feat(tools): guarded delete_category and delete_category_group"
```

---

### Task 6: Phase 1 empirical verification

Unit tests run against a mock: they prove our logic, not Actual's. This task proves the six tools against a **real Actual server** — the demo instance if it is deployed, otherwise the maintainer's budget with clearly marked test data that is deleted afterwards.

**Files:**
- Create: `scripts/verify/phase1-taxonomy.ts`

**Interfaces:**
- Consumes: every Phase 1 tool's exported `tool`, plus `loadConfig` from `src/core/config.ts` and the client bootstrap used by `scripts/demo/bootstrap-demo.ts`.

- [ ] **Step 1: Write the verification script**

Create `scripts/verify/phase1-taxonomy.ts`. It drives the tool handlers directly against a live API (not through MCP), prints one line per check and exits non-zero on the first failure. Model it on `scripts/demo/reset-check.ts`, which already opens a budget in a temporary data dir and prints a `RESULT=` line; reuse its bootstrap block verbatim so the two behave the same, and reuse `scripts/demo/env.ts` (`loadDemoEnv`) so a missing variable fails loudly.

The script must, in order:

1. Create a group `ZZZ Verify Group` with `create_category_group`; assert an id comes back.
2. Create a category `ZZZ Verify Cat` in it with `create_category`; assert an id comes back.
3. Rename it with `update_category` and re-read `get_categories`; assert the new name is stored.
4. Archive it with `update_category({ hidden: true })` and re-read with `include_hidden: true`; **assert it did not throw** — this is the read-merge-write trap, the single most likely runtime failure in Phase 1.
5. Archive the group with `update_category_group({ hidden: true })`; assert it did not throw.
6. Create a second category and a transaction against it (`create_transaction`), then call `delete_category` **without** `transfer_category_id`; assert it throws the "needs target" error.
7. Call it again with `transfer_category_id` pointing at the first category; assert it succeeds, then read the transaction back and assert its `category_id` is now the destination. **This is the claim the mock cannot make: that Actual really reassigns.**
8. Call `delete_category_group` on the verify group with `confirm_delete: true` and a destination outside it; assert it succeeds and that `get_categories` no longer lists the group.
9. Clean up anything left: the transaction, and any remaining `ZZZ Verify` category or group.

- [ ] **Step 2: Run it against a live server**

```bash
ACTUAL_SERVER_URL=… ACTUAL_SERVER_PASSWORD=… ACTUAL_SYNC_ID=… npx tsx scripts/verify/phase1-taxonomy.ts
```

Expected: every check prints OK and the process exits 0. **Note:** do not run this under Vitest. `NODE_ENV=test` makes `@actual-app/api` take an eager resync path that hangs on deletes — the reason `scripts/demo/reset-check.ts` exists as a subprocess. This script is standalone for the same reason.

- [ ] **Step 3: Record what the run proved**

Append the observed behaviour to `docs/superpowers/notes/2026-07-29-classification-verification.md` (create it): whether the partial-update trap really bites, what Actual does to a deleted category's transactions with and without a target, and anything that contradicts the "Verified API facts" table above. If a fact is contradicted, fix the tool and its test **before** moving to Phase 2.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify/phase1-taxonomy.ts docs/superpowers/notes/2026-07-29-classification-verification.md
git commit -m "test(verify): empirical check of the taxonomy tools against a real server"
```

---

## Phase 2 — Transfers and payees

### Task 7: Payee index, `get_payees` and `get_account_transfer_payee`

**Files:**
- Create: `src/core/payees.ts`, `src/tools/get_payees.ts`, `src/tools/get_account_transfer_payee.ts`
- Create: `tests/core/payees.test.ts`, `tests/tools/get_payees.test.ts`, `tests/tools/get_account_transfer_payee.test.ts`
- Modify: `src/core/messages.ts`, `src/tools/index.ts`, `manifest.json`

**Interfaces:**
- Produces:
  - `interface PayeeInfo { id: string; name: string; transfer_acct: string | null }`
  - `getPayeeIndex(api: any): Promise<{ byId: Map<string, PayeeInfo>; byTransferAccount: Map<string, PayeeInfo>; all: PayeeInfo[] }>`
  - message keys `transferPayeeNotFound(accountId)`, `accountNotFound(id)`
  - tools `get_payees`, `get_account_transfer_payee` (both `readOnly: true`)
- Task 8 consumes `getPayeeIndex` and both message keys.

- [ ] **Step 1: Add the message keys**

`const es`, in "No encontrado" after `payeeNotFound`:

```ts
  accountNotFound: (id: string) => `cuenta inexistente: ${id} (usa get_accounts para ver los ids válidos)`,
  transferPayeeNotFound: (accountId: string) =>
    `La cuenta ${accountId} no tiene pagador de transferencia. Actual lo crea con la cuenta: comprueba el id ` +
    'con get_accounts, y si la cuenta existe, ábrela una vez en Actual para que se genere',
```

`const en: Messages`:

```ts
  accountNotFound: (id: string) => `unknown account: ${id} (use get_accounts to list valid ids)`,
  transferPayeeNotFound: (accountId: string) =>
    `Account ${accountId} has no transfer payee. Actual creates one with the account: check the id with ` +
    'get_accounts, and if the account exists, open it once in Actual so the payee is generated',
```

- [ ] **Step 2: Write the failing test for the index**

Create `tests/core/payees.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getPayeeIndex } from '../../src/core/payees.js';
import { mockApi } from '../helpers/mock-api.js';

const A1 = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';

const payees = [
  { id: P1, name: 'Landlord', transfer_acct: null },
  { id: P2, name: 'Savings', transfer_acct: A1 },
];

describe('getPayeeIndex', () => {
  it('indexes by id and by transfer account', async () => {
    const idx = await getPayeeIndex(mockApi({ getPayees: async () => payees }));
    expect(idx.byId.get(P1)).toEqual({ id: P1, name: 'Landlord', transfer_acct: null });
    expect(idx.byTransferAccount.get(A1)!.id).toBe(P2);
    expect(idx.all).toHaveLength(2);
  });

  it('normalizes a missing transfer_acct to null and keeps it out of the transfer map', async () => {
    const idx = await getPayeeIndex(mockApi({ getPayees: async () => [{ id: P1, name: 'X' }] }));
    expect(idx.byId.get(P1)!.transfer_acct).toBeNull();
    expect(idx.byTransferAccount.size).toBe(0);
  });

  it('tolerates a null payee list', async () => {
    const idx = await getPayeeIndex(mockApi({ getPayees: async () => null }));
    expect(idx.all).toEqual([]);
  });
});
```

- [ ] **Step 3: Write the failing tests for both tools**

Create `tests/tools/get_payees.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_payees.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const A1 = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';
const payees = [
  { id: P1, name: 'Landlord', transfer_acct: null },
  { id: P2, name: 'Savings', transfer_acct: A1 },
];

describe('get_payees', () => {
  it('returns every payee with its transfer account', async () => {
    const r: any = await tool.handler({}, { api: mockApi({ getPayees: async () => payees }), config: testConfig });
    expect(r.payees).toEqual([
      { id: P1, name: 'Landlord', transfer_account_id: null },
      { id: P2, name: 'Savings', transfer_account_id: A1 },
    ]);
  });

  it('filters down to transfer payees on request', async () => {
    const r: any = await tool.handler({ only_transfers: true }, { api: mockApi({ getPayees: async () => payees }), config: testConfig });
    expect(r.payees).toHaveLength(1);
    expect(r.payees[0].id).toBe(P2);
  });

  it('is a read tool', () => {
    expect(tool.readOnly).toBe(true);
  });
});
```

Create `tests/tools/get_account_transfer_payee.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_account_transfer_payee.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '44444444-4444-4444-8444-444444444444';
const P2 = '33333333-3333-4333-8333-333333333333';
const payees = [{ id: P2, name: 'Savings', transfer_acct: A1 }];
const accounts = [{ id: A1, name: 'Savings' }, { id: A2, name: 'Cash' }];

describe('get_account_transfer_payee', () => {
  it('returns the transfer payee of the account', async () => {
    const api = mockApi({ getPayees: async () => payees, getAccounts: async () => accounts });
    const r: any = await tool.handler({ account_id: A1 }, { api, config: testConfig });
    expect(r).toEqual({ payee: { id: P2, name: 'Savings', transfer_account_id: A1 } });
  });

  it('gives an actionable error when the account has no transfer payee', async () => {
    const api = mockApi({ getPayees: async () => payees, getAccounts: async () => accounts });
    await expect(tool.handler({ account_id: A2 }, { api, config: testConfig })).rejects.toThrow(A2);
  });

  it('distinguishes an unknown account from one without a transfer payee', async () => {
    const unknown = '99999999-9999-4999-8999-999999999999';
    const api = mockApi({ getPayees: async () => payees, getAccounts: async () => accounts });
    await expect(tool.handler({ account_id: unknown }, { api, config: testConfig }))
      .rejects.toThrow(/cuenta inexistente|unknown account/);
  });
});
```

- [ ] **Step 4: Run and confirm they fail**

Run: `npx vitest run tests/core/payees.test.ts tests/tools/get_payees.test.ts tests/tools/get_account_transfer_payee.test.ts`
Expected: FAIL — modules unresolved.

- [ ] **Step 5: Implement the index**

Create `src/core/payees.ts`:

```ts
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
```

- [ ] **Step 6: Implement `get_payees`**

Create `src/tools/get_payees.ts`:

```ts
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
```

- [ ] **Step 7: Implement `get_account_transfer_payee`**

Create `src/tools/get_account_transfer_payee.ts`:

```ts
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
```

- [ ] **Step 8: Register and declare**

`src/tools/index.ts`: import and append `getPayees, getAccountTransferPayee`. `manifest.json`:

```json
    { "name": "get_payees", "description": "List payees, optionally only transfer payees" },
    { "name": "get_account_transfer_payee", "description": "The payee representing an account in transfers" }
```

- [ ] **Step 9: Run the suite and build**

Run: `npm test && npm run build`
Expected: PASS — 281.

- [ ] **Step 10: Commit**

```bash
git add src/core/payees.ts src/tools/get_payees.ts src/tools/get_account_transfer_payee.ts tests/core/payees.test.ts tests/tools/get_payees.test.ts tests/tools/get_account_transfer_payee.test.ts src/core/messages.ts src/tools/index.ts manifest.json
git commit -m "feat(tools): payee index, get_payees and get_account_transfer_payee"
```

---

### Task 8: `set_transaction_transfer`

The tool the whole phase exists for: turn an ordinary categorized transaction into a real transfer between two accounts.

Source reading (see "Verified API facts") says Actual creates and links the counterpart leg by itself, clears the category on both legs when the two accounts sit on the same side of the budget, and moves the existing counterpart when the transaction is already a transfer. The implementation below assumes exactly that and **reports what it reads back**, so if the runtime disagrees the echo shows it instead of the tool lying.

**Files:**
- Create: `src/tools/set_transaction_transfer.ts`, `tests/tools/set_transaction_transfer.test.ts`
- Modify: `src/core/messages.ts`, `src/tools/index.ts`, `manifest.json`

**Interfaces:**
- Consumes: `getPayeeIndex` (Task 7), `syncAfterWrite` (Task 1), and from `src/core/tx-read.ts`: `getTransactionById`, `readBack`, `mapTxEcho`.
- Produces: message keys `transferSameAccount`, `cannotTransferSplitParent(id)`; tool `set_transaction_transfer`.

- [ ] **Step 1: Add the message keys**

`const es`, in "Guardas de estado y consistencia de escritura":

```ts
  transferSameAccount: 'La cuenta de destino debe ser distinta de la cuenta de la transacción',
  cannotTransferSplitParent: (id: string) =>
    `La transacción ${id} es el padre de un split y Actual no puede convertirla en transferencia: convierte sus ` +
    'partes por separado o deshaz el split primero',
```

`const en: Messages`:

```ts
  transferSameAccount: 'The destination account must be different from the account of the transaction',
  cannotTransferSplitParent: (id: string) =>
    `Transaction ${id} is the parent of a split and Actual cannot turn it into a transfer: convert its parts ` +
    'individually or undo the split first',
```

- [ ] **Step 2: Write the failing test**

Create `tests/tools/set_transaction_transfer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { tool } from '../../src/tools/set_transaction_transfer.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const A_SRC = '22222222-2222-4222-8222-222222222222';
const A_DST = '33333333-3333-4333-8333-333333333333';
const A_OTHER = '44444444-4444-4444-8444-444444444444';
const P_DST = '55555555-5555-4555-8555-555555555555';
const LEG = '66666666-6666-4666-8666-666666666666';

const accounts = [{ id: A_SRC, name: 'Checking' }, { id: A_DST, name: 'Savings' }, { id: A_OTHER, name: 'Cash' }];
const payees = [{ id: P_DST, name: 'Savings', transfer_acct: A_DST }];

/** api.runQuery is how getTransactionById/readBack read: return `rows` each time. */
function apiWithRows(rows: any[][], overrides: Record<string, unknown> = {}) {
  let i = 0;
  return mockApi({
    getAccounts: async () => accounts,
    getPayees: async () => payees,
    runQuery: vi.fn(async () => ({ data: rows[Math.min(i++, rows.length - 1)] })),
    ...overrides,
  });
}

const plain = { id: T1, account: A_SRC, date: '2026-05-01', amount: -5000, payee: 'p-old', category: 'c-old', transfer_id: null };
const linked = { ...plain, payee: P_DST, category: null, transfer_id: LEG };

describe('set_transaction_transfer', () => {
  it('points the transaction at the destination transfer payee and echoes the linked leg', async () => {
    const api = apiWithRows([[plain], [linked]]);
    const r: any = await tool.handler({ transaction_id: T1, target_account_id: A_DST }, { api, config: testConfig });
    expect(api.updateTransaction).toHaveBeenCalledWith(T1, { payee: P_DST });
    expect(r.updated).toBe(true);
    expect(r.transfer_id).toBe(LEG);
    expect(r.transaction.id).toBe(T1);
  });

  it('reports transfer_id null when Actual did not link a counterpart', async () => {
    const api = apiWithRows([[plain], [{ ...plain, payee: P_DST }]]);
    const r: any = await tool.handler({ transaction_id: T1, target_account_id: A_DST }, { api, config: testConfig });
    expect(r.transfer_id).toBeNull();
  });

  it('rejects a target account with no transfer payee', async () => {
    const api = apiWithRows([[plain]]);
    await expect(tool.handler({ transaction_id: T1, target_account_id: A_OTHER }, { api, config: testConfig }))
      .rejects.toThrow(A_OTHER);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown target account', async () => {
    const unknown = '99999999-9999-4999-8999-999999999999';
    const api = apiWithRows([[plain]]);
    await expect(tool.handler({ transaction_id: T1, target_account_id: unknown }, { api, config: testConfig }))
      .rejects.toThrow(/cuenta inexistente|unknown account/);
  });

  it('rejects transferring a transaction into its own account', async () => {
    const api = apiWithRows([[plain]]);
    await expect(tool.handler({ transaction_id: T1, target_account_id: A_SRC }, { api, config: testConfig }))
      .rejects.toThrow(/distinta|different/);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('rejects a missing transaction', async () => {
    const api = apiWithRows([[]]);
    await expect(tool.handler({ transaction_id: T1, target_account_id: A_DST }, { api, config: testConfig }))
      .rejects.toThrow(T1);
  });

  it('rejects a split child by the parent-row detector', async () => {
    const parent = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', account: A_SRC, subtransactions: [{ id: T1 }] };
    const api = apiWithRows([[parent]]);
    await expect(tool.handler({ transaction_id: T1, target_account_id: A_DST }, { api, config: testConfig }))
      .rejects.toThrow(/split/i);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('rejects a split parent — Actual cannot make one a transfer', async () => {
    const api = apiWithRows([[{ ...plain, is_parent: true, subtransactions: [{ id: 'x' }, { id: 'y' }] }]]);
    await expect(tool.handler({ transaction_id: T1, target_account_id: A_DST }, { api, config: testConfig }))
      .rejects.toThrow(T1);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('syncs after writing', async () => {
    const api = apiWithRows([[plain], [linked]]);
    await tool.handler({ transaction_id: T1, target_account_id: A_DST }, { api, config: testConfig });
    expect(api.sync).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run and confirm it fails**

Run: `npx vitest run tests/tools/set_transaction_transfer.test.ts`
Expected: FAIL — module unresolved.

- [ ] **Step 4: Implement**

Create `src/tools/set_transaction_transfer.ts`:

```ts
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
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run tests/tools/set_transaction_transfer.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Register and declare**

`src/tools/index.ts`: import and append `setTransactionTransfer`. `manifest.json`:

```json
    { "name": "set_transaction_transfer", "description": "Turn a transaction into a transfer with another account" }
```

- [ ] **Step 7: Run the suite and build**

Run: `npm test && npm run build`
Expected: PASS — 290.

- [ ] **Step 8: Commit**

```bash
git add src/tools/set_transaction_transfer.ts tests/tools/set_transaction_transfer.test.ts src/core/messages.ts src/tools/index.ts manifest.json
git commit -m "feat(tools): set_transaction_transfer converts a transaction into a real transfer"
```

---

### Task 9: `update_transaction` gains `category_id: null` and `payee_id`

Two additions to a shipped tool. The response shape does not change.

**Files:**
- Modify: `src/tools/update_transaction.ts`, `tests/tools/update_transaction.test.ts`, `src/core/messages.ts`

**Interfaces:**
- Consumes: `getPayeeIndex` (Task 7).
- Produces: nothing new for later tasks; `noFieldToUpdate` gains `payee_id` in its enumeration.

- [ ] **Step 1: Update the `noFieldToUpdate` text in both languages**

In `src/core/messages.ts`, `es`:

```ts
  noFieldToUpdate: 'Debes indicar al menos un campo a actualizar (category_id, payee_id, payee_name, notes, date, amount, cleared)',
```

and `en`:

```ts
  noFieldToUpdate: 'You must specify at least one field to update (category_id, payee_id, payee_name, notes, date, amount, cleared)',
```

Add, in `es`, in "Formato y validación de entrada":

```ts
  payeeIdAndNameTogether: 'Indica payee_id o payee_name, no ambos',
```

and in `en`:

```ts
  payeeIdAndNameTogether: 'Specify payee_id or payee_name, not both',
```

Add, in `es`, in "No encontrado", after `payeeNotFound`:

```ts
  payeeIdNotFound: (id: string) => `pagador inexistente: ${id} (usa get_payees para ver los ids válidos)`,
```

and in `en`:

```ts
  payeeIdNotFound: (id: string) => `unknown payee: ${id} (use get_payees to list valid ids)`,
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/tools/update_transaction.test.ts` (keep every existing test untouched):

```ts
describe('update_transaction — clearing the category and setting the payee by id', () => {
  const T1 = '11111111-1111-4111-8111-111111111111';
  const P1 = '77777777-7777-4777-8777-777777777777';
  const row = { id: T1, account: 'acc', date: '2026-05-01', amount: -1000, category: 'c-old', payee: 'p-old' };

  it('clears the category with an explicit null', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [{ ...row, category: null }] }) });
    await tool.handler({ transaction_id: T1, category_id: null }, { api, config: testConfig });
    expect(api.updateTransaction).toHaveBeenCalledWith(T1, { category: null });
    // A null category must NOT be validated against the category index: there is
    // nothing to look up, and doing so would reject the clear.
    expect(api.getCategoryGroups).not.toHaveBeenCalled();
  });

  it('still treats an absent category_id as "leave it alone"', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [{ ...row, notes: 'x' }] }) });
    await tool.handler({ transaction_id: T1, notes: 'x' }, { api, config: testConfig });
    expect(api.updateTransaction).toHaveBeenCalledWith(T1, { notes: 'x' });
  });

  it('sets the payee by id', async () => {
    const api = mockApi({
      runQuery: async () => ({ data: [{ ...row, payee: P1 }] }),
      getPayees: async () => [{ id: P1, name: 'Landlord', transfer_acct: null }],
    });
    await tool.handler({ transaction_id: T1, payee_id: P1 }, { api, config: testConfig });
    expect(api.updateTransaction).toHaveBeenCalledWith(T1, { payee: P1 });
    expect(api.createPayee).not.toHaveBeenCalled();
  });

  it('rejects an unknown payee id before writing', async () => {
    const unknown = '99999999-9999-4999-8999-999999999999';
    const api = mockApi({ runQuery: async () => ({ data: [row] }), getPayees: async () => [] });
    await expect(tool.handler({ transaction_id: T1, payee_id: unknown }, { api, config: testConfig }))
      .rejects.toThrow(unknown);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('refuses payee_id and payee_name together', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [row] }) });
    await expect(tool.handler({ transaction_id: T1, payee_id: P1, payee_name: 'Landlord' }, { api, config: testConfig }))
      .rejects.toThrow(/payee_id/);
    expect(api.updateTransaction).not.toHaveBeenCalled();
  });

  it('still rejects a call with nothing to change', async () => {
    const api = mockApi({ runQuery: async () => ({ data: [row] }) });
    await expect(tool.handler({ transaction_id: T1 }, { api, config: testConfig })).rejects.toThrow(/payee_id/);
  });
});
```

- [ ] **Step 3: Run and confirm the new tests fail**

Run: `npx vitest run tests/tools/update_transaction.test.ts`
Expected: FAIL on the new block; the pre-existing tests keep passing.

- [ ] **Step 4: Implement**

In `src/tools/update_transaction.ts`, add the import:

```ts
import { getPayeeIndex } from '../core/payees.js';
```

Change the input shape — `category_id` becomes nullable and `payee_id` appears:

```ts
const input = {
  transaction_id: ID,
  category_id: ID.nullable().optional().describe('Category UUID; null clears the category (leaves the transaction uncategorized)'),
  payee_id: ID.optional().describe('Payee by id (from get_payees). Use payee_name instead to resolve or create one by name'),
  payee_name: z.string().max(200).optional().describe('Payee by name (resolved/created server-side)'),
  notes: z.string().max(1000).optional(),
  date: DATE.optional(),
  amount: z.number().optional().describe('Units (e.g. -45.50)'),
  cleared: z.boolean().optional(),
};
```

Replace the field-assembly and validation block with:

```ts
    const fields: any = {};
    // null is a value here (clear the category), undefined means "not provided":
    // the check has to be against undefined, never falsiness.
    if (a.category_id !== undefined) fields.category = a.category_id;
    if (a.notes !== undefined) fields.notes = a.notes;
    if (a.date !== undefined) fields.date = a.date;
    if (a.amount !== undefined) fields.amount = toCents(a.amount);
    if (a.cleared !== undefined) fields.cleared = a.cleared;
    if (a.category_id === undefined && a.payee_id === undefined && a.payee_name === undefined
      && a.notes === undefined && a.date === undefined && a.amount === undefined && a.cleared === undefined) {
      throw new Error(m.noFieldToUpdate);
    }
    if (a.payee_id !== undefined && a.payee_name !== undefined) throw new Error(m.payeeIdAndNameTogether);
```

Change the category-validation guard so a `null` skips the lookup:

```ts
    if (a.category_id !== undefined && a.category_id !== null) {
      const cats = await getCategoryIndex(api);
      if (!cats.has(a.category_id)) throw new Error(m.categoryNotFound(a.category_id));
    }
```

And add the payee-by-id resolution right before the existing `payee_name` block:

```ts
    if (a.payee_id !== undefined) {
      const { byId } = await getPayeeIndex(api);
      if (!byId.has(a.payee_id)) throw new Error(m.payeeIdNotFound(a.payee_id));
      fields.payee = a.payee_id;
    }
```

Also widen the split-parent guard so clearing the category on a parent is still refused:

```ts
    if (existing.is_parent || (Array.isArray(existing.subtransactions) && existing.subtransactions.length > 0)) {
      if (a.amount !== undefined || a.category_id !== undefined) {
        throw new Error(m.splitParentAmount(a.transaction_id));
      }
    }
```

(unchanged in text — `a.category_id !== undefined` already covers the explicit `null`; confirm it reads that way and leave it.)

Finally update the tool `description` to mention both new inputs:

```ts
  description: 'Update fields of an existing transaction (category, payee, notes, date, amount, cleared). Amount in currency units. Pass category_id: null to leave it uncategorized, payee_id to set a known payee, or payee_name to resolve/create one. Returns the resulting transaction.',
```

- [ ] **Step 5: Run and confirm everything passes**

Run: `npx vitest run tests/tools/update_transaction.test.ts`
Expected: PASS — the pre-existing tests plus the 6 new ones.

- [ ] **Step 6: Run the suite and build**

Run: `npm test && npm run build`
Expected: PASS — 296.

- [ ] **Step 7: Update the manifest description**

In `manifest.json`, the `update_transaction` entry description becomes: `"Update a transaction (category, payee by id or name, notes, date, amount)"`.

- [ ] **Step 8: Commit**

```bash
git add src/tools/update_transaction.ts tests/tools/update_transaction.test.ts src/core/messages.ts manifest.json
git commit -m "feat(tools): update_transaction accepts an explicit null category and a payee id"
```

---

### Task 10: Phase 2 empirical verification

**Files:**
- Create: `scripts/verify/phase2-transfers.ts`
- Modify: `docs/superpowers/notes/2026-07-29-classification-verification.md`

- [ ] **Step 1: Write the verification script**

Same shape as `scripts/verify/phase1-taxonomy.ts` (standalone, not under Vitest). It must:

1. Create two accounts' worth of context by reading `get_accounts` and picking two accounts on the **same** side of the budget, plus one pair on **opposite** sides if the budget has an off-budget account.
2. Create a plain categorized transaction on the first account with `create_transaction`.
3. Call `set_transaction_transfer` towards the second account.
4. **Assert the counterpart exists**: read the target account's transactions and find the row whose `transfer_id` is the original id, with the opposite amount. This is open question 1 from the spec — source reading says yes, this is the runtime proof.
5. **Assert the category behaviour**: on a same-side pair, both legs come back with `category_id: null`; on an opposite-side pair, the category survives. Record whichever actually happens.
6. Re-point the transfer to a third account and assert **no second counterpart appeared** (the original leg moved).
7. Call `update_transaction({ category_id: null })` on an ordinary transaction and assert the category is cleared, then `payee_id` and assert the payee changed.
8. Delete every transaction created and confirm nothing marked `ZZZ Verify` is left.

- [ ] **Step 2: Run it against a live server**

```bash
ACTUAL_SERVER_URL=… ACTUAL_SERVER_PASSWORD=… ACTUAL_SYNC_ID=… npx tsx scripts/verify/phase2-transfers.ts
```

Expected: every check prints OK, exit 0.

- [ ] **Step 3: Record the answers**

Append to the verification note: whether the counterpart leg is auto-linked, what happens to the category in each on/off-budget combination, and what re-pointing does. **If the counterpart is NOT auto-linked**, the tool description in `set_transaction_transfer.ts` is wrong and must be corrected in this task before Phase 3 — and a follow-up decision is needed on whether to create the leg manually (the spec allows either, chosen by the empirical result).

- [ ] **Step 4: Commit**

```bash
git add scripts/verify/phase2-transfers.ts docs/superpowers/notes/2026-07-29-classification-verification.md
git commit -m "test(verify): empirical check of transfers and payees against a real server"
```

---

## Phase 3 — Rules

### Task 11: Rule schema and unit↔cent conversion

The rule object is the largest input surface in the server, and amounts inside it must convert like everywhere else. It gets its own module, unit-tested on its own, before any tool touches it.

**Files:**
- Create: `src/core/rule-schema.ts`, `tests/core/rule-schema.test.ts`
- Modify: `src/core/messages.ts`, `tests/core/messages.test.ts` (widen the static detector)

**Interfaces:**
- Produces:
  - `RULE_SHAPE` — a `ZodRawShape` fragment: `{ stage, conditionsOp, conditions, actions }`
  - `RULE_OBJECT` — `z.object(RULE_SHAPE)`, the parsed type used by the tools
  - `ruleToApi(rule: z.infer<typeof RULE_OBJECT>): any` — units → cents
  - `ruleFromApi(entity: any): any` — cents → units, plus `id`
  - message keys `unknownRuleField`, `unknownRuleOp`, `unknownRuleStage`
- Tasks 12 and 13 consume all of it.

- [ ] **Step 1: Add the message keys**

`const es`, in "Formato y validación de entrada":

```ts
  unknownRuleField: 'Campo de regla desconocido (usa get_rules para ver ejemplos de reglas existentes)',
  unknownRuleOp: 'Operador de regla desconocido (usa get_rules para ver ejemplos de reglas existentes)',
  unknownRuleStage: "stage debe ser 'pre', 'post' o null (null = la etapa por defecto)",
```

`const en: Messages`:

```ts
  unknownRuleField: 'Unknown rule field (use get_rules to see examples of existing rules)',
  unknownRuleOp: 'Unknown rule operator (use get_rules to see examples of existing rules)',
  unknownRuleStage: "stage must be 'pre', 'post' or null (null = the default stage)",
```

- [ ] **Step 2: Widen the static message detector to cover the new module**

In `tests/core/messages.test.ts`, the file list currently ends with `.concat(path.join(raiz, 'src', 'core', 'types.ts'))`. Replace that line with:

```ts
      .concat(path.join(raiz, 'src', 'core', 'types.ts'), path.join(raiz, 'src', 'core', 'rule-schema.ts'));
```

This closes a gap noted when the detector was written: it only scanned `src/tools/` plus `types.ts`, so a fixed Spanish string in a new `src/core/` schema module would have slipped through.

- [ ] **Step 3: Write the failing test**

Create `tests/core/rule-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RULE_OBJECT, ruleToApi, ruleFromApi } from '../../src/core/rule-schema.js';

const CAT = '11111111-1111-4111-8111-111111111111';
const PAYEE = '22222222-2222-4222-8222-222222222222';

const baseRule = {
  stage: null,
  conditionsOp: 'and',
  conditions: [{ field: 'payee', op: 'contains', value: 'Landlord' }],
  actions: [{ op: 'set', field: 'category', value: CAT }],
};

describe('RULE_OBJECT validation', () => {
  it('accepts a well-formed rule', () => {
    expect(RULE_OBJECT.safeParse(baseRule).success).toBe(true);
  });

  it('accepts the three stages', () => {
    for (const stage of ['pre', 'post', null]) {
      expect(RULE_OBJECT.safeParse({ ...baseRule, stage }).success, String(stage)).toBe(true);
    }
  });

  it('rejects an unknown stage', () => {
    expect(RULE_OBJECT.safeParse({ ...baseRule, stage: 'default' }).success).toBe(false);
  });

  it('rejects an unknown condition field and an unknown op', () => {
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [{ field: 'nope', op: 'is', value: 'x' }] }).success).toBe(false);
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [{ field: 'payee', op: 'nope', value: 'x' }] }).success).toBe(false);
  });

  it('rejects empty conditions or actions', () => {
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [] }).success).toBe(false);
    expect(RULE_OBJECT.safeParse({ ...baseRule, actions: [] }).success).toBe(false);
  });

  it('rejects a non-UUID value on an id-typed field', () => {
    // The AQL compiler interpolates id values unescaped: this is the injection barrier.
    expect(RULE_OBJECT.safeParse({ ...baseRule, actions: [{ op: 'set', field: 'category', value: "x' OR 1=1" }] }).success).toBe(false);
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [{ field: 'payee', op: 'is', value: 'not-a-uuid' }] }).success).toBe(false);
  });

  it('allows a free-text value on an id field when the op is textual', () => {
    // `payee contains "Landlord"` matches on the payee NAME, not on an id.
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [{ field: 'payee', op: 'contains', value: 'Landlord' }] }).success).toBe(true);
  });

  it('accepts an array value for oneOf and a range for isbetween', () => {
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [{ field: 'payee', op: 'oneOf', value: [PAYEE] }] }).success).toBe(true);
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [{ field: 'amount', op: 'isbetween', value: { num1: -50, num2: -10 } }] }).success).toBe(true);
  });
});

describe('ruleToApi / ruleFromApi', () => {
  it('converts amount conditions to cents', () => {
    const api = ruleToApi(RULE_OBJECT.parse({ ...baseRule, conditions: [{ field: 'amount', op: 'lt', value: -45.5 }] }));
    expect(api.conditions[0].value).toBe(-4550);
  });

  it('converts both ends of an isbetween range', () => {
    const api = ruleToApi(RULE_OBJECT.parse({ ...baseRule, conditions: [{ field: 'amount', op: 'isbetween', value: { num1: -50, num2: -10.25 } }] }));
    expect(api.conditions[0].value).toEqual({ num1: -5000, num2: -1025 });
  });

  it('converts every element of an amount oneOf', () => {
    const api = ruleToApi(RULE_OBJECT.parse({ ...baseRule, conditions: [{ field: 'amount', op: 'oneOf', value: [-1.5, -2.25] }] }));
    expect(api.conditions[0].value).toEqual([-150, -225]);
  });

  it('converts a set-amount action to cents', () => {
    const api = ruleToApi(RULE_OBJECT.parse({ ...baseRule, actions: [{ op: 'set', field: 'amount', value: 12.34 }] }));
    expect(api.actions[0].value).toBe(1234);
  });

  it('leaves non-amount values alone', () => {
    const api = ruleToApi(RULE_OBJECT.parse(baseRule));
    expect(api.conditions[0].value).toBe('Landlord');
    expect(api.actions[0].value).toBe(CAT);
  });

  it('round-trips back into units', () => {
    const stored = {
      id: 'rule-1',
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'amount', op: 'lt', value: -4550 }],
      actions: [{ op: 'set', field: 'amount', value: 1234 }],
    };
    const out = ruleFromApi(stored);
    expect(out.id).toBe('rule-1');
    expect(out.conditions[0].value).toBe(-45.5);
    expect(out.actions[0].value).toBe(12.34);
  });

  it('does not mutate its input', () => {
    const parsed = RULE_OBJECT.parse({ ...baseRule, conditions: [{ field: 'amount', op: 'lt', value: -45.5 }] });
    ruleToApi(parsed);
    expect(parsed.conditions[0].value).toBe(-45.5);
  });
});
```

- [ ] **Step 4: Run and confirm it fails**

Run: `npx vitest run tests/core/rule-schema.test.ts`
Expected: FAIL — module unresolved.

- [ ] **Step 5: Implement**

Create `src/core/rule-schema.ts`:

```ts
// rule-schema.ts — shape, validation and unit<->cent conversion for Actual rules.
//
// The field and op lists come from RuleConditionEntity in @actual-app/core
// (types/models/rule.d.ts). The full field x op matrix is NOT encoded: it is long,
// it changes upstream, and Actual validates the cross itself. What we do enforce is
// that the field and the op are known, the arrays are non-empty, id-typed values are
// UUIDs, and amounts arrive in currency units.
import { z } from 'zod';
import { toCents, toUnits } from './money.js';
import { activeMessages } from './messages.js';
import { ID } from './types.js';

/** Condition fields, exactly the union in RuleConditionEntity. */
const CONDITION_FIELDS = [
  'account', 'amount', 'category', 'category_group', 'date', 'notes',
  'payee', 'imported_payee', 'saved', 'cleared', 'reconciled', 'transfer',
] as const;

/** Every op that appears in the union, flattened. */
const CONDITION_OPS = [
  'is', 'isNot', 'oneOf', 'notOneOf', 'contains', 'doesNotContain', 'matches',
  'onBudget', 'offBudget', 'isapprox', 'isbetween', 'gt', 'gte', 'lt', 'lte',
  'hasTags', 'hasAnyTag',
] as const;

/** Fields whose value is an id when the op compares by identity. */
const ID_FIELDS = new Set(['account', 'category', 'category_group', 'payee']);
/** Ops that compare by identity rather than by text. */
const ID_OPS = new Set(['is', 'isNot', 'oneOf', 'notOneOf']);

const AMOUNT_RANGE = z.object({ num1: z.number(), num2: z.number() });

const CONDITION = z.object({
  field: z.enum(CONDITION_FIELDS, { error: () => activeMessages().unknownRuleField }),
  op: z.enum(CONDITION_OPS, { error: () => activeMessages().unknownRuleOp }),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])), AMOUNT_RANGE, z.null()]),
  options: z.record(z.string(), z.unknown()).optional(),
});

const ACTION = z.object({
  op: z.literal('set'),
  field: z.enum(CONDITION_FIELDS, { error: () => activeMessages().unknownRuleField }),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  options: z.record(z.string(), z.unknown()).optional(),
});

export const RULE_SHAPE = {
  stage: z.union([z.literal('pre'), z.literal('post'), z.null()], { error: () => activeMessages().unknownRuleStage })
    .describe("When the rule runs: 'pre', 'post', or null for the default stage"),
  conditionsOp: z.enum(['and', 'or']).describe('Whether all conditions must match or any of them'),
  conditions: z.array(CONDITION).min(1).max(20).describe('Conditions the transaction must satisfy'),
  actions: z.array(ACTION).min(1).max(20).describe('What to set on a matching transaction'),
};

export const RULE_OBJECT = z.object(RULE_SHAPE).superRefine((rule, ctx) => {
  // Identity comparisons on id fields must be UUIDs: the AQL compiler interpolates
  // them unescaped. Text comparisons (contains/matches) match names, not ids.
  const checkId = (value: unknown, path: (string | number)[]) => {
    if (!ID.safeParse(value).success) {
      ctx.addIssue({ code: 'custom', path, message: activeMessages().mustBeUuid });
    }
  };
  rule.conditions.forEach((c, i) => {
    if (!ID_FIELDS.has(c.field) || !ID_OPS.has(c.op)) return;
    const path = ['conditions', i, 'value'];
    if (Array.isArray(c.value)) c.value.forEach((v, j) => checkId(v, [...path, j]));
    else checkId(c.value, path);
  });
  rule.actions.forEach((a, i) => {
    if (ID_FIELDS.has(a.field)) checkId(a.value, ['actions', i, 'value']);
  });
});

const toCentsValue = (value: unknown): unknown => {
  if (typeof value === 'number') return toCents(value);
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'number' ? toCents(v) : v));
  if (value && typeof value === 'object' && 'num1' in value && 'num2' in value) {
    const range = value as { num1: number; num2: number };
    return { num1: toCents(range.num1), num2: toCents(range.num2) };
  }
  return value;
};

const toUnitsValue = (value: unknown): unknown => {
  if (typeof value === 'number') return toUnits(value);
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'number' ? toUnits(v) : v));
  if (value && typeof value === 'object' && 'num1' in value && 'num2' in value) {
    const range = value as { num1: number; num2: number };
    return { num1: toUnits(range.num1), num2: toUnits(range.num2) };
  }
  return value;
};

/** Validated rule (units) -> the object @actual-app/api expects (cents). */
export function ruleToApi(rule: z.infer<typeof RULE_OBJECT>): any {
  return {
    stage: rule.stage,
    conditionsOp: rule.conditionsOp,
    conditions: rule.conditions.map((c) => ({ ...c, value: c.field === 'amount' ? toCentsValue(c.value) : c.value })),
    actions: rule.actions.map((a) => ({ ...a, value: a.field === 'amount' ? toCentsValue(a.value) : a.value })),
  };
}

/** A stored rule (cents) -> the shape tools return (units). */
export function ruleFromApi(entity: any): any {
  return {
    id: entity.id,
    stage: entity.stage ?? null,
    conditionsOp: entity.conditionsOp,
    conditions: (entity.conditions ?? []).map((c: any) => ({ ...c, value: c.field === 'amount' ? toUnitsValue(c.value) : c.value })),
    actions: (entity.actions ?? []).map((a: any) => ({ ...a, value: a.field === 'amount' ? toUnitsValue(a.value) : a.value })),
  };
}
```

- [ ] **Step 6: Run and confirm it passes**

Run: `npx vitest run tests/core/rule-schema.test.ts tests/core/messages.test.ts`
Expected: PASS. The messages detector must stay green with the widened file list.

- [ ] **Step 7: Run the suite and build**

Run: `npm test && npm run build`
Expected: PASS — 309.

- [ ] **Step 8: Commit**

```bash
git add src/core/rule-schema.ts tests/core/rule-schema.test.ts src/core/messages.ts tests/core/messages.test.ts
git commit -m "feat(core): rule schema with UUID guards and unit<->cent conversion"
```

---

### Task 12: `get_rules` and `delete_rule`

**Files:**
- Create: `src/tools/get_rules.ts`, `src/tools/delete_rule.ts`
- Create: `tests/tools/get_rules.test.ts`, `tests/tools/delete_rule.test.ts`
- Modify: `src/core/messages.ts`, `src/tools/index.ts`, `tests/helpers/mock-api.ts`, `manifest.json`

**Interfaces:**
- Consumes: `ruleFromApi` (Task 11), `syncAfterWrite` (Task 1).
- Produces: message keys `ruleNotFound(id)`, `ruleDeleteRejected(id)`; tools `get_rules` (read) and `delete_rule` (write).

- [ ] **Step 1: Add the message keys**

`const es`, "No encontrado":

```ts
  ruleNotFound: (id: string) => `regla inexistente: ${id} (usa get_rules para ver los ids válidos)`,
```

`const es`, "Guardas de estado y consistencia de escritura":

```ts
  ruleDeleteRejected: (id: string) => `Actual rechazó el borrado de la regla ${id}; vuelve a consultarla con get_rules`,
```

`const en: Messages`, same positions:

```ts
  ruleNotFound: (id: string) => `unknown rule: ${id} (use get_rules to list valid ids)`,
```

```ts
  ruleDeleteRejected: (id: string) => `Actual refused to delete rule ${id}; query it again with get_rules`,
```

- [ ] **Step 2: Add the API methods to the mock**

`tests/helpers/mock-api.ts`, after `deleteCategoryGroup`:

```ts
    getRules: vi.fn(async () => []),
    createRule: vi.fn(async (rule: any) => ({ id: 'new-rule-id', ...rule })),
    updateRule: vi.fn(async (rule: any) => rule),
    deleteRule: vi.fn(async () => true),
```

- [ ] **Step 3: Write the failing tests**

Create `tests/tools/get_rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_rules.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const CAT = '11111111-1111-4111-8111-111111111111';
const rules = [
  { id: 'r1', stage: null, conditionsOp: 'and',
    conditions: [{ field: 'payee', op: 'contains', value: 'Landlord' }],
    actions: [{ op: 'set', field: 'category', value: CAT }] },
  { id: 'r2', stage: 'pre', conditionsOp: 'and',
    conditions: [{ field: 'amount', op: 'lt', value: -4550 }],
    actions: [{ op: 'set', field: 'notes', value: 'big' }] },
];

describe('get_rules', () => {
  it('returns the rules with amounts in units', async () => {
    const r: any = await tool.handler({}, { api: mockApi({ getRules: async () => rules }), config: testConfig });
    expect(r.rules).toHaveLength(2);
    expect(r.rules[1].conditions[0].value).toBe(-45.5);
    expect(r.rules[0].actions[0].value).toBe(CAT);
  });

  it('is a read tool', () => {
    expect(tool.readOnly).toBe(true);
  });

  it('tolerates an empty rule set', async () => {
    const r: any = await tool.handler({}, { api: mockApi(), config: testConfig });
    expect(r.rules).toEqual([]);
  });
});
```

Create `tests/tools/delete_rule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/delete_rule.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const R1 = '11111111-1111-4111-8111-111111111111';
const RX = '99999999-9999-4999-8999-999999999999';
const rules = [{ id: R1, stage: null, conditionsOp: 'and', conditions: [], actions: [] }];

describe('delete_rule', () => {
  it('deletes an existing rule', async () => {
    const api = mockApi({ getRules: async () => rules });
    const r: any = await tool.handler({ id: R1 }, { api, config: testConfig });
    expect(api.deleteRule).toHaveBeenCalledWith(R1);
    expect(r).toMatchObject({ deleted: true, rule_id: R1 });
  });

  it('rejects an unknown rule id before writing', async () => {
    const api = mockApi({ getRules: async () => rules });
    await expect(tool.handler({ id: RX }, { api, config: testConfig })).rejects.toThrow(RX);
    expect(api.deleteRule).not.toHaveBeenCalled();
  });

  it('surfaces a false return as a failure instead of claiming success', async () => {
    const api = mockApi({ getRules: async () => rules, deleteRule: async () => false });
    await expect(tool.handler({ id: R1 }, { api, config: testConfig })).rejects.toThrow(R1);
  });

  it('syncs after deleting', async () => {
    const api = mockApi({ getRules: async () => rules });
    await tool.handler({ id: R1 }, { api, config: testConfig });
    expect(api.sync).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: Run and confirm they fail**

Run: `npx vitest run tests/tools/get_rules.test.ts tests/tools/delete_rule.test.ts`
Expected: FAIL — modules unresolved.

- [ ] **Step 5: Implement `get_rules`**

Create `src/tools/get_rules.ts`:

```ts
import { z } from 'zod';
import { ruleFromApi } from '../core/rule-schema.js';
import type { ToolDef } from '../core/types.js';

const input = {};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_rules',
  title: 'List rules',
  description: "Actual's automation rules, with their IDs. Rules run on imported transactions and are how recurring movements classify themselves. Amounts are in currency units.",
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api }) => {
    schema.parse(raw ?? {});
    const rules = ((await api.getRules()) ?? []) as any[];
    return { rules: rules.map(ruleFromApi) };
  },
};
```

- [ ] **Step 6: Implement `delete_rule`**

Create `src/tools/delete_rule.ts`:

```ts
import { z } from 'zod';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  id: ID.describe('Rule UUID (from get_rules)'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'delete_rule',
  title: 'Delete rule',
  description: 'Delete an automation rule. Past transactions keep whatever the rule already applied to them; only future imports change.',
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    const rules = ((await api.getRules()) ?? []) as any[];
    if (!rules.some((r) => r.id === a.id)) throw new Error(m.ruleNotFound(a.id));
    // deleteRule returns a boolean: a false is a refusal, not a success.
    const ok = await api.deleteRule(a.id);
    if (ok === false) throw new Error(m.ruleDeleteRejected(a.id));
    const sync = await syncAfterWrite(api);
    return {
      deleted: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      rule_id: a.id,
    };
  },
};
```

- [ ] **Step 7: Register and declare**

`src/tools/index.ts`: import and append `getRules, deleteRule`. `manifest.json`:

```json
    { "name": "get_rules", "description": "List Actual automation rules" },
    { "name": "delete_rule", "description": "Delete an automation rule" }
```

- [ ] **Step 8: Run the suite and build**

Run: `npm test && npm run build`
Expected: PASS — 316.

- [ ] **Step 9: Commit**

```bash
git add src/tools/get_rules.ts src/tools/delete_rule.ts tests/tools/get_rules.test.ts tests/tools/delete_rule.test.ts src/core/messages.ts src/tools/index.ts tests/helpers/mock-api.ts manifest.json
git commit -m "feat(tools): get_rules and delete_rule"
```

---

### Task 13: `create_rule` and `update_rule`

**Files:**
- Create: `src/tools/create_rule.ts`, `src/tools/update_rule.ts`
- Create: `tests/tools/create_rule.test.ts`, `tests/tools/update_rule.test.ts`
- Modify: `src/tools/index.ts`, `manifest.json`

**Interfaces:**
- Consumes: `RULE_SHAPE`, `RULE_OBJECT`, `ruleToApi`, `ruleFromApi` (Task 11), `syncAfterWrite` (Task 1), `ruleNotFound` (Task 12).
- Produces: the last two tools; after this the catalogue is complete at 29.

- [ ] **Step 1: Write the failing tests**

Create `tests/tools/create_rule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/create_rule.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const CAT = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';

const rule = {
  stage: null,
  conditionsOp: 'and',
  conditions: [{ field: 'payee', op: 'contains', value: 'Revolut Vault' }],
  actions: [{ op: 'set', field: 'category', value: CAT }],
};

describe('create_rule', () => {
  it('creates the rule and echoes it with its id', async () => {
    const api = mockApi({ createRule: async (r: any) => ({ id: NEW, ...r }) });
    const r: any = await tool.handler(rule, { api, config: testConfig });
    expect(api.createRule).toHaveBeenCalledWith(expect.objectContaining({
      stage: null,
      conditionsOp: 'and',
      conditions: [expect.objectContaining({ field: 'payee', op: 'contains', value: 'Revolut Vault' })],
    }));
    expect(r).toMatchObject({ created: true, rule: { id: NEW } });
  });

  it('converts amounts to cents on the way in and back to units in the echo', async () => {
    const api = mockApi({ createRule: async (r: any) => ({ id: NEW, ...r }) });
    const withAmount = { ...rule, conditions: [{ field: 'amount', op: 'lt', value: -45.5 }] };
    const r: any = await tool.handler(withAmount, { api, config: testConfig });
    expect(api.createRule.mock.calls[0][0].conditions[0].value).toBe(-4550);
    expect(r.rule.conditions[0].value).toBe(-45.5);
  });

  it('refuses a rule with no conditions', async () => {
    const api = mockApi();
    await expect(tool.handler({ ...rule, conditions: [] }, { api, config: testConfig })).rejects.toThrow();
    expect(api.createRule).not.toHaveBeenCalled();
  });

  it('refuses a non-UUID category in a set action', async () => {
    const api = mockApi();
    await expect(tool.handler({ ...rule, actions: [{ op: 'set', field: 'category', value: 'Rent' }] }, { api, config: testConfig }))
      .rejects.toThrow();
    expect(api.createRule).not.toHaveBeenCalled();
  });

  it('syncs after writing', async () => {
    const api = mockApi({ createRule: async (r: any) => ({ id: NEW, ...r }) });
    await tool.handler(rule, { api, config: testConfig });
    expect(api.sync).toHaveBeenCalledTimes(1);
  });
});
```

Create `tests/tools/update_rule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/update_rule.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const R1 = '11111111-1111-4111-8111-111111111111';
const RX = '99999999-9999-4999-8999-999999999999';
const CAT = '22222222-2222-4222-8222-222222222222';

const stored = [{ id: R1, stage: null, conditionsOp: 'and', conditions: [], actions: [] }];
const rule = {
  id: R1,
  stage: 'pre',
  conditionsOp: 'and',
  conditions: [{ field: 'notes', op: 'contains', value: 'rent' }],
  actions: [{ op: 'set', field: 'category', value: CAT }],
};

describe('update_rule', () => {
  it('sends the whole rule object including the id, as the API requires', async () => {
    const api = mockApi({ getRules: async () => stored, updateRule: async (r: any) => r });
    const r: any = await tool.handler(rule, { api, config: testConfig });
    expect(api.updateRule).toHaveBeenCalledWith(expect.objectContaining({ id: R1, stage: 'pre' }));
    expect(r).toMatchObject({ updated: true, rule: { id: R1 } });
  });

  it('rejects an unknown rule id before writing', async () => {
    const api = mockApi({ getRules: async () => stored });
    await expect(tool.handler({ ...rule, id: RX }, { api, config: testConfig })).rejects.toThrow(RX);
    expect(api.updateRule).not.toHaveBeenCalled();
  });

  it('converts amounts to cents', async () => {
    const api = mockApi({ getRules: async () => stored, updateRule: async (r: any) => r });
    await tool.handler({ ...rule, actions: [{ op: 'set', field: 'amount', value: 10.5 }] }, { api, config: testConfig });
    expect(api.updateRule.mock.calls[0][0].actions[0].value).toBe(1050);
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run tests/tools/create_rule.test.ts tests/tools/update_rule.test.ts`
Expected: FAIL — modules unresolved.

- [ ] **Step 3: Implement `create_rule`**

Create `src/tools/create_rule.ts`:

```ts
import { RULE_SHAPE, RULE_OBJECT, ruleToApi, ruleFromApi } from '../core/rule-schema.js';
import { syncAfterWrite } from '../core/write-sync.js';
import type { ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = RULE_SHAPE;

export const tool: ToolDef = {
  name: 'create_rule',
  title: 'Create rule',
  description: "Create an automation rule. Rules run on transactions as they are imported: a condition like payee contains 'X' with an action set category = <id> is how recurring movements classify themselves. Ids must be UUIDs from get_categories / get_payees / get_accounts; amounts are in currency units. Rules do not apply retroactively to existing transactions.",
  readOnly: false,
  annotations: { destructiveHint: false, idempotentHint: false },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = RULE_OBJECT.parse(raw ?? {});
    const m = msg(config);
    const created = await api.createRule(ruleToApi(a));
    const sync = await syncAfterWrite(api);
    return {
      created: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      rule: ruleFromApi(created),
    };
  },
};
```

- [ ] **Step 4: Implement `update_rule`**

Create `src/tools/update_rule.ts`:

```ts
import { RULE_SHAPE, RULE_OBJECT, ruleToApi, ruleFromApi } from '../core/rule-schema.js';
import { syncAfterWrite } from '../core/write-sync.js';
import { ID, type ToolDef } from '../core/types.js';
import { msg } from '../core/messages.js';

const input = {
  id: ID.describe('Rule UUID (from get_rules)'),
  ...RULE_SHAPE,
};

const schema = RULE_OBJECT.safeExtend({ id: ID });

export const tool: ToolDef = {
  name: 'update_rule',
  title: 'Update rule',
  description: "Replace an automation rule. Actual's API takes the WHOLE rule object, so send every field you want to keep — anything omitted is lost. Read the current rule with get_rules first. Amounts are in currency units.",
  readOnly: false,
  annotations: { destructiveHint: true, idempotentHint: true },
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const m = msg(config);
    const rules = ((await api.getRules()) ?? []) as any[];
    if (!rules.some((r) => r.id === a.id)) throw new Error(m.ruleNotFound(a.id));
    const updated = await api.updateRule({ id: a.id, ...ruleToApi(a) });
    const sync = await syncAfterWrite(api);
    return {
      updated: true,
      ...(sync.synced ? {} : { sync_pending: true, note: m.syncPending(sync.error!) }),
      rule: ruleFromApi(updated),
    };
  },
};
```

`safeExtend` on a `superRefine`d object was checked against the pinned Zod (4.4.3) while writing this plan: it exists, and the extended schema **still enforces the refinement** — a non-UUID category in a `set` action is rejected through the extended schema, and a missing `id` is rejected too. So the line above is the form to use; no fallback needed.

Add a test in `tests/tools/update_rule.test.ts` that locks that guarantee down, because it is the kind of thing a Zod upgrade could silently drop:

```ts
  it('still applies the rule refinement through the extended schema', async () => {
    const api = mockApi({ getRules: async () => stored });
    await expect(tool.handler({ ...rule, actions: [{ op: 'set', field: 'category', value: 'Rent' }] }, { api, config: testConfig }))
      .rejects.toThrow();
    expect(api.updateRule).not.toHaveBeenCalled();
  });
```

- [ ] **Step 5: Run and confirm they pass**

Run: `npx vitest run tests/tools/create_rule.test.ts tests/tools/update_rule.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Register and declare**

`src/tools/index.ts`: import and append `createRule, updateRule`. `manifest.json`:

```json
    { "name": "create_rule", "description": "Create an automation rule" },
    { "name": "update_rule", "description": "Replace an automation rule (full object)" }
```

- [ ] **Step 7: Assert the final catalogue size**

Add to `tests/core/tool-registry.test.ts`:

```ts
import { allTools } from '../../src/tools/index.js';

describe('catalogue size', () => {
  it('exposes 11 read tools always and 29 in total with writes enabled', () => {
    expect(allTools).toHaveLength(29);
    expect(allTools.filter((t) => t.readOnly)).toHaveLength(11);
  });
});
```

Add `import { describe, it, expect } from 'vitest';` at the top if the file does not already have it.

- [ ] **Step 8: Run the suite and build**

Run: `npm test && npm run build`
Expected: PASS — 325. The catalogue test proves 29/11, and the manifest test proves the manifest agrees.

- [ ] **Step 9: Commit**

```bash
git add src/tools/create_rule.ts src/tools/update_rule.ts tests/tools/create_rule.test.ts tests/tools/update_rule.test.ts tests/core/tool-registry.test.ts src/tools/index.ts manifest.json
git commit -m "feat(tools): create_rule and update_rule complete the 29-tool catalogue"
```

---

### Task 14: Phase 3 verification, version bump and documentation

**Files:**
- Create: `scripts/verify/phase3-rules.ts`
- Modify: `package.json`, `manifest.json`, `README.md`, `README.es.md`, `docs/superpowers/notes/2026-07-29-classification-verification.md`

- [ ] **Step 1: Write the rules verification script**

Create `scripts/verify/phase3-rules.ts`, same standalone shape as the other two. It must:

1. `create_rule` with condition `payee contains "ZZZ Verify Payee"` and action `set category = <a real category id>`.
2. Import a transaction whose payee is `ZZZ Verify Payee` — **rules run on import, not on existing rows**, so use `create_transaction` and then check whether the category was applied. If it was not, retry the check through `api.importTransactions` (the path rules actually hook) and record which one triggers the rule. This is acceptance criterion 1 of the spec.
3. `update_rule` changing the target category, re-import, assert the new category is applied.
4. **Acceptance criterion 2**: create a rule whose action is `set payee = <a transfer payee id>`, import a matching transaction, and check whether the resulting transaction has a `transfer_id`. Record the answer: if rules cannot produce a transfer, the fallback documented in the spec is to post-process with `set_transaction_transfer`, and the `create_rule` description must say so.
5. `delete_rule` for every rule created; assert `get_rules` no longer lists them.
6. Delete every transaction created.

- [ ] **Step 2: Run it and record the answers**

```bash
ACTUAL_SERVER_URL=… ACTUAL_SERVER_PASSWORD=… ACTUAL_SYNC_ID=… npx tsx scripts/verify/phase3-rules.ts
```

Append the findings to the verification note. If criterion 2 fails, edit `src/tools/create_rule.ts`'s description in this task to document the limitation and point at `set_transaction_transfer`.

- [ ] **Step 3: Bump the version in lock-step**

In `package.json`: `"version": "2.2.0"`. In `manifest.json`: `"version": "2.2.0"`.

Run: `npx vitest run tests/bundle/manifest.test.ts`
Expected: PASS — `keeps its version in sync with package.json` is the test that makes this non-optional.

- [ ] **Step 4: Update both READMEs**

In `README.md` and `README.es.md`:

- The tool count changes from 16 (8+8) to **29 (11 read + 18 write)** everywhere it appears, including the `ENABLE_WRITE` explanation.
- The test count in both files changes to the real number printed by `npm test`.
- Add the new tools to the tool tables, grouped as: category groups and categories, payees and transfers, rules.
- Note in the write section that the classification tools sync to the server after each write, and that the delete tools require `confirm_delete: true` and offer archiving as the non-destructive default.

- [ ] **Step 5: Full verification before claiming done**

Run each and confirm the output before asserting success:

```bash
npm test
```
```bash
npm run build
```
```bash
npx tsx scripts/verify/phase1-taxonomy.ts
```

Expected: suite green, build clean, and the Phase 1 script still green against the live server after all three phases landed.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify/phase3-rules.ts package.json manifest.json README.md README.es.md docs/superpowers/notes/2026-07-29-classification-verification.md src/tools/create_rule.ts
git commit -m "feat: version 2.2.0 with the 29-tool catalogue documented and verified"
```

---

## Self-Review

**1. Spec coverage.**

| Spec requirement | Task |
|---|---|
| `create_category_group`, `update_category_group` | 3 |
| `delete_category_group` with confirmation + reassignment | 5 |
| `create_category`, `update_category` | 4 |
| `delete_category` with confirmation + reassignment | 5 |
| `get_payees`, `get_account_transfer_payee` | 7 |
| `set_transaction_transfer` | 8 |
| `update_transaction` gains `category_id: null` and `payee_id` | 9 |
| `get_rules`, `create_rule`, `update_rule`, `delete_rule` | 11–13 |
| `src/core/write-sync.ts` with `syncAfterWrite`, called by every new mutation | 1, then every mutation task |
| UUID validation on ids, including rule values | 11 (`superRefine`), and `ID` everywhere else |
| Unit↔cent conversion including rule amounts | 11 |
| New `messages.ts` entries, ES/EN, for every listed error | 1, 3, 4, 5, 7, 8, 9, 11, 12 |
| Echo of the affected object on every mutation | every mutation task |
| Version `2.1.0` → `2.2.0`, manifest catalogue at 29 tools | 14, enforced continuously by `manifest.test.ts` |
| Empirical verification per phase against the demo/real server | 6, 10, 14 |
| Open question 1 (transfer counterpart) | answered from source in "Verified API facts", proven at runtime in Task 10 |
| Open question 2 (group delete and children) | answered from source, proven in Task 6 |
| Open question 3 (rule setting a transfer payee) | Task 14 Step 1.4 |

**Deliberate narrowing, flagged:** the spec's rule schema allows `actions: [{ op: 'set', … }]` only, while Actual also supports `set-split-amount`, `link-schedule`, `prepend-notes`, `append-notes` and `delete-transaction`. Task 11 implements the spec (set-only) and Task 13's tool description does not promise the others. If the maintainer wants them, that is a scope change, not a bug.

**2. Placeholder scan.** Every code step carries the actual code. The three verification scripts (Tasks 6, 10, 14) are specified as numbered assertions rather than full source: they are throwaway scripts that must talk to a live server whose account and category ids are unknown when this plan is written, and they follow an existing model in the repo (`scripts/demo/reset-check.ts`). Every assertion they must make is enumerated.

**3. Type consistency.** `syncAfterWrite` returns `{ synced, error? }` and every consumer spreads the same `sync_pending` / `note` pair. `getGroupIndex` yields `GroupInfo` with `categoryIds`, used by Task 5 for both the count and the "destination is inside the group" guard. `getPayeeIndex` returns `{ byId, byTransferAccount, all }`, and Tasks 7, 8 and 9 each use a different member of that triple. `countTransactionsForCategories` takes an array in both delete tools. `ruleToApi` / `ruleFromApi` are named consistently across Tasks 11–13. The `category_id` guard in Task 9 checks `!== undefined && !== null`, matching the `.nullable().optional()` schema.

**One risk worth naming:** the running test counts quoted at each step (230, 235, 246, …) assume every test in this plan is written exactly as given. If an implementer adds a case, later counts drift. Treat them as a sanity signal, not an assertion — the binding check is "the suite is green and the new tests are in it".

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-29-classification-write-tools.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — tasks executed in this session with batch checkpoints.
