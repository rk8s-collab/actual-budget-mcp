# Localized runtime messages — Design Spec

**Date:** 2026-07-23
**Status:** Approved by Marco (design review)
**Language note:** Spec in English (publication-ready). Human digest in Spanish lives in the personal Obsidian vault (`Proyectos/Actual-MCP/`).

## Overview

Every message this server returns at runtime is written in Spanish, while the tool contract
(tool names, tool descriptions, parameter descriptions) and both READMEs are in English. An
English-speaking user installing the bundle gets English documentation and Spanish errors.

Spanish stays as the default on purpose: it is what distinguishes this server from the other
Actual Budget MCP servers, and the maintainer wants users to notice it. What this spec adds
is a way to opt out — one variable, two catalogues, checked by the compiler.

### Goals

- Runtime messages available in Spanish and English.
- **Spanish by default.** No configuration change makes a current install switch language.
- Adding an untranslated message must be a **compile error**, not a runtime surprise.

### Non-goals

- Localizing tool and parameter descriptions. They are the contract the LLM reads; English
  serves that better, and they are duplicated in `manifest.json` under a consistency test.
- Localizing stderr logs. They exist for debugging and the user never sees them.
- Localizing Zod's own built-in messages (`Invalid input`, `Required`). See Limitations.
- Additional languages. The catalogue shape admits them; nothing else is designed for it.

## Inventory

Measured on `main` at `c9eec20`:

| Class | Count | Localized |
|---|---|---|
| `throw new Error(...)` in tool and core code (9 files) | 26 | yes |
| `error:` / `note:` fields in tool responses | 7 | yes |
| Custom messages inside tool-input Zod schemas (9 sites, 3 distinct texts) | 9 | yes |
| `errorResult` strings in `server.ts` | 2 | yes |
| Config-validation messages in `config.ts` | 4 | **no** — see below |
| `console.error` to stderr | 9 | no — Spanish, fixed |
| **Total localized** | **44** | |

**Config validation cannot be localized.** The four messages in `config.ts` (three Zod
messages plus the `Configuración inválida:` prefix) fire while *producing* the config, so
no language setting exists yet to consult. They stay Spanish. This is a hard constraint of
the design, not an omission.

One parameter description is in Spanish by oversight
(`categorize_transactions.ts`, `'Máx. 50 por llamada; …'`). It is part of the English
contract, so it gets translated **to English** rather than added to the catalogue.

## Design

### 1. Configuration

New environment variable **`MESSAGES_LANG`**, accepting `es` or `en`, defaulting to `es`.

It is deliberately **not** called `LANG`: that is a standard POSIX variable inherited from
the environment, which would make the server's language depend on who launched it.

It is also deliberately independent of `LOCALE`. `LOCALE` defaults to `en-US` and drives
number formatting; binding messages to it would make a default install speak English, which
is the opposite of the intent.

`loadConfig` validates it with Zod like every other variable and fails at startup on an
unknown value, naming the accepted ones. `manifest.json` gains a `user_config.messages_lang`
field wired to the variable — the existing test that requires every form field to map to an
env var the server reads makes this impossible to forget.

### 2. The catalogue

`src/core/messages.ts`. Spanish is the reference type; English is declared against it:

```ts
const es = {
  txNotFound: 'transacción no encontrada',
  categoryNotFound: (id: string) => `Categoría inexistente: ${id}`,
  budgetClosed: (cause: string, dataDir: string) => `El presupuesto de Actual está cerrado…`,
};

export type Messages = typeof es;

const en: Messages = { /* missing key or changed signature ⇒ does not compile */ };
```

Messages carrying data are functions. The compiler rejects a missing key outright, which is
the mechanism that satisfies the third goal; everything else in this spec is plumbing around
it.

It does **not** catch everything, and the gap is worth stating so nobody trusts it further
than it goes: TypeScript accepts a function with *fewer* parameters than its type, so an
English translation that silently drops the transaction id — `categoryNotFound: () => '…'`
— compiles clean. A runtime test in `tests/core/messages.test.ts` compares `Function.length`
between catalogues to close that hole.

### 3. Reaching the tools

A helper `msg(config)` returns the catalogue for the configured language. Tool handlers call
it inside the handler.

`ToolContext` is **not** extended. Adding a required field there would force a change in the
~87 tool tests that build `{ api, config }` by hand, and that churn buys nothing: the
language is already derivable from `config`.

### 4. Zod messages

Zod messages are fixed when the schema is defined — at module load, before any config
exists. Zod 4 accepts the error parameter as a **function**, evaluated at parse time:

```ts
export const ID = z.string().uuid({ error: () => activeMessages().mustBeUuid });
```

This is not a stylistic choice. **The MCP SDK validates a tool's `inputSchema` before it
invokes the handler** (`server/mcp.js`, `validateToolInput`) and turns a failure into its own
`McpError`, which never reaches our code:

```js
const parseResult = await safeParseAsync(schemaToParse, args);
if (!parseResult.success) throw new McpError(ErrorCode.InvalidParams, ...);
```

So any scheme that resolves messages inside our handler or our error formatter leaves schema
errors untranslated — and, worse, leaks whatever placeholder it used to the client. A
deferred function is evaluated by Zod itself wherever the parse happens, so the SDK's own
validation comes out localized with no cooperation from us.

The consequence is that the language for these messages lives at module scope:
`setMessageLanguage(config.messagesLang)` runs once at startup and `activeMessages()` reads
it. This is the single place where the language is not threaded through `config`. It is
honest rather than sloppy: a server process has exactly one config, so the language is
genuinely process-global. Everything outside schemas keeps using `msg(config)`.

### Limitations

Messages Zod generates itself (`Invalid input`, `Required`) stay in English. Translating
them would require a global `errorMap`, and the cost is not worth it for strings the LLM
handles well in either language.

## Testing

The existing suite is the first safety net: current tests assert Spanish messages
(`/campo/i`, `/split/i`, `/presupuesto.*cerr/i`) and must keep passing **untouched**,
because `es` is the default. A test that needed editing would mean the default moved.

New tests:

- Key parity between catalogues at runtime, guarding against an `any` slipping past the
  compile-time check.
- A static detector requires that schema messages use `{ error: () => activeMessages()… }`
  instead of a fixed string — it walks `.regex()`/`.uuid()`/`.refine()` call sites in
  `src/tools` and `src/core/types.ts` (including nested schemas) and fails if any message
  argument is not a deferred function that actually invokes `activeMessages()`.
- `loadConfig` defaults to `es`, accepts `en`, and rejects anything else with a message
  naming the accepted values.
- The same already-built schema changes language when the active language changes:
  parsing against it before and after `setMessageLanguage(...)` yields the message from
  each respective catalogue, proving the deferred function reads `activeMessages()` live
  rather than capturing a snapshot at schema-construction time.
- One tool asserted end-to-end in both languages, to prove the wiring from config to
  message actually holds.

## Compatibility

No behaviour changes for anyone who does not set `MESSAGES_LANG`. Installed extensions keep
their configuration; the new form field appears with `es` preselected on the next install or
reconfigure.
