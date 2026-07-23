# Localized runtime messages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the server answer in Spanish (default) or English, chosen by one environment variable, with the compiler refusing to build if a message lacks its translation.

**Architecture:** A single catalogue module holds two objects, `es` and `en`. `es` is the reference type (`type Messages = typeof es`) and `en` is declared as `const en: Messages`, so a missing key or a changed parameter list is a compile error. Messages carrying data are functions. Tool handlers get the catalogue through `msg(config)`; Zod schemas, which are built before any config exists, carry `'@msg:<key>'` markers that `server.ts` resolves when it formats a `ZodError`.

**Tech Stack:** TypeScript 7, Zod 4, Vitest 4, `@modelcontextprotocol/sdk` 1.29.

## Global Constraints

- **Spanish is the default.** `MESSAGES_LANG` unset ⇒ `es`. Any existing install must behave exactly as before.
- **Existing assertions must not be edited.** Tests assert Spanish strings (`/campo/i`, `/split/i`, `/presupuesto.*cerr/i`). If a task needs to change one, the default moved by accident — stop and fix the code instead.
- **Fixtures may gain the new field.** Two files declare a full `Config` by hand and stop compiling once `messagesLang` is required: `tests/helpers/mock-api.ts:4` (`testConfig`) and `tests/core/actual-client.test.ts:13` (`cfg`). Adding `messagesLang: 'es'` to both is expected and does not weaken anything — it pins the default the surrounding tests already assume. This is the only permitted edit to an existing test file besides appending new tests.
- **Spanish texts are copied verbatim** from the current source. Do not reword while moving them; a reworded message silently breaks a passing test.
- **Config-validation messages stay Spanish.** The four in `src/core/config.ts` run while producing the config, so no language is known yet. Do not touch them.
- **stderr stays Spanish.** The nine `console.error` calls are not localized.
- **Tool and parameter descriptions stay English.** They are the LLM-facing contract and are mirrored in `manifest.json`.
- Run the full suite with `npm test`; typecheck with `npx tsc --noEmit`. Both must be clean before every commit.

---

### Task 1: The `MESSAGES_LANG` switch

**Files:**
- Modify: `src/core/config.ts:10-52`
- Modify: `manifest.json` (`user_config`, `server.mcp_config.env`)
- Test: `tests/core/config.test.ts`

**Interfaces:**
- Produces: `Config.messagesLang: 'es' | 'en'` — every later task reads this field.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/config.test.ts` (reuse the file's existing helper for a valid env; if it builds env inline, copy that shape):

```ts
it('defaults the message language to Spanish', () => {
  expect(loadConfig(validEnv()).messagesLang).toBe('es');
});
it('accepts English', () => {
  expect(loadConfig({ ...validEnv(), MESSAGES_LANG: 'en' }).messagesLang).toBe('en');
});
it('rejects an unsupported language naming the accepted ones', () => {
  expect(() => loadConfig({ ...validEnv(), MESSAGES_LANG: 'fr' })).toThrow(/es.*en|en.*es/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/core/config.test.ts`
Expected: FAIL — `messagesLang` is `undefined`, and the third test does not throw.

- [ ] **Step 3: Add the variable**

In `src/core/config.ts`, inside `envSchema`, after the `CURRENCY` line:

```ts
  MESSAGES_LANG: z.enum(['es', 'en'], { message: "MESSAGES_LANG debe ser 'es' o 'en'" }).default('es'),
```

Add to the `Config` interface: `messagesLang: 'es' | 'en';`
Add to the returned object in `loadConfig`: `messagesLang: e.MESSAGES_LANG,`

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run tests/core/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the manifest**

In `manifest.json`, add to `server.mcp_config.env`:

```json
"MESSAGES_LANG": "${user_config.messages_lang}"
```

and to `user_config`:

```json
"messages_lang": {
  "type": "string",
  "title": "Message language",
  "description": "Language of error messages the server returns: es or en",
  "required": true,
  "default": "es"
}
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. `tests/bundle/manifest.test.ts` already asserts every `user_config` key is referenced exactly once in `mcp_config.env`; it now covers the new field.

- [ ] **Step 7: Commit**

```bash
git add src/core/config.ts tests/core/config.test.ts manifest.json
git commit -m "Añadir MESSAGES_LANG con el español por defecto (TDD)"
```

---

### Task 2: The catalogue, proven end to end

**Files:**
- Create: `src/core/messages.ts`
- Create: `tests/core/messages.test.ts`
- Modify: `src/core/server.ts:28-34,62-70`
- Test: `tests/core/server.test.ts`

**Interfaces:**
- Consumes: `Config.messagesLang` (Task 1).
- Produces:
  - `type Messages` — the catalogue shape.
  - `export function msg(config: Config): Messages`
  - `export function messagesFor(lang: 'es' | 'en'): Messages`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/messages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { messagesFor, msg } from '../../src/core/messages.js';
import { testConfig } from '../helpers/mock-api.js';

describe('catálogo de mensajes', () => {
  it('devuelve el español por defecto', () => {
    expect(msg({ ...testConfig, messagesLang: 'es' }).invalidInput).toBe('Entrada inválida');
  });
  it('devuelve el inglés cuando se pide', () => {
    expect(msg({ ...testConfig, messagesLang: 'en' }).invalidInput).toBe('Invalid input');
  });
  it('tiene exactamente las mismas claves en los dos idiomas', () => {
    // El compilador ya lo exige; esto protege de un `any` que se cuele.
    expect(Object.keys(messagesFor('en')).sort()).toEqual(Object.keys(messagesFor('es')).sort());
  });
  it('mantiene el tipo de cada entrada entre idiomas', () => {
    const es = messagesFor('es'), en = messagesFor('en');
    for (const k of Object.keys(es) as (keyof typeof es)[]) {
      expect(typeof en[k], `${k} cambia de tipo entre idiomas`).toBe(typeof es[k]);
    }
  });
});
```

`tests/core/server.test.ts` only exercises `buildToolResult`, the pure exported function —
it never builds an `McpServer`. Follow that pattern instead of instantiating one: extract
the invalid-input formatting into a pure function and test it directly.

Append to `tests/core/server.test.ts`:

```ts
import { invalidInputResult } from '../../src/core/server.js';
import { messagesFor } from '../../src/core/messages.js';

describe('invalidInputResult', () => {
  const issues = [{ path: ['date'], message: 'Fecha en formato YYYY-MM-DD' }];
  it('titula el error en español por defecto', () => {
    const r: any = invalidInputResult(issues, messagesFor('es'));
    expect(JSON.parse(r.content[0].text).error.message).toBe('Entrada inválida');
  });
  it('titula el error en inglés cuando se pide', () => {
    const r: any = invalidInputResult(issues, messagesFor('en'));
    expect(JSON.parse(r.content[0].text).error.message).toBe('Invalid input');
  });
  it('conserva la ruta del campo en el hint', () => {
    const r: any = invalidInputResult(issues, messagesFor('es'));
    expect(JSON.parse(r.content[0].text).error.hint).toContain('date:');
  });
  it('marca el resultado como error', () => {
    expect((invalidInputResult(issues, messagesFor('es')) as any).isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/core/messages.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/messages.js'`.

- [ ] **Step 3: Create the catalogue and wire `server.ts`**

Create `src/core/messages.ts`:

```ts
// messages.ts — mensajes de runtime en los dos idiomas.
// El español es el tipo de referencia: `const en: Messages` obliga al compilador a
// exigir cada clave y cada firma. Los mensajes con datos son funciones.
// NO entran aquí: los logs a stderr ni la validación de config (que corre antes
// de que exista config y por eso no puede consultar el idioma).
import type { Config } from './config.js';

const es = {
  invalidInput: 'Entrada inválida',
};

export type Messages = typeof es;

const en: Messages = {
  invalidInput: 'Invalid input',
};

const CATALOGUES: Record<'es' | 'en', Messages> = { es, en };

export function messagesFor(lang: 'es' | 'en'): Messages {
  return CATALOGUES[lang];
}

export function msg(config: Config): Messages {
  return messagesFor(config.messagesLang);
}
```

In `src/core/server.ts`, extract the invalid-input branch into a pure exported function next
to `buildToolResult`, keeping `errorResult` private:

```ts
import { msg, type Messages } from './messages.js';

/** Pura y exportada para poder testearla sin montar un McpServer (como buildToolResult). */
export function invalidInputResult(
  issues: { path: (string | number)[]; message: string }[],
  m: Messages,
) {
  return errorResult(
    'invalid_input',
    m.invalidInput,
    issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  );
}
```

and call it from the handler wrapper, replacing the literal at `server.ts:62-68`:

```ts
if (err instanceof ZodError) return invalidInputResult(err.issues, msg(deps.config));
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run tests/core/messages.test.ts tests/core/server.test.ts`
Expected: PASS, with no placeholder assertion left in the file.

- [ ] **Step 5: Full suite**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/messages.ts src/core/server.ts tests/core/messages.test.ts tests/core/server.test.ts
git commit -m "Añadir el catálogo de mensajes verificado por el compilador (TDD)"
```

---

### Task 3: Message keys inside Zod schemas

**Files:**
- Modify: `src/core/messages.ts`
- Modify: `src/core/server.ts` (ZodError formatting)
- Modify: `src/core/types.ts:7-9`
- Modify: `src/tools/get_transactions.ts:5`, `src/tools/update_transaction.ts:7`, `src/tools/get_spending_summary.ts:5`, `src/tools/create_schedule.ts:5`, `src/tools/create_transaction.ts:7`
- Modify: `src/tools/get_budget_month.ts:6`, `src/tools/set_budget.ts:6`, `src/tools/transfer_budget.ts:5`
- Test: `tests/core/messages.test.ts`, `tests/core/server.test.ts`

**Interfaces:**
- Consumes: `Messages`, `messagesFor` (Task 2).
- Produces:
  - `export function key<K extends keyof Messages>(k: K): string` — returns `'@msg:<k>'`.
  - `export function resolveKeys(text: string, m: Messages): string` — replaces every `@msg:<key>` marker; leaves other text untouched.

Three distinct texts cover nine sites: `dateFormat` (5 sites), `monthFormat` (3 sites), `mustBeUuid` (1 site, in `types.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/messages.test.ts`:

```ts
import { key, resolveKeys, messagesFor } from '../../src/core/messages.js';

describe('claves de mensaje en esquemas', () => {
  it('marca la clave de forma reconocible', () => {
    expect(key('dateFormat')).toBe('@msg:dateFormat');
  });
  it('resuelve la clave al idioma pedido', () => {
    expect(resolveKeys(key('dateFormat'), messagesFor('es'))).toBe('Fecha en formato YYYY-MM-DD');
    expect(resolveKeys(key('dateFormat'), messagesFor('en'))).toBe('Date in YYYY-MM-DD format');
  });
  it('deja intacto un texto que no es una clave', () => {
    expect(resolveKeys('Invalid input', messagesFor('en'))).toBe('Invalid input');
  });
  it('resuelve una clave incrustada en un texto mayor', () => {
    expect(resolveKeys(`date: ${key('dateFormat')}`, messagesFor('en'))).toBe('date: Date in YYYY-MM-DD format');
  });
  it('deja la marca tal cual si la clave no existe, en vez de romper', () => {
    expect(resolveKeys('@msg:noExiste', messagesFor('es'))).toBe('@msg:noExiste');
  });
  it('no deja ninguna marca sin resolver en los esquemas reales', async () => {
    const { allTools } = await import('../../src/tools/index.js');
    const declared = JSON.stringify(allTools.map((t) => t.inputSchema));
    for (const found of declared.match(/@msg:[a-zA-Z]+/g) ?? []) {
      const k = found.slice('@msg:'.length);
      expect(Object.keys(messagesFor('es'))).toContain(k);
    }
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/core/messages.test.ts`
Expected: FAIL — `key` and `resolveKeys` are not exported.

- [ ] **Step 3: Implement and migrate the nine sites**

Add to the `es` catalogue (and the matching `en` entries):

```ts
  dateFormat: 'Fecha en formato YYYY-MM-DD',
  monthFormat: 'Mes en formato YYYY-MM',
  mustBeUuid: 'Debe ser un UUID (usa get_accounts / get_categories / get_transactions para obtenerlos)',
```

```ts
  dateFormat: 'Date in YYYY-MM-DD format',
  monthFormat: 'Month in YYYY-MM format',
  mustBeUuid: 'Must be a UUID (use get_accounts / get_categories / get_transactions to obtain them)',
```

Add to `src/core/messages.ts`:

```ts
const MARKER = '@msg:';

/** Marca una clave para resolverla al formatear el error: los esquemas Zod se
 *  construyen al cargar el módulo, antes de que exista config. */
export function key<K extends keyof Messages>(k: K): string {
  return `${MARKER}${k}`;
}

export function resolveKeys(text: string, m: Messages): string {
  return text.replace(/@msg:([a-zA-Z]+)/g, (whole, k: string) => {
    const value = (m as Record<string, unknown>)[k];
    return typeof value === 'string' ? value : whole;
  });
}
```

In `src/core/server.ts`, resolve the marker inside `invalidInputResult` (Task 2 built it):

```ts
    issues.map((i) => `${i.path.join('.')}: ${resolveKeys(i.message, m)}`).join('; '),
```

Add a test for it alongside the Task 2 ones, since the fixture message is now a key:

```ts
it('resuelve la clave del esquema al idioma del catálogo', () => {
  const r: any = invalidInputResult([{ path: ['date'], message: key('dateFormat') }], messagesFor('en'));
  expect(JSON.parse(r.content[0].text).error.hint).toContain('Date in YYYY-MM-DD format');
});
```

Replace the nine literals with `key(...)`, e.g. in `src/tools/get_transactions.ts:5`:

```ts
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, key('dateFormat'));
```

and in `src/core/types.ts`:

```ts
export const ID = z.string().uuid(key('mustBeUuid'));
```

- [ ] **Step 4: Run and watch them pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. Existing tests asserting `/UUID/i` or the date message still pass because
they go through `server.ts`, which resolves the marker into Spanish by default. **If any
existing test now fails because it sees a raw `@msg:` marker, that test asserts on a path
that does not resolve keys — fix the code path, not the test.**

- [ ] **Step 5: Commit**

```bash
git add src/core/messages.ts src/core/server.ts src/core/types.ts src/tools/
git commit -m "Resolver los mensajes de los esquemas Zod por clave (TDD)"
```

---

### Task 4: Core messages

**Files:**
- Modify: `src/core/messages.ts`
- Modify: `src/core/actual-client.ts` (2 throws), `src/core/tool-registry.ts` (1 throw), `src/core/categories.ts:28-30`
- Test: `tests/core/actual-client.test.ts` (read only — do not edit), `tests/core/messages.test.ts`

**Interfaces:**
- Consumes: `msg`, `Messages` (Task 2).
- Produces: catalogue keys `budgetClosed`, `budgetOpenFailed`, `categoryNotFound`, plus whatever `tool-registry.ts` needs.

`categoryNotFound(id)` currently lives in `categories.ts` and is imported by five tools. Keep
that export as the single call site, changing its signature to take the catalogue:
`categoryNotFound(m: Messages, id: string): string`. Update the five importers accordingly
(`create_transaction.ts`, `update_transaction.ts`, `categorize_transactions.ts`,
`set_budget.ts`, `transfer_budget.ts` — confirm with `grep -rn categoryNotFound src/`).

- [ ] **Step 1: Write the failing test**

Append to `tests/core/messages.test.ts`:

```ts
it('traduce los mensajes con datos conservando los parámetros', () => {
  const es = messagesFor('es'), en = messagesFor('en');
  expect(es.categoryNotFound('abc')).toContain('abc');
  expect(en.categoryNotFound('abc')).toContain('abc');
  expect(en.categoryNotFound('abc')).not.toBe(es.categoryNotFound('abc'));
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/core/messages.test.ts`
Expected: FAIL — `categoryNotFound` is not a property of the catalogue.

- [ ] **Step 3: Move the three core messages**

Add to `es` (verbatim from the current source) and translate in `en`:

```ts
  categoryNotFound: (id: string) => `categoría inexistente: ${id} (usa get_categories para ver los ids válidos)`,
  budgetClosed: (cause: string, dataDir: string) =>
    'El presupuesto de Actual está cerrado y no se pudo volver a abrir ' +
    `(causa original: ${cause}). Reinicia el servidor MCP; si el error persiste, ` +
    `revisa el log de arranque y que ${dataDir} sea accesible.`,
```

```ts
  categoryNotFound: (id: string) => `unknown category: ${id} (use get_categories to list valid ids)`,
  budgetClosed: (cause: string, dataDir: string) =>
    'The Actual budget is closed and could not be reopened ' +
    `(original cause: ${cause}). Restart the MCP server; if it persists, ` +
    `check the startup log and that ${dataDir} is readable.`,
```

Then update the call sites. `ActualClient` does not receive a `Config`-derived catalogue
today — it holds `this.config`, so use `msg(this.config)` inside the method. In
`categories.ts`, change the helper to `categoryNotFound(m: Messages, id: string)` and have
it return `m.categoryNotFound(id)`; update the five importers to pass `msg(config)`.

Add the remaining core throws (`tool-registry.ts`, the second `actual-client.ts` throw) as
catalogue entries the same way, copying their Spanish verbatim.

- [ ] **Step 4: Run and watch it pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, including `tests/core/actual-client.test.ts` untouched — it asserts
`/presupuesto.*cerr/i` and `/getPrefs/`, which the Spanish default still satisfies.

- [ ] **Step 5: Commit**

```bash
git add src/core tests/core/messages.test.ts
git commit -m "Llevar los mensajes del core al catálogo (TDD)"
```

---

### Task 5: `split_transaction` and `update_transaction`

**Files:**
- Modify: `src/core/messages.ts`, `src/tools/split_transaction.ts` (8 throws + 1 `note`), `src/tools/update_transaction.ts` (5 throws + 1 `note`)
- Test: `tests/tools/split_transaction.test.ts`, `tests/tools/update_transaction.test.ts` (read only — do not edit)

**Interfaces:**
- Consumes: `msg`, `Messages` (Task 2).
- Produces: catalogue keys for both tools.

These two carry the densest and most safety-critical wording (reconciled transactions,
split parents/children). Copy each Spanish string verbatim; the existing tests assert on
fragments of them (`/split/i`, `/conciliada/i`, `/campo/i`).

- [ ] **Step 1: Write the failing test**

Append to `tests/tools/update_transaction.test.ts` — this is a **new** test, not an edit of
an existing one:

```ts
it('responde en inglés cuando se configura así', async () => {
  const api = mockApi({ runQuery: async () => ({ data: [] }) });
  await expect(tool.handler(
    { transaction_id: T_MISSING, notes: 'x' },
    { api, config: { ...testConfig, messagesLang: 'en' } },
  )).rejects.toThrow(/not found/i);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/tools/update_transaction.test.ts`
Expected: FAIL — the message is still Spanish (`Transacción no encontrada`).

- [ ] **Step 3: Move both tools' messages**

For every `throw new Error('…')` and every `note:` literal in the two files, add a catalogue
entry keyed after the condition (`txNotFound`, `splitChild`, `splitParentAmount`,
`alreadySplit`, `reconciledNeedsForce`, `partsDoNotSum`, `echoPending`, `ambiguousNewRow`, …),
copy the Spanish verbatim, write the English, and replace the literal with
`m.<key>(...)` where `const m = msg(config)` at the top of the handler.

`ToolContext` gives `{ api, config }`, so `const m = msg(ctx.config)` needs the handler
signature to destructure `config` — several handlers currently destructure only `{ api }`.
Add `config` to the destructuring where missing.

- [ ] **Step 4: Run and watch it pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, with every pre-existing Spanish assertion in both test files untouched.

- [ ] **Step 5: Commit**

```bash
git add src/core/messages.ts src/tools/split_transaction.ts src/tools/update_transaction.ts tests/tools/update_transaction.test.ts
git commit -m "Llevar los mensajes de split y update al catálogo (TDD)"
```

---

### Task 6: The remaining write tools

**Files:**
- Modify: `src/core/messages.ts`
- Modify: `src/tools/transfer_budget.ts` (4 throws), `src/tools/categorize_transactions.ts` (3 `error:` + 1 `note`), `src/tools/create_transaction.ts` (2 throws + 1 `note`), `src/tools/update_category_note.ts` (2 throws), `src/tools/create_schedule.ts` (1 throw)
- Test: `tests/tools/categorize_transactions.test.ts` (new test only)

**Interfaces:**
- Consumes: `msg`, `Messages` (Task 2).

- [ ] **Step 1: Write the failing test**

Append to `tests/tools/categorize_transactions.test.ts`:

```ts
it('reporta los fallos por ítem en el idioma configurado', async () => {
  const api = mockApi({
    getCategoryGroups: vi.fn(async () => GROUPS),
    runQuery: async () => ({ data: [] }), // ninguna transacción existe
  });
  const r: any = await tool.handler(
    { updates: [{ transaction_id: T1, category_id: C1 }] },
    { api, config: { ...testConfig, messagesLang: 'en' } },
  );
  expect(r.failed[0].error).toMatch(/not found/i);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/tools/categorize_transactions.test.ts`
Expected: FAIL — the message is still `transacción no encontrada`.

- [ ] **Step 3: Move the messages**

Same procedure as Task 5, for the five files listed. Note that
`categorize_transactions.ts` builds its strings inside a loop; hoist `const m = msg(config)`
above the loop rather than calling `msg` per item.

- [ ] **Step 4: Run and watch it pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Verify nothing was left behind**

Run:

```bash
grep -rnE "throw new Error\('[^']*[áéíóúñ¡¿]" src/ | grep -v 'src/core/config.ts'
```

Expected: no output. Any hit is a message that never reached the catalogue.

- [ ] **Step 6: Commit**

```bash
git add src/core/messages.ts src/tools tests/tools/categorize_transactions.test.ts
git commit -m "Llevar al catálogo los mensajes de las tools de escritura restantes (TDD)"
```

---

### Task 7: English contract cleanup and documentation

**Files:**
- Modify: `src/tools/categorize_transactions.ts:10`
- Modify: `README.md` (environment variables table, Claude Desktop form list), `README.es.md` (same two places)
- Test: full suite

- [ ] **Step 1: Translate the stray parameter description**

`src/tools/categorize_transactions.ts:10` describes its parameter in Spanish while every
other description is English:

```ts
})).min(1).max(50).describe('Max 50 per call; each item applies independently'),
```

- [ ] **Step 2: Document the variable**

In `README.md`, add to the environment variables table:

| `MESSAGES_LANG` | No | `es` | Language of the server's error messages: `es` or `en` |

and to the Claude Desktop form list under "Fill the form":

- **Message language** — `es` or `en`; defaults to `es`

Mirror both in `README.es.md`, in Spanish.

- [ ] **Step 3: Verify both languages end to end**

Run:

```bash
npm test && npx tsc --noEmit
MESSAGES_LANG=en npm run smoke   # requires .env with real credentials
```

Expected: suite green; the smoke run's messages (if any error surfaces) in English.

- [ ] **Step 4: Commit**

```bash
git add src/tools/categorize_transactions.ts README.md README.es.md
git commit -m "Documentar MESSAGES_LANG y devolver al inglés la descripción que se coló"
```

---

## Verification checklist

- [ ] `MESSAGES_LANG` unset behaves exactly as before this plan (Spanish).
- [ ] No pre-existing test file was edited, only appended to.
- [ ] `grep -rn "@msg:" src/` shows markers only inside Zod schema definitions.
- [ ] `npx tsc --noEmit` clean — this is what proves the English catalogue is complete.
- [ ] `manifest.json` version still matches `package.json` (existing test).
