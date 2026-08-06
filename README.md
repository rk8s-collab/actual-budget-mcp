**English** | [Español](README.es.md)

# Actual Budget MCP Server

An MCP (Model Context Protocol) server that connects LLMs — Claude Desktop and any MCP-capable client — to a self-hosted [Actual Budget](https://actualbudget.org/) instance. It is purpose-built for LLM consumption: correct financial semantics (transfers excluded from spending summaries, net worth including off-budget accounts), amounts converted server-side so the model never does cents math, compact outputs, fresh data via sync-with-TTL, and **real** split transactions backed by subtransactions.

## Feature highlights

The design rests on five pillars:

- **Correct financial semantics** — transfers (`transfer_id`) are excluded from spending summaries so amounts are never double-counted, and net worth includes off-budget accounts (pensions, funds, mortgage).
- **Server-side unit conversion** — Actual stores amounts in cents; every tool returns values already divided by 100, with an `amount_formatted` field. The LLM never does the math.
- **Compact, LLM-friendly outputs** — responses are trimmed to what a model needs to answer, keeping token usage low.
- **Fresh data with sync-with-TTL** — the server syncs with Actual before serving, caching the sync for a short TTL to stay fast without going stale.
- **Real split transactions** — `split_transaction` creates genuine subtransactions in Actual, not fake notes or workarounds.

## Install in Claude Desktop (recommended)

**Requirements:** a Mac with Apple Silicon (M1 or later), Claude Desktop, and a self-hosted
Actual Budget server you can reach. On Intel Macs, Windows or Linux, use
[Manual installation](#manual-installation) instead.

1. **Download** the latest `actual-budget-mcp-es.mcpb` from the
   [Releases page](https://github.com/marcoaperez/actual-budget-mcp-es/releases/latest).
2. **Find your Sync ID** — open Actual Budget in the browser, go to **Settings** →
   **Advanced Settings** → **IDs**, and copy the **Sync ID**.
3. **Install** — in Claude Desktop, open **Settings → Extensions**, drag the downloaded
   `.mcpb` file onto the page, review what it declares, and select **Install**. Claude
   Desktop will note the extension is not signed — that's expected for a self-distributed
   bundle.
4. **Fill the form** Claude Desktop shows:
   - **Actual server URL** — e.g. `https://actual.example.org/`
   - **Server password** — the one you use to open Actual in the browser (stored by Claude
     Desktop's secure storage, not in a config file)
   - **Budget Sync ID** — from step 2
   - **Locale** and **Currency** — e.g. `es-ES` and `EUR`; defaults are `en-US` and `USD`
   - **Enable write tools** — leave this **off** for now (see below)
   - **Message language** — `es` or `en`; defaults to `es`
5. **Check it works** — start a new conversation and ask *"what accounts do I have?"*.
   You should get your account list with balances.

### Turning on write access

With the checkbox off you get the 11 read-only tools. Turn it on (Settings → Extensions →
this extension → configure) to add the 18 write tools: editing and categorizing transactions,
real splits, scheduled transactions, budget assignment, category notes, managing category
groups/categories, payees/transfers and automation rules. Claude Desktop asks for your
approval before each call unless you grant it standing permission. The classification tools
(categories, category groups, rules, `set_transaction_transfer`) sync to the server after
every write — the 8 write tools from earlier versions don't do this themselves, they rely on
the next scheduled sync instead. The delete tools (`delete_category`, `delete_category_group`,
`delete_rule`) require
`confirm_delete: true` and default to archiving (`hidden: true`) as the non-destructive
alternative.

### Updating

Download the newer `.mcpb` and drag it in again — your configuration is kept.

### If every tool fails after a Claude Desktop update

The bundle ships a native SQLite module (`better-sqlite3`) compiled for one specific Node
ABI. Claude Desktop does not run extensions with the system's Node: it starts them inside
its own Electron runtime, so the module has to match *that* runtime. When a Claude Desktop
update changes it, the module can no longer be loaded and the extension cannot work.

The server detects this at startup and says so plainly: every tool answers with the two
version numbers involved and tells you to install a newer bundle, instead of failing with a
confusing message about the budget being closed.

Nothing on your side fixes this — the bundle has to be rebuilt for the new runtime. Get a
newer release, or build one yourself with `npm run bundle` on a machine that has the updated
Claude Desktop installed.

This affects the `.mcpb` bundle only. A [manual installation](#manual-installation) runs
under your own Node and is immune to it.

## Manual installation

For other MCP clients, Intel Macs, Windows and Linux. Requires Node.js >= 22 and a
self-hosted Actual Budget server (>= 25.x; built against API 26.7) reachable over the
network.

The project is written in TypeScript, so build it before use:

```bash
git clone https://github.com/marcoaperez/actual-budget-mcp-es.git
cd actual-budget-mcp-es
npm install
npm run build          # compiles TypeScript to dist/
```

This produces `dist/index.js`, the entry point your MCP client runs.

Need your Sync ID? See step 2 of [Install in Claude Desktop](#install-in-claude-desktop-recommended) above.

### Client configuration

Add this to your `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`), or the
equivalent configuration file for your MCP client.
Point `command` at `node` and `args` at the compiled `dist/index.js` using an absolute path:

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "node",
      "args": ["/absolute/path/to/actual-budget-mcp-es/dist/index.js"],
      "env": {
        "ACTUAL_SERVER_URL": "https://actual.example.org/",
        "ACTUAL_SERVER_PASSWORD": "your-password",
        "ACTUAL_SYNC_ID": "00000000-0000-0000-0000-000000000000",
        "LOCALE": "es-ES",
        "CURRENCY": "EUR",
        "ENABLE_WRITE": "false"
      }
    }
  }
}
```

Use `"LOCALE": "en-US"` and `"CURRENCY": "USD"` for US formatting, or `"es-ES"` / `"EUR"` for Spain. Set `"ENABLE_WRITE": "true"` only when you want the write tools (see below). Restart Claude Desktop after saving so it detects the new MCP server.

During development you can skip the build and run TypeScript directly with `tsx`:
`"command": "npx"`, `"args": ["tsx", "/absolute/path/to/actual-budget-mcp-es/src/index.ts"]`.

### Environment variables

The first three variables are required; the rest have defaults.

| Variable | Required | Default | Description |
|---|---|---|---|
| `ACTUAL_SERVER_URL` | Yes | — | URL of the self-hosted Actual server |
| `ACTUAL_SERVER_PASSWORD` | Yes | — | Actual server password |
| `ACTUAL_SYNC_ID` | Yes | — | Budget Sync ID (Settings → Advanced → Sync ID) |
| `ACTUAL_DATA_DIR` | No | `./data` | Folder where the local copy of the budget is downloaded |
| `LOCALE` | No | `en-US` | Locale for formatting amounts and dates (e.g. `es-ES`) |
| `CURRENCY` | No | `USD` | 3-letter ISO currency code (e.g. `EUR`) |
| `SYNC_TTL_SECONDS` | No | `60` | Seconds the sync is cached before re-syncing |
| `ENABLE_WRITE` | No | `false` | Enables the 18 write tools (categorize, splits, schedules, budget, notes, category groups/categories, payees/transfers, rules) |
| `MESSAGES_LANG` | No | `es` | Language of the server's error messages: `es` or `en` |

## Tools

### Read tools (11)

Always available.

| Tool | Description |
|---|---|
| `get_accounts` | Accounts with current balance; includes off-budget accounts (pensions, funds, mortgage) by default |
| `get_net_worth` | Full net worth: on-budget + off-budget with a per-account breakdown |
| `get_categories` | Category groups and categories with their IDs (needed by the write tools) |
| `get_payees` | Payees with their IDs; a payee with `transfer_account_id` set is the payee Actual uses to represent that account in a transfer |
| `get_account_transfer_payee` | The payee that represents a specific account in a transfer — a shortcut over `get_payees` |
| `get_transactions` | Transactions by date range with optional filters (account, category, text, amount, uncategorized). Excludes transfers. Paginated (max 200) |
| `get_spending_summary` | Spending aggregated by category, payee or month. Always excludes transfers |
| `get_budget_month` | A month's budget state: to-budget, income, totals and budgeted/spent/balance per category |
| `get_budget_averages` | Mean, median and max spending per category over the last N full months — input for preparing the budget |
| `get_schedules` | Scheduled/recurring transactions configured in Actual (name, next date, amount) |
| `get_rules` | Automation rules with their IDs; rules run on imported transactions and are how recurring movements classify themselves |

### Write tools (18)

Registered only when `ENABLE_WRITE=true`.

| Tool | Description |
|---|---|
| `update_transaction` | Fix a transaction (amount, category, payee, notes, date). `category_id: null` uncategorizes it; `payee_id` sets a known payee, `payee_name` resolves/creates one |
| `categorize_transactions` | Categorize in bulk (max 50), with a per-item result |
| `split_transaction` | Split a transaction into real parts, in place (same id) |
| `create_transaction` | Record an expense/income, with optional splits at creation |
| `create_schedule` | Create a scheduled/recurring transaction |
| `set_budget` | Assign budget in bulk to several categories of a month |
| `transfer_budget` | Move assigned budget between categories |
| `update_category_note` | Category notes and goal templates |

**Category groups and categories**

| Tool | Description |
|---|---|
| `create_category_group` | Create a new category group (the top-level buckets that hold categories) |
| `update_category_group` | Rename a category group or archive it (`hidden: true`) — the non-destructive alternative to `delete_category_group` |
| `delete_category_group` | Permanently delete a category group and every category inside it. Requires `confirm_delete: true`; if any of them have transactions, `transfer_category_id` is mandatory |
| `create_category` | Create a category inside an existing category group |
| `update_category` | Rename a category, move it to another group, or archive it (`hidden: true`) — the non-destructive alternative to `delete_category` |
| `delete_category` | Permanently delete a category. Requires `confirm_delete: true`; if it has transactions, `transfer_category_id` is mandatory |

**Payees and transfers**

| Tool | Description |
|---|---|
| `set_transaction_transfer` | Turn an ordinary transaction into a transfer with another account, by pointing it at that account's transfer payee. Actual creates and links the matching transaction on the other account |

**Rules**

| Tool | Description |
|---|---|
| `create_rule` | Create an automation rule: a condition (e.g. imported_payee contains "X" — use imported_payee, not payee, to match a payee the first time it is ever imported) plus an action (e.g. set category = id). Runs on future imports only, never retroactively. An action that sets payee to a transfer payee does not create a real transfer; follow up with set_transaction_transfer |
| `update_rule` | Replace an automation rule — Actual's API takes the whole object, so resend every field you want to keep |
| `delete_rule` | Delete an automation rule. Past transactions keep whatever it already applied; only future imports change |

> **Notes on the write tools**
> - They only appear when `ENABLE_WRITE=true` is set in the `env` block (restart the client after changing it).
> - **Input amounts are in currency units** (euros/dollars, not cents); the server handles the conversion.
> - `split_transaction` updates the transaction **in place** with its subtransactions — the **id is unchanged**.
> - The classification tools (categories, category groups, rules and `set_transaction_transfer`) **sync to the server after every write** — the 8 write tools from earlier versions don't, they rely on the next scheduled sync instead.
> - The delete tools (`delete_category`, `delete_category_group`, `delete_rule`) require **`confirm_delete: true`**; archiving (`hidden: true`, via `update_category`/`update_category_group`) is the non-destructive default and keeps history intact.

## Safety

- **No transaction, account or budget-assignment delete tools** — the server cannot remove those. The only delete tools are `delete_category`, `delete_category_group` and `delete_rule`; each requires `confirm_delete: true`, and archiving (`hidden: true`) is the non-destructive default.
- **Write disabled by default** — write tools are never registered unless `ENABLE_WRITE=true`.
- **Split guards** — the write tools guard against editing split parts or split parents directly.
- Never commit your `.env`. The Actual password lives only in your local `.env` or the client config.

Three things worth knowing before you enable writes:

- `data/` holds a **plain, unencrypted copy** of your whole budget (created owner-only, mode `0700`).
- Payee names and notes come from bank sync or CSV imports: they are **untrusted text**, not instructions. Keep per-call approval on in your MCP client.
- `split_transaction` updates the transaction **in place** — the id does not change.
- Every MCP client you connect starts its own server process. Only one process can open a
  budget at a time, so extra instances automatically use their own local copy
  (`<data dir>-instance-<pid>`). In a manual installation you can set `ACTUAL_DATA_DIR` per
  client if you prefer to control it (the Claude Desktop bundle does not expose this setting).

The full security model — trust boundary, credentials, destructive operations, input validation and how to report a vulnerability — is documented in [SECURITY.md](SECURITY.md).

## Privacy Policy

This software collects nothing: no telemetry, no analytics, no update checks. It runs on
your machine and talks only to **your own** Actual Budget server and to the MCP client you
connect it to — which sees the financial data you ask about, under its own privacy policy.
The local copy of your budget is unencrypted and lives only on your machine.

Full text: [PRIVACY.md](PRIVACY.md) · [en español](PRIVACY.es.md)

## Development

```bash
npm test        # full suite with Vitest (325 tests)
npm run dev     # runs src/index.ts with tsx (no build)
npm run smoke   # manual check against the real Actual server (requires .env; not part of CI)
```

The server talks over stdio (stdin/stdout), so running it manually shows no interactive output — logs go to stderr.

### Adding a new tool

1. Create a file in `src/tools/my_new_tool.ts`
2. Export a `ToolDef` (`name`, `description`, `readOnly`, `inputSchema` with Zod, `handler`)
3. Import and register it in the `allTools` array of `src/tools/index.ts`

The `handler(input, ctx)` receives an initialized `{ api, config }` context; use `moneyFields`/`toUnits` from `src/core/money.js` to always return amounts in units (never cents).

### Releasing a bundle

> **The bundle is tied to Claude Desktop's Electron ABI.** Extensions run inside Claude
> Desktop's own Electron, not the system's Node, so `better-sqlite3` has to be compiled for
> that runtime. `npm run bundle` reads the Electron version out of the installed
> `Claude.app`, reinstalls the prebuilt binary for it, and then verifies what actually ships
> by `dlopen`-ing it with the packaging Node — which *must* fail, reporting Electron's ABI.
> If it loads, the Node-targeted binary slipped in and packaging aborts.
>
> So: **package on a machine running the Claude Desktop you are targeting**, or pass
> `ELECTRON_TARGET=x.y.z npm run bundle`. Re-release whenever Claude Desktop bumps its
> Electron major — the previous bundle stops working for everyone on the new version.

1. Bump `version` in `package.json` **and** `manifest.json` (a test enforces they match).
2. `npm test && npm run build && npm run bundle` — the last line reports the Electron
   version and ABI the bundle was built for. Note it in the release description.
3. Verify the bundle:
   ```bash
   npx mcpb validate manifest.json
   unzip -l build/actual-budget-mcp-es.mcpb | grep -E 'tests/|docs/|\.env' | grep -v 'node_modules/'  # expect no output
   unzip -l build/actual-budget-mcp-es.mcpb | grep -c 'better_sqlite3.node'  # expect at least 1
   ```
   `npx mcpb info <file>` (CLI 2.1.2) only prints file name, size and signature status — it
   does not check the manifest, so it's not a substitute for `validate`. The `node_modules/`
   exclusion in the grep is there because vendored dependency files aren't the project's own
   code and legitimately contain paths like `tests/` — don't remove it.
4. Install `build/actual-budget-mcp-es.mcpb` locally and check it works.
5. `gh release create vX.Y.Z build/actual-budget-mcp-es.mcpb`, noting in the release
   description that the bundle targets macOS on Apple Silicon.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Marco Antonio Pérez.
