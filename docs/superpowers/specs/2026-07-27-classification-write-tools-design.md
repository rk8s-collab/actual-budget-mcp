# Classification write tools — Design Spec

**Date:** 2026-07-27
**Status:** Approved by the maintainer (design review)
**Language note:** Spec in English (publication-ready), like the v2 and .mcpb design specs.

## Overview

The server today can read the budget and make a fixed set of writes: it can update, create,
categorize and split transactions, note categories, and touch schedules and budget amounts.
What it cannot do is **reshape the classification itself** — create or rename category groups
and categories, move a category between groups, archive or delete taxonomy, turn a plain
transaction into a transfer, or manage the automation rules that keep future imports tidy.

This spec adds those capabilities. It is driven by a concrete need: reorganizing a household
budget — creating "Ahorro e Inversión" and "Impuestos" groups, deleting stale spending
categories (Traspaso, Profesora, Servicios) with their transactions reassigned, cleaning up
inter-account transfers that Actual imported as ordinary categorized expenses, and encoding
`payee contains … → transfer` rules so recurring internal movements classify themselves.

Thirteen new tools plus one enhancement, grouped into three phases that ship independently
with a review checkpoint between each:

1. **Taxonomy** — category groups and categories (6 tools).
2. **Transfers & payees** — payee reads and turning transactions into transfers (3 tools + 1 enhancement).
3. **Rules** — full CRUD over Actual's rule engine (4 tools).

### Goals

- Programmatic reorganization of the classification surface: groups, categories, transfers, rules.
- Same shape as the existing tools: one file per tool, `ToolDef` interface, `messages.ts`
  i18n, unit↔cent conversion, UUID validation, an echo of the affected object for chaining.
- Destructive operations are gated behind an explicit `confirm_delete` parameter **and** the
  existing `ENABLE_WRITE` flag; archiving (`hidden`) is offered as the non-destructive default.
- Every mutation calls `api.sync()` before returning, so the change reaches the server.

### Non-goals

- **Account management.** Creating, closing or editing accounts stays manual — it happens
  rarely and by hand. No account tools here.
- **Retrofitting the 8 existing write tools** to call `api.sync()` post-write. They rely on
  the local `readBack` probe and the next `ensureReady` sync; changing them is a separate
  decision and risks regressing shipped behaviour. New tools adopt the post-write sync; old
  ones are left untouched.
- **Sugar helpers for rules.** `create_rule` takes the full generic rule object. High-level
  wrappers (e.g. `create_category_rule`) are deliberately omitted (YAGNI) — the model composes
  the rule object from the generic schema.
- **The demo instance.** The reviewer-facing demo Actual server (a Connectors Directory
  requirement, and the intended empirical-verification target for these tools) is a **sibling
  spec** covering infrastructure and deployment, not part of this one. See "Verification".

## Common architecture

All new tools follow the established pattern in `src/tools/` and register through
`src/tools/index.ts`. The wiring, gating, result envelope and error handling in
`src/core/server.ts` are reused unchanged.

- **Gating.** Mutations declare `readOnly: false` and are only registered when `ENABLE_WRITE`
  is on. The three new reads (`get_payees`, `get_account_transfer_payee`, `get_rules`) declare
  `readOnly: true` and register always.
- **Naming.** New reads use the repo's `get_*` convention (`get_payees`, `get_rules`), not the
  `list_*` names from the original request — consistency with `get_accounts`, `get_categories`,
  `get_transactions`, `get_schedules`.
- **Post-write sync.** A new helper `src/core/write-sync.ts` exposes `syncAfterWrite(api)`,
  which awaits `api.sync()`. Every new mutation calls it after the write and before building
  its echo. This satisfies the "sync after each write" requirement and keeps the concern in
  one place.
- **Money.** Amounts cross the boundary in currency units and convert with `src/core/money.ts`
  (`toCents`/`fromCents`). This applies to rule conditions/actions on the `amount` field too.
- **Validation.** Ids validate as strict UUID via `ID` from `src/core/types.ts` (the AQL
  compiler interpolates `id` values unescaped, so this is the only barrier). New validation
  indexes mirror `getCategoryIndex`: a category-group index, a payee index (by id and by
  `transfer_acct`), and reuse of the account list for transfer resolution.
- **Errors & i18n.** All user-facing errors are actionable and defined in `src/core/messages.ts`
  with ES/EN variants, matching every existing tool.
- **Echo.** Each mutation returns the affected object (id + relevant fields) so operations
  chain. Creates return `{ id, … }`; updates/deletes return the resulting/affected object.

### API reference (verified against `@actual-app/api` 26.7.0)

| Method | Signature | Returns |
|---|---|---|
| `createCategoryGroup` | `({ name, is_income? })` | `string` (id) |
| `updateCategoryGroup` | `(id, fields)` | `void` |
| `deleteCategoryGroup` | `(id, transferCategoryId?)` | `void` |
| `createCategory` | `({ name, group_id, is_income? })` | `string` (id) |
| `updateCategory` | `(id, fields)` | `void` |
| `deleteCategory` | `(id, transferCategoryId?)` | `void` |
| `getPayees` | `()` | `APIPayeeEntity[]` — `{ id, name, transfer_acct }` |
| `getRules` | `()` | `RuleEntity[]` |
| `createRule` | `(rule)` | the created rule (with `id`) |
| `updateRule` | `(rule)` | the updated rule — **takes the full rule object incl. `id`** |
| `deleteRule` | `(id)` | `boolean` |

Confirmed model facts that shape the schemas:

- `APICategoryEntity` fields are `id, name, is_income, hidden, group_id` (the field is
  `group_id`, not `cat_group`).
- Rule `stage` is `'pre' | null | 'post'` — the original request's `'default'` maps to `null`.
- Rule condition fields: `account, amount, category, category_group, date, notes, payee,
  imported_payee, saved, cleared, reconciled, transfer`. Ops are field-dependent (e.g. `is`,
  `isNot`, `oneOf`, `contains`, `matches`, `gt`, `lt`, `isapprox`, `isbetween`). The schema
  validates the field against the known set and the op against the known op set; it does not
  encode the full field×op matrix (fragile) — Actual validates the cross internally.

## Phase 1 — Taxonomy (category groups + categories)

Six tools. Enables creating the new groups, moving categories between groups, and the
non-destructive-first delete flow.

| Tool | Input | Behaviour |
|---|---|---|
| `create_category_group` | `name`, `is_income=false` | `createCategoryGroup`; echoes `{ id, name, is_income }`. |
| `update_category_group` | `id`, `{ name?, hidden? }` | `updateCategoryGroup`; rename / archive. At least one field required. |
| `delete_category_group` | `id`, `confirm_delete`, `transfer_category_id?` | Destructive. `confirm_delete:true` required or it errors suggesting `update_category_group(hidden:true)`. Documents Actual's child-category behaviour (below). |
| `create_category` | `name`, `group_id`, `is_income=false` | `createCategory`; validates `group_id` exists first; echoes `{ id, name, group_id }`. |
| `update_category` | `id`, `{ name?, group_id?, hidden? }` | `updateCategory`; rename / move group / archive. If `group_id` given, validate it exists. At least one field required. |
| `delete_category` | `id`, `confirm_delete`, `transfer_category_id?` | Destructive. See delete semantics below. |

### Delete semantics (categories and groups)

The delete flow has two guards, in order:

1. **Confirmation.** Without `confirm_delete: true`, the tool does not delete. It returns an
   actionable error that names the non-destructive alternative (`hidden: true` via the
   matching `update_*` tool). This is a second net on top of the MCP client's own permission
   prompt.
2. **Reassignment.** Actual's `deleteCategory(id, transferCategoryId?)` moves the category's
   transactions to `transferCategoryId`. If the category has transactions and no
   `transfer_category_id` is supplied, the tool errors explaining that a destination is
   required (and that the transactions would otherwise be orphaned). When `transfer_category_id`
   is supplied it is validated as an existing category before the call.

For **groups**, `deleteCategoryGroup(id, transferCategoryId?)` behaves analogously for the
group's child categories' transactions. The tool documents in its description that deleting a
group removes its child categories; the same confirmation + reassignment guards apply. The
exact child-handling (Actual deleting vs. requiring a transfer target) is confirmed empirically
during implementation and the description is written to match observed behaviour.

## Phase 2 — Transfers & payees

Three tools plus an enhancement to the existing `update_transaction`.

| Tool | Input | Behaviour |
|---|---|---|
| `get_payees` | — (read) | `getPayees()`; returns `{ id, name, transfer_acct }[]`. `transfer_acct` identifies transfer payees. |
| `get_account_transfer_payee` | `account_id` (read) | Sugar: the payee whose `transfer_acct === account_id`. Returns the payee or an actionable "no transfer payee for this account" error. |
| `set_transaction_transfer` | `transaction_id`, `target_account_id` | Resolves the target account's transfer payee (via `getPayees`), then `updateTransaction(id, { payee })`. Handles the already-a-transfer case (re-point to a new destination). |

### `set_transaction_transfer` — the uncertain part

This is the key tool for the "bridge accounts" model (Adelantos Taiko, Cuenta con Mercedes).
Actual's behaviour when you set a transaction's payee to a transfer payee — specifically
whether it **auto-creates and links the counterpart leg** (`transfer_id`) on the target
account — is **verified empirically** during Phase 2, not assumed. Two outcomes and their
handling:

- **Actual links the counterpart automatically.** The tool returns the updated transaction
  with its `transfer_id`, and the description documents the automatic linking.
- **It does not.** The tool documents the limitation and, if a manual counterpart is needed,
  the implementation creates and links it explicitly. Which path we take is decided by the
  empirical result, recorded in the implementation plan.

The echo reports `transfer_id` (present or null) so the caller can tell whether the leg linked.

### `update_transaction` enhancement

The existing tool gains two inputs without changing its response shape:

- `category_id: null` — explicitly clears the category (an uncategorized entry). Today the
  field is optional-omit; it must accept an explicit `null` distinct from "not provided".
- `payee_id` — set the payee by id (alongside the existing `payee_name`, which resolves/creates).

`notes` is already supported. The `null`-vs-absent distinction is handled in the Zod schema
(`.nullable()` on `category_id`) and in the field-assembly logic.

## Phase 3 — Rules

Four tools over Actual's rule engine. Generic and well-validated (the model composes the rule
object); no sugar wrappers.

| Tool | Input | Behaviour |
|---|---|---|
| `get_rules` | — (read) | `getRules()`. |
| `create_rule` | `rule` | `createRule(rule)`; returns the created rule with its `id`. |
| `update_rule` | `rule` (incl. `id`) | `updateRule(rule)` — the full rule object, as the API requires. |
| `delete_rule` | `id` | `deleteRule(id)`. |

### Rule schema (Zod)

```
rule = {
  stage: 'pre' | 'post' | null,           // 'default' from the request maps to null
  conditionsOp: 'and' | 'or',
  conditions: [{ field, op, value }],     // field ∈ known set; op ∈ known op set
  actions:    [{ op: 'set', field, value, options? }],
}
```

Validation:

- `stage`, `conditionsOp` against their enums; `null` accepted for `stage`.
- `conditions` / `actions` are non-empty arrays of the right shape.
- `field` validated against the known condition/action field set; `op` against the known op set.
- Any value that is an id (fields `account`, `category`, `category_group`, `payee`) validates
  as UUID — the same AQL-injection barrier as everywhere else.
- `amount` values convert units→cents (conditions and set-actions alike).

### Rule use cases (acceptance criteria)

1. Condition `payee` / `imported_payee` / `notes` `contains`/`is` X → action `set category = Y`.
   Created via `create_rule` and confirmed to apply to a matching transaction.
2. Auto-transfer via rule: action `set payee = <transfer payee>`. Whether Actual's rules allow
   setting the payee to a transfer payee **and** whether that marks the transaction as a
   transfer is **verified empirically**. If unsupported, the limitation is documented and the
   fallback is post-processing with `set_transaction_transfer`.

## Error handling & messages

New `messages.ts` entries (ES/EN) cover, at minimum: missing-field-to-update, category/group
not found, group-id not found on create/move, delete-needs-confirmation (names the `hidden`
alternative), delete-needs-reassignment (category has transactions), no-transfer-payee for
account, unknown rule field/op, and rule id/uuid errors. All follow the existing actionable
style.

## Verification

- **TDD with a mocked API**, per tool, matching the existing test suite's structure. Every
  acceptance criterion above is written as a test. The delete guards, the `null`-vs-absent
  category distinction, and the rule schema validation are unit-tested against the mock.
- **Empirical verification** at the close of each phase, against a **real Actual server**,
  using clearly marked test data that is cleaned up afterwards — the same pattern used in
  Plans 2 and 3. This is the only way to confirm the transfer counterpart leg and that a rule
  actually applies.
- **Verification target.** The intended target is the **demo instance** defined in the sibling
  spec, so verification never touches real household data and validates the demo in passing.
  While the demo is not yet available, the fallback is the maintainer's real budget with marked
  test data and cleanup. TDD development does not depend on either — it runs on mocks.

## Versioning & manifest

- Bump `package.json` and `manifest.json` in lock-step: `2.1.0` → `2.2.0`.
- Register all 13 new tools in `manifest.json`'s tool catalogue (with the mandatory `title`).
  After this work the catalogue is **29 tools** (11 read + 18 write); `ENABLE_WRITE` off
  exposes the 11 reads, on exposes all 29.
- `tests/bundle/manifest.test.ts` enforces both the version match and the tool catalogue, so
  these updates are non-optional and covered by the suite.

## Open questions resolved during implementation (empirical)

1. Does `set_transaction_transfer` auto-link the counterpart leg (`transfer_id`)?
2. Does `deleteCategoryGroup` delete child categories outright, or require a transfer target
   for their transactions?
3. Can an Actual rule set the payee to a transfer payee, and does that mark the transaction as
   a transfer?

Each is answered against the real/demo server during the relevant phase and the tool
descriptions and behaviour are finalized to match.
