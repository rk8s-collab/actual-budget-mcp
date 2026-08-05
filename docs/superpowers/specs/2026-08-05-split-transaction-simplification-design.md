# Simplify split_transaction using api.updateTransaction — Design Spec

**Date:** 2026-08-05
**Status:** Approved by the maintainer (design review)
**Language note:** Spec in English (publication-ready), like the other design specs.

## Overview

`@actual-app/api` 26.8.0 ships a fix ([upstream PR #8467](https://github.com/actualbudget/actual/pull/8467),
closes actualbudget/actual#8207) for `api.updateTransaction(id, { subtransactions: [...] })`:
calling it on a plain (non-split) transaction used to throw `"account" is required for table
"transactions"`. The fix makes `updateTransaction` correctly convert a regular transaction into
a split in place — each subtransaction is materialised as a real child that inherits the
parent's `account`/`date`, and the parent is flagged `is_parent`.

Our [`split_transaction`](../../../src/tools/split_transaction.ts) tool predates this fix and
works around the old bug: it creates a full copy of the transaction with the subtransactions
attached, deletes the original, and locates the newly created row by taking the set difference
of matching candidates before and after the write (`candidateIds`/`newIdFromDiff` in
[`tx-read.ts`](../../../src/core/tx-read.ts)) — because there was no other way to learn the new
row's id. This spec replaces that workaround with a single `updateTransaction` call.

### Goals

- Replace the create-copy + delete-original + set-difference mechanism with one
  `api.updateTransaction(transaction_id, { subtransactions })` call.
- Preserve the tool's external contract exactly: same `inputSchema`, same response shape, same
  error messages for every guard that is still reachable. No MCP client observes a difference
  beyond the tool doing less work and never producing an "ambiguous new row" note.
- Eliminate the failure modes that only existed because of the two-step mechanism: the new row
  not being found, and the copy being created but the original failing to delete.

### Non-goals

- No change to `split_transaction`'s public contract (confirmed with the maintainer).
- No change to `candidateIds`/`newIdFromDiff` in `tx-read.ts` — they stay as-is, still used by
  [`create_transaction`](../../../src/tools/create_transaction.ts).
- No generalization of `reflectsFields`/`readBack` for arbitrary array fields. A dedicated
  split-confirmation helper is added instead (see below); broadening the shared helper is a
  separate decision with its own blast radius across every caller.
- No sugar for other subtransaction operations (merging splits back into one line, editing an
  existing split's parts). Out of scope.

## Dependency requirement

The fix lives in `packages/loot-core/src/shared/transactions.ts`, bundled inside the
`@actual-app/api` package and executed **client-side** against the locally synced budget copy —
not server-side logic. The user's self-hosted Actual **server** version is irrelevant to this
fix. What matters is the `@actual-app/api` version installed alongside this MCP server:

- `package.json`'s `"@actual-app/api": "^26.7.0"` must become `"^26.8.0"` (or tighter). The
  current range is satisfied by `26.7.x`, which still has the bug — a fresh install without this
  bump could silently regress.
- The project also ships as a Claude Desktop extension (`.mcpb`) with `@actual-app/api`
  pre-bundled against a specific Electron ABI (see the `.mcpb` distribution spec). Bumping the
  minimum version requires **regenerating that bundle** via `scripts/bundle.ts` — editing
  `package.json` alone does not update what ships inside the `.mcpb`.

## Architecture / components affected

- **[`split_transaction.ts`](../../../src/tools/split_transaction.ts)** — handler rewritten.
  Same tool name, `inputSchema`, and description.
- **[`tx-read.ts`](../../../src/core/tx-read.ts)** — a new confirmation helper is added next to
  `readBack`, specialized for splits. `reflectsFields`' `row[key] === value` check cannot confirm
  a `subtransactions` write (array, never referentially equal), so a dedicated check is needed:
  poll until the re-read row has `is_parent === true` and
  `subtransactions.length === parts.length` (same retry/settle pattern as `readBack`).
- **[`tests/tools/split_transaction.test.ts`](../../../tests/tools/split_transaction.test.ts)** —
  rewritten to mock `api.updateTransaction` instead of `addTransactions`/`deleteTransaction`/the
  multi-phase `runQuery` sequence.
- **`tests/core/tx-read.test.ts`** — new case for the split-confirmation helper.
- **[`CLAUDE.md`](../../../CLAUDE.md)** — the Plan 3 bullet describing the old
  create+delete+diff mechanism and its manual metadata copy is updated to describe the new
  in-place update and the `@actual-app/api` 26.8.0 dependency.

## Data flow (handler)

1. Parse `transaction_id`/`force` → read the original via `getTransactionById` → guard: exists,
   not a transfer, not already split. Unchanged, same messages (`m.txNotFound`,
   `m.cannotSplitTransfer`, `m.alreadySplit`).
2. `orig.reconciled && !force` → `m.reconciledNeedsForce`. Unchanged.
3. Parse the full input (`splits`, `adjust_last`) → compute the sum, apply `adjust_last` if set,
   validate the sum matches `orig.amount` → `m.partsDoNotSum` otherwise. Unchanged, same
   integer-cent arithmetic.
4. Validate every `category_id` against `getCategoryIndex(api)` → `m.categoryNotFound` if any is
   missing. Unchanged — still the last check before any write.
5. Build `parts` (`{ amount, category, notes? }` per part). **No `copy` object is built anymore**
   — `date`, `amount`, `payee`, `notes`, `cleared`, `imported_id`, `imported_payee`, `schedule`,
   `reconciled` all already live on the row being updated and are never touched.
6. `await api.updateTransaction(transaction_id, { subtransactions: parts })`. One call, no
   `addTransactions`/`deleteTransaction`.
7. Confirm with the new split-confirmation helper (step described above).
8. `mapTxEcho` over the final row (already supports `subtransactions` → `splits`, unchanged).
9. Response: `{ split: true, original_id: transaction_id, transaction }`, plus a pending note if
   confirmation timed out (same `echo_pending`-style pattern as `update_transaction`). The
   "ambiguous new row" note disappears: `original_id` and `transaction.id` are now always equal.

## Error handling

**Unchanged** (independent of the write mechanism, same order so a transfer error still wins
over a malformed `splits` array): `m.txNotFound`, `m.cannotSplitTransfer`, `m.alreadySplit`,
`m.reconciledNeedsForce`, `m.partsDoNotSum`, `m.categoryNotFound`.

**Removed** (no longer reachable — the failure modes they described cannot occur with a single
atomic update): `m.splitCreatedNotFound`, `m.splitCreatedNotDeleted`. These two keys are deleted
from `messages.ts` (both `es`/`en`) — confirmed split-transaction-exclusive (grep shows no other
caller).

`m.ambiguousNewRow` is **not** deleted: `create_transaction.ts` still uses it (its own
`candidateIds`/`newIdFromDiff` write path is untouched by this spec, see Non-goals). What
changes is only that `split_transaction` stops being able to produce it, since it no longer goes
through the diff mechanism — the response's "ambiguous new row" note simply never appears for
this tool anymore.

**New behaviour on `updateTransaction` failure:** the error propagates as-is. There is no
intermediate state to clean up or explain — the original transaction is untouched, because there
is no second operation that could have partially succeeded.

The confirmation step (data flow step 7) never throws: if it exhausts its retries without seeing
the split reflected, the best available read is returned with a pending note, matching
`update_transaction`'s existing pattern.

## Testing

- Rewrite `tests/tools/split_transaction.test.ts` to mock `api.updateTransaction` (pattern
  already used in `tests/tools/update_transaction.test.ts`).
- **Remove** two tests specific to the old mechanism: *"identifies the replacement by set
  difference, ignoring unrelated parents already present"* and *"throws without deleting the
  original when no new row appears (empty difference)"* — there is no diff and no new row to find
  anymore.
- **Adapt, same observable behaviour:** sum mismatch (both directions), transfer rejected,
  already-split rejected, ghost category rejected before writing, `adjust_last` computes the
  remainder, reconciled-without-force rejected.
- **Strengthen the metadata test:** it used to check that `imported_id`/`imported_payee`/
  `schedule`/`reconciled` were copied to the new row; it now checks that the payload sent to
  `updateTransaction` contains **only** `{ subtransactions }` — i.e. those fields are never read
  or touched, a stronger guarantee than "copied correctly".
- **New test:** `updateTransaction` rejects → the error propagates; no `deleteTransaction` mock
  to assert against anymore.
- New case in `tests/core/tx-read.test.ts` for the split-confirmation helper: settled when the
  re-read shows `is_parent` + the expected subtransaction count; not settled after exhausting
  retries.

## Documentation updates

- `CLAUDE.md`: replace the Plan 3 bullet ("`split_transaction` conserva `imported_id`/
  `schedule`/`reconciled` y protege conciliaciones; la fila creada se localiza por diferencia de
  conjuntos, no por orden") with one describing the in-place update via `@actual-app/api` 26.8.0
  ([upstream PR #8467](https://github.com/actualbudget/actual/pull/8467)) and the minimum
  dependency version bump.
- Obsidian vault (`Proyectos/Actual-MCP/`, personal vault): this decision is recorded in
  `01-Decisiones-Arquitectura.md` per the project's documentation convention — human-readable
  decisions and their rationale live there, not just in the repo.

## Verification

Before the implementation is considered done, an empirical check against the real Actual test
server confirms the assumptions this spec makes about 26.8.0's behaviour, matching the project's
established practice (e.g. the transfers/payees empirical check in Plan 3):

1. Splitting a transaction that is **not** reconciled — subtransactions inherit `account`/`date`
   correctly (this is the case the upstream regression test covers directly).
2. Splitting a **reconciled** transaction with `force: true` — the parent keeps
   `reconciled`/`cleared` untouched, and confirm the children come out in a consistent state
   (the old code force-set `cleared`/`reconciled` on the new row explicitly; the new code relies
   on them already being correct on the existing row and never touches them — this assumption is
   the one most worth confirming empirically).
3. A transaction carrying `imported_id`, `imported_payee`, and `schedule` — confirm they survive
   untouched after the update (expected, since they are never part of the `fields` payload).

If any of these diverge from the expected behaviour, the implementation plan documents the
deviation and adjusts before the old mechanism is removed.
