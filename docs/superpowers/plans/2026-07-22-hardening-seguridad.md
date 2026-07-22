# Actual-MCP — Plan 3: Endurecimiento de seguridad

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the findings of the 2026-07-22 security audit before republishing the repo.

**Architecture:** Surgical fixes across existing files. No new modules except a shared id schema in `src/core/types.ts`. Every fix is test-first.

**Tech Stack:** unchanged (TypeScript 6, Zod 4, Vitest).

## Global Constraints

- Every input that reaches an AQL `filter()` as an id MUST be `z.string().uuid()` — Actual's compiler interpolates `id`-typed values into SQL without escaping (`@actual-app/core/src/server/aql/compiler.ts:343`).
- Amounts stay in units at the boundary via `toCents`/`moneyFields`; no change to money semantics.
- Existing tests must keep passing; fixtures that use non-UUID ids (`'a1'`, `'c1'`, `'t1'`) will need real UUIDs — update them.
- Commits in Spanish, imperative, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- If a `git commit` fails with a 1Password signing error, retry once; if it still fails leave staged and report — never `--no-gpg-sign`.

---

### Task 1: Shared UUID schema for every id input

**Files:**
- Modify: `src/core/types.ts` (add `export const ID = z.string().uuid('Debe ser un UUID (usa get_accounts / get_categories / get_transactions para obtenerlos)');` and import zod there)
- Modify: every tool with an id input — `get_transactions.ts` (`account_id`, `category_id`), `update_transaction.ts` (`transaction_id`, `category_id`), `categorize_transactions.ts` (`transaction_id`, `category_id`), `split_transaction.ts` (`transaction_id`, `category_id` inside splits), `create_transaction.ts` (`account_id`, `category_id`, splits' `category_id`), `create_schedule.ts` (`account_id`), `set_budget.ts` (`category_id`), `transfer_budget.ts` (`from_category_id`, `to_category_id`), `update_category_note.ts` (`category_id`)
- Test: every affected test file (fixtures must use valid UUIDs)

**Interfaces:**
- Produces: `ID` exported from `src/core/types.ts`, used as `ID` (or `ID.optional()`) in place of `z.string()`/`z.string().min(1)` for id fields.

- [ ] **Step 1: Write the failing test** — new `tests/core/id-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ID } from '../../src/core/types.js';

describe('ID schema', () => {
  it('accepts a real UUID', () => {
    expect(ID.safeParse('571f5507-a390-43fa-b7bd-34bc46eacc98').success).toBe(true);
  });
  it('rejects SQL-injection style ids', () => {
    expect(ID.safeParse("aaa' OR '1'='1").success).toBe(false);
    expect(ID.safeParse("x') OR 1=1 --").success).toBe(false);
  });
  it('rejects AQL field references starting with $', () => {
    expect(ID.safeParse('$notes').success).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/id-schema.test.ts` — Expected: FAIL (ID not exported).

- [ ] **Step 3: Implement** — add to `src/core/types.ts`:

```ts
import { z } from 'zod';

/** Ids de Actual. UUID estricto: el compilador AQL interpola los valores de tipo
 *  `id` en el SQL sin escaparlos, así que la validación es la única barrera. */
export const ID = z.string().uuid('Debe ser un UUID (usa get_accounts / get_categories / get_transactions para obtenerlos)');
```

Then replace the id fields in the 9 tool files listed above (e.g. `account_id: ID`, `category_id: ID.optional()`), and update test fixtures to valid UUIDs. Use a distinct readable UUID per fixture entity, e.g. `'11111111-1111-4111-8111-111111111111'` for `a1`, `'22222222-...'` for `a2`, etc. — keep the mapping consistent within each test file.

- [ ] **Step 4: Run** `npm test` — Expected: ALL pass. Then `npm run build` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Validar ids como UUID: cierra la inyección AQL por valores de tipo id (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Validación referencial de categorías

**Files:**
- Create: `src/core/categories.ts`
- Modify: `src/tools/categorize_transactions.ts`, `src/tools/set_budget.ts`, `src/tools/create_transaction.ts`, `src/tools/transfer_budget.ts`
- Test: `tests/core/categories.test.ts` + the affected tool tests

**Interfaces:**
- Produces: `getCategoryIndex(api): Promise<Map<string, {id: string; name: string; group: string; is_income: boolean}>>` — flattens `api.getCategoryGroups()`.

- [ ] **Step 1: Write the failing test** — `tests/core/categories.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getCategoryIndex } from '../../src/core/categories.js';
import { mockApi } from '../helpers/mock-api.js';

const groups = [
  { id: 'g1', name: 'Comida', is_income: false, categories: [{ id: 'c1', name: 'Alimentacion' }] },
  { id: 'gi', name: 'Ingresos', is_income: true, categories: [{ id: 'ci', name: 'Nomina' }] },
];

describe('getCategoryIndex', () => {
  it('indexes every category with its group and income flag', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    const idx = await getCategoryIndex(api);
    expect(idx.get('c1')).toMatchObject({ name: 'Alimentacion', group: 'Comida', is_income: false });
    expect(idx.get('ci')?.is_income).toBe(true);
    expect(idx.has('noexiste')).toBe(false);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/core/categories.ts`:

```ts
/** Índice de categorías por id. La API de Actual NO valida que la categoría
 *  exista al escribir: un id inventado deja la transacción sin categoría
 *  silenciosamente, así que validamos antes de escribir. */
export async function getCategoryIndex(api: any) {
  const groups = await api.getCategoryGroups();
  const idx = new Map<string, { id: string; name: string; group: string; is_income: boolean }>();
  for (const g of groups ?? []) {
    for (const c of g.categories ?? []) {
      idx.set(c.id, { id: c.id, name: c.name, group: g.name, is_income: !!g.is_income });
    }
  }
  return idx;
}
```

Then wire it in:
- `categorize_transactions.ts`: fetch the index once; per item, if `category_id` is not in the index → push to `failed` with `` `categoría inexistente: ${u.category_id}` `` and do NOT write. Also add the resolved `category_name` to each `succeeded` entry (finding A5: bulk approvals must be readable).
- `set_budget.ts`: same per-operation check before `setBudgetAmount`; add `category_name` to `succeeded` entries.
- `create_transaction.ts`: validate `category_id` and every `splits[].category_id` before `addTransactions`; throw naming the offending id.
- `transfer_budget.ts`: it already reads the month; keep its existing not-found errors (they are equivalent).

- [ ] **Step 4: Run** `npm test` + `npm run build` — Expected: green. Update the affected tool tests so their mocks provide `getCategoryGroups` and assert the new failure mode (a bogus category id lands in `failed` / throws) and the new `category_name` echo.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Validar que la categoría existe antes de escribir y devolver su nombre en los lotes (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: transfer_budget atómico (con compensación)

**Files:**
- Modify: `src/tools/transfer_budget.ts`
- Test: `tests/tools/transfer_budget.test.ts`

- [ ] **Step 1: Write the failing test** — append:

```ts
it('compensates the source when the second leg fails', async () => {
  const api = mockApi({ getBudgetMonth: async () => month });
  const calls: any[] = [];
  (api.setBudgetAmount as any) = vi.fn(async (m: string, cat: string, cents: number) => {
    calls.push([m, cat, cents]);
    if (cat === 'c2') throw new Error('fallo de red');
  });
  await expect(tool.handler(
    { month: '2026-08', from_category_id: 'c1', to_category_id: 'c2', amount: 50 },
    { api, config: testConfig },
  )).rejects.toThrow(/no se ha movido|revertid/i);
  // origen restado y luego restaurado a su valor original
  expect(calls[0]).toEqual(['2026-08', 'c1', 30000]);
  expect(calls[calls.length - 1]).toEqual(['2026-08', 'c1', 35000]);
});
```

(the test file's `month` fixture must give `c1` budgeted 35000 and `c2` 5000; add `vi` to the imports)

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** — wrap the second leg:

```ts
    await api.setBudgetAmount(a.month, a.from_category_id, newFrom);
    try {
      await api.setBudgetAmount(a.month, a.to_category_id, newTo);
    } catch (err) {
      // Compensar: dejar el origen como estaba. Un traspaso a medias es peor
      // que uno no hecho, y el usuario no lo vería en el mensaje de error.
      try {
        await api.setBudgetAmount(a.month, a.from_category_id, from.budgeted ?? 0);
        throw new Error(`No se pudo abonar en destino (${(err as Error).message}); el traspaso se ha revertido y no se ha movido nada`);
      } catch (rollbackErr) {
        throw new Error(`No se pudo abonar en destino (${(err as Error).message}) y ADEMÁS falló la reversión del origen (${(rollbackErr as Error).message}); revisa ${from.name} en Actual`);
      }
    }
```

Careful: the inner `throw` must not be swallowed by its own catch — restructure so the rollback's success path throws the "revertido" error outside the inner try (e.g. use a boolean flag), and the test asserts the rollback call order.

- [ ] **Step 4: Run** `npm test` + build — Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Compensar transfer_budget si falla el abono: nunca dejar medio traspaso (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: split_transaction conserva metadatos y respeta conciliaciones

**Files:**
- Modify: `src/tools/split_transaction.ts`
- Test: `tests/tools/split_transaction.test.ts`

- [ ] **Step 1: Write the failing tests** — append:

```ts
it('carries imported_id, imported_payee, reconciled and schedule to the replacement', async () => {
  const api = apiForSplit({ ...original, imported_id: 'imp-1', imported_payee: 'MERCADONA S.A.', schedule: 'sch-1' });
  await tool.handler(
    { transaction_id: 't1', splits: [
      { amount: -120, category_id: 'c1' }, { amount: -60, category_id: 'c2' },
    ] },
    { api, config: testConfig },
  );
  expect((api.addTransactions as any).mock.calls[0][1][0]).toMatchObject({
    imported_id: 'imp-1', imported_payee: 'MERCADONA S.A.', schedule: 'sch-1',
  });
});

it('refuses to split a reconciled transaction unless forced', async () => {
  const api = apiForSplit({ ...original, reconciled: true });
  await expect(tool.handler(
    { transaction_id: 't1', splits: [
      { amount: -120, category_id: 'c1' }, { amount: -60, category_id: 'c2' },
    ] },
    { api, config: testConfig },
  )).rejects.toThrow(/conciliad/i);
  expect(api.addTransactions).not.toHaveBeenCalled();
});
```

(`apiForSplit` currently takes no argument — refactor it to accept an optional override object for the pre-read row, defaulting to `original`, and update its existing call sites.)

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** — in `split_transaction.ts`:

```ts
    if (orig.reconciled && !a.force) {
      throw new Error('La transacción está conciliada; dividirla rompería la conciliación. Vuelve a intentarlo con force: true si estás seguro');
    }
```

add `force: z.boolean().default(false).describe('Allow splitting a reconciled transaction')` to the input schema, and extend the copy:

```ts
    if (orig.imported_id) copy.imported_id = orig.imported_id;
    if (orig.imported_payee) copy.imported_payee = orig.imported_payee;
    if (orig.schedule) copy.schedule = orig.schedule;
    if (orig.reconciled) copy.reconciled = true;
```

- [ ] **Step 4: Run** `npm test` + build — Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Conservar metadatos al dividir y proteger transacciones conciliadas (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Localización determinista de la fila creada

**Files:**
- Modify: `src/tools/split_transaction.ts`, `src/tools/create_transaction.ts`
- Test: both tool test files

**Interfaces:**
- Both tools snapshot the candidate id set BEFORE `addTransactions` and take the set difference after, instead of relying on Actual's implicit `sort_order desc` ordering.

- [ ] **Step 1: Write the failing test** — in `create_transaction.test.ts`:

```ts
it('identifies the new row by set difference, not by ordering', async () => {
  let call = 0;
  const api = mockApi({
    runQuery: vi.fn(async () => {
      call += 1;
      if (call === 1) return { data: [{ id: 'pre-existente' }] };          // antes de crear
      if (call === 2) return { data: [{ id: 'pre-existente' }, { id: 'nuevo' }] }; // después
      return { data: [{ id: 'nuevo', date: '2026-07-22', account: 'a1', amount: -2350 }] };
    }),
  });
  const r: any = await tool.handler(
    { account_id: 'a1', date: '2026-07-22', amount: -23.5, payee_name: 'X' },
    { api, config: testConfig },
  );
  expect(r.transaction.id).toBe('nuevo');
});
```

(ids in fixtures must be valid UUIDs after Task 1 — use UUIDs consistent with that task's mapping)

- [ ] **Step 2: Run** — Expected: FAIL (current code takes `candidates[0]`).

- [ ] **Step 3: Implement** — extract a helper in each tool: run the candidate query once before the write, keep `new Set(ids)`, run it again after, and take the first id not in the set. If the difference is empty → keep the existing graceful fallback (`create_transaction`) or the existing "creado pero no localizado" error (`split_transaction`); if it has more than one id, use the first and note it. In `split_transaction` the pre-set additionally makes the `!== original` filter unnecessary — keep it as a belt-and-braces guard.

- [ ] **Step 4: Run** `npm test` + build — Expected: green (update the other tests' mock call counts, which now include the extra pre-read).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Localizar la fila creada por diferencia de conjuntos, sin depender del orden (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Anotaciones honestas, límites y permisos del directorio de datos

**Files:**
- Modify: `src/tools/set_budget.ts`, `src/tools/transfer_budget.ts`, `src/tools/update_category_note.ts`, `src/tools/update_transaction.ts` (annotations); `src/tools/split_transaction.ts`, `src/tools/create_transaction.ts`, `src/tools/create_schedule.ts`, `src/tools/get_transactions.ts`, `src/tools/get_spending_summary.ts` (limits); `src/core/actual-client.ts` (dir mode); `package.json` (dotenv pin, files allowlist)
- Test: `tests/core/actual-client.test.ts`, `tests/tools/update_category_note.test.ts`, plus the schema limits where cheap

- [ ] **Step 1: Write the failing tests**

`tests/core/actual-client.test.ts` (append):

```ts
it('creates the data dir with restrictive permissions', async () => {
  const api = mockApi();
  const mkdir = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
  const c = new ActualClient(api, cfg, () => 0);
  await c.ensureReady();
  expect(mkdir).toHaveBeenCalledWith(cfg.dataDir, { recursive: true, mode: 0o700 });
  mkdir.mockRestore();
});
```

(add `import * as fs from 'node:fs';` and `vi` to that file's imports)

`tests/tools/update_category_note.test.ts` (append):

```ts
it('returns the previous note and requires clear:true to wipe it', async () => {
  const api = mockApi({ getCategoryGroups: async () => groups, getNote: async () => ({ id: 'c1', note: '#template 350' }) });
  const r: any = await tool.handler({ category_id: 'c1', note: '#template 400' }, { api, config: testConfig });
  expect(r.previous_note).toBe('#template 350');
  await expect(tool.handler({ category_id: 'c1', note: '' }, { api, config: testConfig }))
    .rejects.toThrow(/clear/i);
});
```

- [ ] **Step 2: Run** both — Expected: FAIL.

- [ ] **Step 3: Implement**

- `src/core/actual-client.ts`: `fs.mkdirSync(this.config.dataDir, { recursive: true, mode: 0o700 });`
- `update_category_note.ts`: read the note BEFORE writing, return it as `previous_note`; require `clear: z.boolean().default(false)` when `note` is empty (throw otherwise); set `annotations: { destructiveHint: true, idempotentHint: true }`.
- `set_budget.ts`, `transfer_budget.ts`, `update_transaction.ts`: `destructiveHint: true` (they overwrite values; MCP's `false` means additive-only).
- Limits: `splits` `.max(20)` in `split_transaction.ts` and `create_transaction.ts`; `name`/`payee_name` `.max(200)` in `create_schedule.ts` and `payee_name` `.max(200)` in `update_transaction.ts`/`create_transaction.ts`; `recurrence.interval` `.max(52)` and `end_occurrences` `.max(520)`; `search_text` `.max(200)` in `get_transactions.ts`; in `get_spending_summary.ts` reject ranges longer than 5 years with a clear message.
- `package.json`: pin `"dotenv": "^17.3.1"` (replace `latest`) and add `"files": ["dist", "README.md", "README.es.md", "LICENSE"]`.

- [ ] **Step 4: Run** `npm test` + `npm run build` + `npm pack --dry-run --ignore-scripts` — Expected: tests green; the pack listing must contain `dist/` and NOT contain `tests/`, `docs/`, `.claude/`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Anotaciones honestas, límites de entrada, permisos 0700 del data dir y allowlist de publicación (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Documentar la postura de seguridad y cerrar

**Files:**
- Create: `SECURITY.md`
- Modify: `README.md`, `README.es.md`, `CLAUDE.md`
- Test: full suite

- [ ] **Step 1: Create `SECURITY.md`** (English): supported versions (latest `main`), how to report a vulnerability (GitHub private security advisories), and a "Security model" section stating: stdio transport is the trust boundary (no auth layer — never expose it to a network without adding one); credentials come from the MCP client's env; the local budget copy in `data/` is unencrypted and created `0700`; write tools require `ENABLE_WRITE=true` and are unregistered otherwise; there are no delete tools, but `split_transaction` replaces the transaction (new id); tool results include imported free text (payee names, notes) which should be treated as untrusted data, not instructions.

- [ ] **Step 2: README (both languages)** — add a short "Security" section linking `SECURITY.md`, with the three practical notes: keep `ENABLE_WRITE=false` unless you want writes, `data/` holds an unencrypted copy of your budget, and approve tool calls individually in your MCP client.

- [ ] **Step 3: `CLAUDE.md`** — generalize the first-person references ("finanzas familiares de Marco" → "finanzas familiares del usuario"; drop the "prueba manual de Marco" line) so the public repo reads as a general-purpose tool, and record in "Estado" that Plan 3 (endurecimiento) is done.

- [ ] **Step 4: Full gate** — `npm test`, `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Añadir SECURITY.md y documentar el modelo de seguridad en ambos README

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
