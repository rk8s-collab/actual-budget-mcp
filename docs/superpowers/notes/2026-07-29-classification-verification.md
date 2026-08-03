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

## Phase 2 — transfers and payees

Pending. `scripts/verify/phase2-transfers.ts` is written and type-checks clean but has not
yet been run against a live server.

## Phase 3 — rules

Pending. `scripts/verify/phase3-rules.ts` is written and type-checks clean but has not yet
been run against a live server.

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
