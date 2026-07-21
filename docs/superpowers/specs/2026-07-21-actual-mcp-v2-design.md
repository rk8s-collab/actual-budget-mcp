# Actual-MCP v2 — Design Spec

**Date:** 2026-07-21
**Status:** Approved by Marco (design review, sections 1–4)
**Language note:** Spec in English (publication-ready). Human digest in Spanish lives in the personal Obsidian vault (`Proyectos/Actual-MCP/`).

## Overview

Actual-MCP v2 evolves the existing read-only MCP server for [Actual Budget](https://actualbudget.org) into a read/write financial assistant, purpose-built for LLM consumption. It replaces the v1 JavaScript implementation (6 read-only tools, stale data, per-account loops) with a TypeScript server exposing 16 tools.

**Design pillars** (born from testing competing MCP servers against real data):

1. **Correct financial semantics** — transfers never pollute spending summaries; net worth includes off-budget accounts (pensions, funds, mortgage).
2. **Amounts converted at the boundary** — the server always converts Actual's integer cents to currency units (both directions). The LLM never multiplies or divides by 100.
3. **Compact outputs** — resolved names instead of UUIDs, pagination everywhere, aggregates over raw dumps.
4. **Fresh data** — sync before reads, with a TTL to avoid per-call latency.
5. **Real split transactions** — via the official `subtransactions` API; no published MCP server exposes this.

### Goals

- Spending analysis, budget tracking, and full net worth (read).
- Conversational categorization, transaction splitting, recurring transactions, and budget preparation (write).

### Non-goals

- No delete operations of any kind.
- No Actual rules management (the user considers Actual's rule automation insufficient; Claude replaces it conversationally).
- No HTTP transport in this iteration (architecture leaves the seam; see Future work).

## Architecture

```
src/
├── core/
│   ├── config.ts          # Env vars validated with Zod at startup
│   ├── actual-client.ts   # Singleton: init + sync strategy
│   ├── money.ts           # cents<->units conversion + Intl formatting
│   ├── tool-registry.ts   # Auto-registration of src/tools/*
│   └── server.ts          # McpServer wiring + transport selection
├── tools/                 # One tool per file (16)
└── index.ts               # Entry point: stdio by default
tests/                     # Vitest
```

- **Stack:** TypeScript 6.x, Zod 4.x (single source: input validation + inferred types + MCP tool declaration), `@modelcontextprotocol/sdk` 1.29.x, `@actual-app/api` 26.7+.
- **Transport:** stdio (Claude Desktop). The core never assumes a transport; `index.ts` wires it, leaving room for Streamable HTTP later without touching tools.
- **stdout is sacred:** all logging to stderr (v1 lesson, kept).

### Configuration (env vars)

| Var | Required | Default | Notes |
|---|---|---|---|
| `ACTUAL_SERVER_URL` | yes | — | Actual server URL |
| `ACTUAL_SERVER_PASSWORD` | yes | — | Server password |
| `ACTUAL_SYNC_ID` | yes | — | Budget Sync ID |
| `ACTUAL_DATA_DIR` | no | `./data` | Local budget cache |
| `LOCALE` | no | `en-US` | For `amount_formatted` fields (Marco: `es-ES`) |
| `CURRENCY` | no | `USD` | ISO 4217 (Marco: `EUR`) |
| `SYNC_TTL_SECONDS` | no | `60` | Min seconds between syncs |
| `ENABLE_WRITE` | no | `false` | Write tools are not registered unless `true` |

Config is validated with Zod at startup; missing/invalid vars produce a clear stderr message and exit.

### Sync strategy

On every tool call: if more than `SYNC_TTL_SECONDS` since the last successful sync, run `api.sync()` first. Fixes v1's stale-data problem without paying sync latency on every call within a conversation.

### Money handling (`money.ts`)

- `toUnits(cents) -> number` (2 decimals), `toCents(units) -> integer` — used at every boundary.
- Monetary outputs carry both `amount` (number, units) and `amount_formatted` (string via `Intl.NumberFormat(LOCALE, {currency: CURRENCY})`).
- Write inputs accept **units** (e.g. `120`, `60.50`); the server converts to cents. Sum validations happen in integer cents to avoid float drift.

### Output contract

Every tool returns compact JSON as text content **and** `structuredContent` with a Zod-derived `outputSchema` (SDK 1.29). Field names in English; the LLM localizes conversation naturally. Read tools declare `readOnlyHint: true`; write tools declare appropriate `destructiveHint` annotations.

## Tool catalog — read (8)

Common conventions: transaction rows are `{id, date, account, payee, category, amount, amount_formatted, notes?, is_transfer?, is_split?}` — no account/category/payee UUIDs (names resolved server-side); the transaction `id` is kept because write tools need it.

| Tool | Purpose | Inputs |
|---|---|---|
| `get_accounts` | Accounts with balances | `include_closed=false`, `include_off_budget=true` |
| `get_net_worth` | Total net worth + on/off-budget breakdown with per-account detail | — |
| `get_categories` | Group/category map with IDs (needed for writes) | `include_hidden=false`, `include_notes=false` |
| `get_transactions` | Search movements | date range, `account_id`, `category_id`, `search_text` (payee/notes), `min_amount`, `max_amount`, `uncategorized`, `include_transfers=false`, `limit=50`, `offset` |
| `get_spending_summary` | Aggregated spending | date range, `group_by: category\|payee\|month`, `include_income=false`, `top_n` (rolls tail into "others") |
| `get_budget_month` | Month status: toBudget, income, budgeted, spent, per-category rows | `month`, `only_active=true` |
| `get_budget_averages` | Per-category average/median/max spending over N months (budget preparation input) | `months_back=6` |
| `get_schedules` | Existing recurring schedules | `include_completed=false` |

Notes:

- `get_spending_summary` and `get_budget_averages` always exclude transfers. `get_transactions` excludes them by default; `include_transfers: true` opts in, and rows are flagged `is_transfer`.
- Summaries are implemented with ActualQL (`q()`/`runQuery`) — single query instead of v1's per-account loop. `group_by: category` rows include the transaction count.
- `get_budget_averages` reports median alongside average so an anomalous month doesn't wreck budget proposals; each row includes the number of months with data.
- `get_transactions` returns `total_count` so the LLM knows more pages exist.

## Tool catalog — write (8)

Registered only when `ENABLE_WRITE=true`. All write inputs take amounts in **units**. Every write returns the resulting state (the updated/created entity) so the LLM confirms with real data.

| Tool | Purpose | Inputs |
|---|---|---|
| `update_transaction` | Fix one movement | `transaction_id` + any of: `category_id`, `payee_name`, `notes`, `date`, `amount`, `cleared` |
| `categorize_transactions` | Bulk categorization | `updates: [{transaction_id, category_id}]` (max 50); per-item success/failure |
| `split_transaction` | Split a movement into parts | `transaction_id`, `splits: [{amount, category_id, notes?}]`, `adjust_last=false` |
| `create_transaction` | Record a dictated expense/income | `account_id`, `date`, `amount`, `payee_name`, `category_id?`, `notes?`, `splits?` |
| `create_schedule` | Native recurring transaction | `name`, `payee_name`, `account_id`, `amount`, recurrence: `{frequency, start, interval?, end?}` |
| `set_budget` | Assign budget cells (single or bulk) | `operations: [{month, category_id, amount}]`, `carryover?`; per-op results |
| `transfer_budget` | Move budget between categories | `month`, `from_category_id`, `to_category_id`, `amount` |
| `update_category_note` | Category notes (templates/goals) | `category_id`, `note` |

Notes:

- **`split_transaction`** validates in integer cents that parts sum exactly to the transaction total; on mismatch it rejects and reports the difference so the LLM can retry. `adjust_last: true` makes the server compute the last part ("120 to groceries, the rest to home"). Implemented with the official `subtransactions` API.
- **`create_transaction` accepts `splits`** so a dictated supermarket ticket is created already split in one call.
- **`payee_name` instead of payee UUID** — the API resolves/creates payees by name. Categories go by ID (names repeat across groups), which the LLM already has from `get_categories`.
- **No `dry_run`**: Claude Desktop's per-tool approval plus state-echoing responses are the safety net; a dry-run flag would double the friction.

## Error handling

- **Input validation (Zod):** malformed input returns `{error: {code: "invalid_input", message, hint}}` naming the field and expectation — the LLM self-corrects.
- **Actual server down:** connection retried on each call. If a local budget copy exists, **read** tools serve it with `stale_data: true` + `last_synced` timestamp. **Write** tools fail hard — never write blind when sync is impossible.
- **Actual API errors** are wrapped with tool/operation context. Credentials never appear in errors or logs. All logs to stderr.

## Security

- Write tools gated behind `ENABLE_WRITE` (unregistered, not just disabled).
- No delete operations exist in the catalog.
- Credentials only via env vars; `.env` git-ignored; git history must be reviewed before any public push.
- MCP tool annotations (`readOnlyHint`/`destructiveHint`) so clients render appropriate approval warnings.

## Testing (TDD, Vitest)

- **Unit tests per tool** with the Actual client injected as a mock. Named critical cases: transfer exclusion in summaries; net worth including off-budget; split sum validation (exact, `adjust_last`, odd cents like 100/3); cents↔units round-trips and `Intl` formatting under `es-ES` and `en-US`.
- **Registry tests:** with `ENABLE_WRITE=false` exactly 8 tools exist; with `true`, 16.
- **Manual smoke** (`npm run smoke`, not in CI): against the real server — list accounts and compare net worth with the Actual UI.

## Migration from v1

- v1's 6 read tools are superseded (same names kept where semantics match: `get_accounts`, `get_categories`, `get_transactions`; `get_summary_by_category` → `get_spending_summary`; `get_budget_months` → `get_budget_month`; `get_net_worth` corrected to include off-budget).
- The community server installed as `actual-budget-test` (agigante80) stays during development for comparison and is retired when v2 covers the workflows.

## Future work (out of scope)

- Streamable HTTP transport behind a flag.
- Publication checklist: bilingual README (`README.md` EN + `README.es.md`), `npx` bin entry, LICENSE (MIT), CHANGELOG, git history audit.
