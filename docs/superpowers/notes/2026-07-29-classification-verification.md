# Classification write tools — empirical verification

Findings from running `scripts/verify/phase*.ts` against a real Actual server (the
Connectors Directory demo, `https://actual.mymyc.es`), not the mocked unit tests. Each
phase's script drives the tool handlers directly against a live API.

## Phase 1 — taxonomy (2026-08-03)

`scripts/verify/phase1-taxonomy.ts` — **15/15 checks passed**, `RESULT={"checks_total":15,"checks_passed":15,"failed":false}`.

- The read-merge-write trap is real and the fix holds: `update_category({ hidden: true })`
  against a real server does NOT throw (checks 4a/4b), confirming `update_category` and
  `update_category_group` must send the merged record, exactly as Task 3/4 implemented.
- **Open question 2, answered**: `delete_category` with `transfer_category_id` really does
  reassign existing transactions to the destination category — verified by reading the
  transaction back and confirming `category_id` changed to the destination (check 7c), and
  again through a second reassignment when the destination category's own group was deleted
  (check 8c, "bonus": the transaction followed the category through both hops). Deleting
  without a target correctly throws the needs-target error before calling the API (check 6c).
- `delete_category_group` deletes the group and Actual stops listing it via `get_categories`
  (check 8b), consistent with the plan's assumption from source reading.
- No contradictions found against the "Verified API facts" table in the plan — nothing in
  `create_category_group.ts`, `update_category_group.ts`, `create_category.ts`,
  `update_category.ts`, `delete_category.ts`, or `delete_category_group.ts` needed changing.

## Phase 2 — transfers and payees (2026-08-03)

`scripts/verify/phase2-transfers.ts` — **26/26 checks passed**, `RESULT={"checks_total":26,"checks_passed":26,"failed":false}`.

Script note: the seeded demo dataset has only 2 on-budget accounts (Checking, Savings) plus
1 off-budget (Pension) — the script originally required 3 on-budget accounts to pick a
"third account" for the re-point check. Relaxed to accept the off-budget account as the
third account when a third on-budget one isn't available; the brief only asked for "a third
account", not specifically on-budget.

- **Open question 1, answered**: `set_transaction_transfer` really does create and link a
  counterpart transaction on the target account. Verified: exactly one counterpart row
  appears on the target account (4b), its amount is the exact negation of the source's (4d),
  and the link is mutual — `source.transfer_id` points at the counterpart and vice versa
  (4e) — for both a same-side (on-budget → on-budget) and an opposite-side (on-budget →
  off-budget) pair.
- **Category behaviour, answered** (was RECORD-only, not asserted, since either answer would
  be informative): on the same-side pair both legs come back with `category_id: null`
  (cleared) — confirmed `true`. On the opposite-side pair the source KEEPS its category
  (`86e8dc10-...`) and only the counterpart is `null` — confirmed `false` for "cleared on
  both legs". This matches the plan's "Verified API facts" table exactly: clearing only
  happens when both accounts are on the same side of the budget.
- **Re-pointing, answered**: re-pointing an existing transfer to a third account removes the
  counterpart from the old target account (6b, zero rows) and the new target account ends up
  with exactly one (6c) — and it is the **same row id**, not a new one (6d:
  `"reused": true`). Confirms the plan's claim that re-pointing moves the existing
  counterpart rather than creating a second one.
- `update_transaction`'s new `category_id: null` and `payee_id` inputs both verified against
  a re-read of the real transaction (7d, 7g), not just the tool's own echo.
- No contradictions found; `set_transaction_transfer.ts`'s description did not need
  correcting, and no other Phase 2 tool needed changes.

## Phase 3 — rules (2026-08-03)

`scripts/verify/phase3-rules.ts` — **12/12 checks passed** (after one script fix, see
below), `RESULT={"checks_total":12,"checks_passed":12,"failed":false}`.

**Real finding, not a plan contradiction but a real gap in the plan's own illustrative
example** (`payee contains "Landlord"`, used in `tests/core/rule-schema.test.ts` and echoed
in `create_rule.ts`'s original description): the first version of this script used
`{ field: 'payee', op: 'contains', value: '<name>' }` and the rule never fired on either
import path (`create_transaction`/`api.addTransactions`, and `api.importTransactions`
directly) — acceptance criterion 1 failed outright (`RESULT` showed `4/5` with a `FAIL` on
"at least one import path applies the rule category"). Read `@actual-app/core`'s
`server/accounts/sync.ts` and `server/transactions/transaction-rules.ts` to find out why:
`runRules()` runs during import BEFORE the imported payee name is resolved into an actual
payee row, so a condition on the `payee` field (which matches an already-existing payee, by
id or by its stored name) has nothing to match against yet for a payee's first-ever
appearance. A throwaway diagnostic (`payee` → `imported_payee` on an otherwise identical
rule) confirmed the fix: `imported_payee` matches the raw imported text and fires correctly
on first import. **`payee` is only useful for rules matching an already-existing payee**
(e.g. renaming behaviour for a payee you already have); **`imported_payee` is what a rule
needs to auto-categorize a payee the first time Actual ever sees it** — which is the common
"recurring bill" use case the plan's own example was illustrating, so the example itself was
subtly wrong about which field to use. Fixed in the script (all three rule conditions now
use `imported_payee`) and in `src/tools/create_rule.ts`'s description, which now explicitly
tells the model to use `imported_payee` for first-import matching and clarifies what `payee`
actually matches.

- **Acceptance criterion 1, answered** (once the field was fixed): rules DO run on import —
  both `create_transaction` (via `api.addTransactions`) and `api.importTransactions`
  directly trigger `runRules()` (confirmed by reading `sync.ts`, both paths call
  `reconcileTransactions`, which calls `runRules` in its first pass). The script's original
  framing ("which import path triggers rules") was the wrong question — both paths do; the
  condition's field choice was what mattered.
- **`update_rule` re-verified live**: after changing the rule's action to a different
  category, a fresh import applies the NEW category (check 3c).
- **Acceptance criterion 2 (open question 3), answered — rules cannot produce a real
  transfer**: a rule whose action is `set payee = <transfer payee id>` does NOT result in a
  `transfer_id` on the imported transaction (`RECORD ... = false`). Confirmed the documented
  fallback is required: `create_rule.ts`'s description now says to follow up with
  `set_transaction_transfer` on the resulting transaction when a real transfer is needed.
- `delete_rule` confirmed live for both rules created; `get_rules` no longer lists them
  after deletion.

### Files changed as a result of this phase's findings

- `scripts/verify/phase3-rules.ts`: all three rule conditions changed from `field: 'payee'`
  to `field: 'imported_payee'`.
- `src/tools/create_rule.ts`: description rewritten to (a) use `imported_payee` in its
  example and explain the `payee`/`imported_payee` distinction, (b) document that a
  transfer-payee action does not create a real transfer and point at
  `set_transaction_transfer`. No behavioural/schema change — `rule-schema.ts` already
  allowed `imported_payee` as a condition field, and both `payee` and `imported_payee` are
  already in `CONDITION_FIELDS`; this was a documentation-accuracy fix, not a bug fix.

## Incident during this verification pass (2026-08-03)

Unrelated to the tools themselves: the demo's admin password had been generated and stored
directly in 1Password during the original deployment (2026-07-31) and was never recorded
anywhere Marco could retrieve it later. Recovering it required a full password reset on the
server, which had a real side effect — full account-db reset (needed because deleting
`account.sqlite` alone left the migration-state file `.migrate` claiming the schema was
already applied, so the `users`/`auth` tables were never recreated) also wiped the
`files` registry that maps a Sync ID to its physical budget file, orphaning the existing
seeded budget server-side even though its `.sqlite` file was untouched on disk. Recovered
by re-running `npm run demo:bootstrap`, which produced a fresh seeded budget and a new
Sync ID (`757ce502-a230-4856-bf40-0210937530c6` → `a7e2ad0a-56cf-4336-9f1a-4eb169c0c0ae`).
Full incident detail and the exact recovery commands are in the private
`arcane-stacks/vm-personal/actual-demo/CREDENTIALS.md` (commit `91027e6`). No implication
for the classification tools' correctness — this was infrastructure, not tool behavior.
