# Security Policy

## Supported versions

Only the latest commit on `main` is supported. Fixes are released as new versions;
there are no backported security patches for older tags.

| Version | Supported |
| ------- | --------- |
| latest `main` | yes |
| anything older | no |

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub private security advisories](https://github.com/marcoaperez/actual-budget-mcp-es/security/advisories/new)
("Report a vulnerability" on the repository's Security tab). Do **not** open a public
issue for a security problem.

Include, if you can: the affected tool or module, the impact, and a minimal way to
reproduce it. Expect a first reply within a few days; this is a small project maintained
in spare time, so please allow reasonable time for a fix before public disclosure.

## Security model

### Trust boundary: stdio

The server speaks MCP over **stdio** and has **no authentication layer of its own**.
Whoever can talk to its stdin can invoke every registered tool. The MCP client (Claude
Desktop or equivalent) that spawns the process is the trust boundary.

**Never expose this server on a network** — no TCP socket, no HTTP wrapper, no reverse
proxy — without putting authentication and authorization in front of it. It is designed
to run as a local child process of a single user's MCP client.

### Credentials

The Actual server URL, password and sync id come from the environment provided by the MCP
client (or a local `.env` in development). They are never written to tool results, never
logged, and never committed — `.env` is git-ignored. Rotating the Actual password is done
in Actual itself; this server just reads whatever the environment gives it.

All diagnostic output goes to **stderr**, because stdout is the MCP channel.

### Local budget copy

`@actual-app/api` downloads a working copy of your budget into the `data/` directory.
That copy is a **plain, unencrypted SQLite database** containing your full financial
history. The server creates the directory with mode `0700` (owner-only), but the data
itself is not encrypted at rest: protect it with your operating system's user account
and, if you need it, full-disk encryption. Delete `data/` if you stop using the server.

Each connected MCP client starts its **own** server process, and Actual only lets one
process open a budget at a time. When the configured directory is already in use, the
server transparently falls back to a per-instance copy (`<data dir>-instance-<pid>`,
also `0700`) and says so on stderr — so a second client works instead of failing, at the
cost of its own local copy of the budget.

### Writes are opt-in

Write tools are **not registered at all** unless `ENABLE_WRITE=true` is set. With writes
disabled, the tool list a client can see and call is read-only — this is enforced at
registration time, not by a runtime check that could be argued around.

### Destructive operations

There are **no delete tools**: the server cannot remove transactions, accounts, categories
or budgets. Two behaviours still deserve attention and are annotated `destructiveHint: true`
so clients prompt accordingly:

- **`split_transaction` replaces the transaction.** Actual has no in-place split, so the
  original is deleted and recreated with subtransactions. The resulting transaction has a
  **new id**; the old id no longer exists.
- **Overwriting tools.** `set_budget`, `transfer_budget`, `update_transaction` and
  `update_category_note` replace existing values rather than adding to them. Each returns
  an echo of the resulting state (and, for the note, the previous one) so the change is
  auditable from the conversation.

`transfer_budget` moves budget in two legs. If the credit leg fails, the server compensates
by restoring the source category — but **compensation is best-effort**: if the credit
actually applied server-side and only the response was lost, the source is restored while
the destination stays credited. Verify with `get_budget_month` if a transfer reports an
error.

### Input validation

Every id accepted by a tool is validated as a **UUID**. This is not cosmetic: Actual's AQL
compiler interpolates id-typed values into SQL without escaping, so this server's
validation is the barrier that stops a malformed or hostile id from reaching the query
compiler. Free-text and numeric inputs carry length and range limits (note and search
lengths, maximum split parts, recurrence intervals, a maximum reporting range) to bound
the cost and size of any single call.

### Tool results contain untrusted text

Payee names, transaction notes, category notes and schedule names originate from **bank
synchronization or CSV imports** — data this server did not author and cannot vouch for.
It is returned verbatim, because truncating or rewriting it would corrupt your records.

Treat that text as **data, never as instructions**. A payee name crafted to read like a
command to the model is a realistic prompt-injection vector for any MCP client that
auto-approves tool calls. Accordingly:

- Keep **per-call approval** enabled in your MCP client, especially with `ENABLE_WRITE=true`.
- Review the arguments of write calls before approving them, rather than approving a batch.

### Dependencies

Runtime dependencies are pinned to caret ranges of known-good versions and kept few:
`@actual-app/api`, the MCP SDK, `zod` and `dotenv`. The published npm package ships only
`dist/`, the READMEs and the license — tests, docs and development tooling are excluded.
