// Standalone (non-vitest) empirical check of the Phase 3 rule tools (create/update/delete_rule,
// get_rules) against a REAL Actual server. Unit tests run against a mock and prove our logic;
// this proves Actual's actual behaviour -- in particular WHICH import path actually runs rules
// (create_transaction's api.addTransactions, vs api.importTransactions directly) and whether a
// rule action of `set payee = <transfer payee id>` produces a real linked transfer, neither of
// which a mock can demonstrate.
//
// Bootstrap block modelled on scripts/demo/reset-check.ts (temp data dir, try/finally
// shutdown+cleanup, machine-readable RESULT= summary), same shape as scripts/verify/phase1-taxonomy.ts:
// download-an-existing-budget via ACTUAL_SYNC_ID + api.downloadBudget, since this verifies
// against an already-seeded budget rather than creating one. Uses scripts/demo/env.ts's
// loadDemoEnv so a missing env var fails loudly instead of silently defaulting.
//
// Drives the tool handlers directly (tool.handler(input, { api, config })), the same shape used
// in tests/tools/*.test.ts, bypassing MCP entirely. Falls back to api.importTransactions directly
// (not a tool -- there is no import_transactions tool in this catalogue) when that is the path
// needed to prove a rule fires, per the spec's open question on acceptance criterion 1.
//
// Run standalone, NOT under vitest: NODE_ENV=test makes @actual-app/api take an eager resync
// path that hangs on deletes (see reset-check.ts's header comment) -- the reason this is a
// separate tsx script instead of a vitest integration test.
//
//   ACTUAL_SERVER_URL=… ACTUAL_SERVER_PASSWORD=… ACTUAL_SYNC_ID=… npx tsx scripts/verify/phase3-rules.ts
//
// All test data is prefixed "ZZZ Verify Rule" and is deleted again in the cleanup step (run from
// a `finally`, so it also fires -- best-effort -- if a check throws partway through).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as api from '@actual-app/api';
import { loadDemoEnv } from '../demo/env.js';
import { loadConfig } from '../../src/core/config.js';
import { toCents } from '../../src/core/money.js';
import { getTransactionById } from '../../src/core/tx-read.js';
import { tool as createRule } from '../../src/tools/create_rule.js';
import { tool as updateRule } from '../../src/tools/update_rule.js';
import { tool as deleteRule } from '../../src/tools/delete_rule.js';
import { tool as getRules } from '../../src/tools/get_rules.js';
import { tool as getCategories } from '../../src/tools/get_categories.js';
import { tool as getAccountTransferPayee } from '../../src/tools/get_account_transfer_payee.js';
import { tool as createTransaction } from '../../src/tools/create_transaction.js';

const NAME_PREFIX = 'ZZZ Verify Rule';
const PAYEE_CAT = `${NAME_PREFIX} Category Payee`; // matches the category-setting rule (checks 1-3)
const PAYEE_XFER = `${NAME_PREFIX} Xfer Trigger`; // matches the transfer-payee rule (check 4); no
// substring overlap with PAYEE_CAT on purpose, so the two rules can never cross-fire on each other's
// test transaction.
const TX_DATE = new Date().toISOString().slice(0, 10);

const counts = { total: 0, passed: 0 };

/** Prints one OK/FAIL line per check. Throws on failure so the run stops at the first one. */
function check(label: string, cond: boolean, detail?: unknown): void {
  counts.total += 1;
  if (cond) {
    counts.passed += 1;
    console.log(`OK   ${label}`);
    return;
  }
  console.log(`FAIL ${label}${detail !== undefined ? ' -- ' + safeJson(detail) : ''}`);
  throw new Error(`check failed: ${label}`);
}

/** Logs an open-question finding that is not itself a pass/fail: either answer is a valid,
 *  informative outcome (e.g. "does a transfer-payee rule action link a transfer?"). Does not
 *  count towards counts.total/passed and never throws. */
function record(label: string, value: unknown): void {
  console.log(`RECORD ${label} = ${safeJson(value)}`);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Best-effort teardown: deletes every verification transaction and rule created, regardless of
 *  how far the checks above got. Never throws -- a cleanup failure must not mask the real check
 *  result. Sweeps get_rules for anything mentioning NAME_PREFIX too, so a rule created just
 *  before a later check threw is not left behind even if its id was never recorded. */
async function cleanup(txIds: string[], ruleIds: string[]): Promise<void> {
  for (const txId of txIds) {
    try {
      await api.deleteTransaction(txId);
      console.log(`CLEANUP deleted verification transaction ${txId}`);
    } catch (err) {
      console.warn(`CLEANUP WARNING could not delete transaction ${txId}: ${(err as Error).message}`);
    }
  }
  try {
    const rules = ((await api.getRules()) ?? []) as any[];
    for (const r of rules) {
      const mentionsPrefix = JSON.stringify(r.conditions ?? []).includes(NAME_PREFIX);
      if (ruleIds.includes(r.id) || mentionsPrefix) {
        try {
          const ok = await api.deleteRule(r.id);
          if (ok === false) {
            console.warn(`CLEANUP WARNING delete_rule refused for leftover rule ${r.id} (schedule-linked?)`);
          } else {
            console.log(`CLEANUP deleted leftover rule ${r.id}`);
          }
        } catch (err) {
          console.warn(`CLEANUP WARNING could not delete rule ${r.id}: ${(err as Error).message}`);
        }
      }
    }
  } catch (err) {
    console.warn(`CLEANUP WARNING rule sweep failed: ${(err as Error).message}`);
  }
}

async function run(): Promise<number> {
  const env = loadDemoEnv(['ACTUAL_SERVER_URL', 'ACTUAL_SERVER_PASSWORD', 'ACTUAL_SYNC_ID']);
  const config = loadConfig(process.env);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-verify-phase3-'));
  const txIds: string[] = [];
  const ruleIds: string[] = [];
  let failed = false;

  try {
    await api.init({ dataDir, serverURL: env.ACTUAL_SERVER_URL, password: env.ACTUAL_SERVER_PASSWORD });
    await api.downloadBudget(env.ACTUAL_SYNC_ID);

    const ctx = { api, config };

    try {
      // Preconditions: two categories (rule target A, then B after update_rule) and two accounts
      // (one to create test transactions in, one whose transfer payee we point a rule action at).
      // Both are true of the seeded demo budget; fail loudly and early if not.
      const catsResult: any = await getCategories.handler({}, ctx);
      const allCats = catsResult.groups.flatMap((g: any) => g.categories);
      if (allCats.length < 2) throw new Error('Budget needs at least 2 categories to verify create_rule + update_rule');
      const categoryAId = allCats[0].id;
      const categoryBId = allCats[1].id;

      const accounts = ((await api.getAccounts()) ?? []) as any[];
      if (accounts.length < 2) throw new Error('Budget needs at least 2 accounts to verify a transfer-payee rule action');
      const accountId = accounts[0].id;
      const transferAccountId = accounts[1].id;

      const transferPayeeResult: any = await getAccountTransferPayee.handler({ account_id: transferAccountId }, ctx);
      const transferPayeeId: string | undefined = transferPayeeResult?.payee?.id;
      check('0 get_account_transfer_payee returns an id', typeof transferPayeeId === 'string' && transferPayeeId.length > 0, transferPayeeResult);

      // Imports a transaction via the tool catalogue's own create_transaction (which calls
      // api.addTransactions under the hood) and reads the row back fresh.
      async function importViaCreateTransaction(amount: number, payeeName: string): Promise<{ id: string | undefined; row: any }> {
        const result: any = await createTransaction.handler(
          { account_id: accountId, date: TX_DATE, amount, payee_name: payeeName },
          ctx,
        );
        const id: string | undefined = result?.transaction?.id;
        const row = id ? await getTransactionById(api, id) : null;
        return { id, row };
      }

      // Imports a transaction via api.importTransactions directly -- there is no tool wrapping
      // it, but the spec names this as the path rules are documented to hook into.
      async function importViaApi(amount: number, payeeName: string): Promise<{ id: string | undefined; row: any }> {
        const result: any = await api.importTransactions(accountId, [
          { account: accountId, date: TX_DATE, amount: toCents(amount), payee_name: payeeName },
        ]);
        const id: string | undefined = result?.added?.[0];
        const row = id ? await getTransactionById(api, id) : null;
        return { id, row };
      }

      // 1. Create the category rule; assert an id comes back.
      // Condition field is `imported_payee`, not `payee` -- see the finding recorded below:
      // `payee contains X` only matches an ALREADY-EXISTING payee (rules run before a brand-new
      // imported payee name is resolved into a payee row), so it can never fire on a payee's
      // first-ever import. `imported_payee` matches the raw imported text and does fire.
      const ruleResult: any = await createRule.handler(
        {
          stage: null,
          conditionsOp: 'and',
          conditions: [{ field: 'imported_payee', op: 'contains', value: PAYEE_CAT }],
          actions: [{ op: 'set', field: 'category', value: categoryAId }],
        },
        ctx,
      );
      const ruleId: string | undefined = ruleResult?.rule?.id;
      check('1 create_rule returns an id', typeof ruleId === 'string' && ruleId.length > 0, ruleResult);
      if (ruleId) ruleIds.push(ruleId);

      // 2. ACCEPTANCE CRITERION 1: rules run on import, not on existing rows. Try the tool
      // catalogue's own create_transaction (api.addTransactions) first; if that did not apply
      // the rule's category, fall back to api.importTransactions -- the path the spec documents
      // as the one rules actually hook -- and record which one (if either) actually triggers it.
      const first = await importViaCreateTransaction(-4.56, PAYEE_CAT);
      if (first.id) txIds.push(first.id);
      check('2a create_transaction (addTransactions path) returns a transaction id', typeof first.id === 'string' && first.id.length > 0, first);

      let ruleTriggerPath: 'create_transaction' | 'api.importTransactions' | 'neither' = 'neither';
      if (first.row?.category === categoryAId) {
        ruleTriggerPath = 'create_transaction';
      } else {
        const second = await importViaApi(-7.89, PAYEE_CAT);
        if (second.id) txIds.push(second.id);
        check('2b api.importTransactions returns a transaction id', typeof second.id === 'string' && second.id.length > 0, second);
        if (second.row?.category === categoryAId) ruleTriggerPath = 'api.importTransactions';
      }
      record('acceptance criterion 1 -- import path that triggers the rule', ruleTriggerPath);
      check('2c acceptance criterion 1: at least one import path applies the rule category', ruleTriggerPath !== 'neither', {
        createTransactionRow: first.row,
      });

      // 3. update_rule changing the target category; re-import through whichever path proved to
      // trigger rules above, and assert the NEW category is applied.
      const updateResult: any = await updateRule.handler(
        {
          id: ruleId,
          stage: null,
          conditionsOp: 'and',
          conditions: [{ field: 'imported_payee', op: 'contains', value: PAYEE_CAT }],
          actions: [{ op: 'set', field: 'category', value: categoryBId }],
        },
        ctx,
      );
      check('3a update_rule returns the same rule id', updateResult?.rule?.id === ruleId, updateResult);

      const triggerImport = ruleTriggerPath === 'create_transaction' ? importViaCreateTransaction : importViaApi;
      const third = await triggerImport(-1.23, PAYEE_CAT);
      if (third.id) txIds.push(third.id);
      check('3b update_rule + re-import returns a transaction id', typeof third.id === 'string' && third.id.length > 0, third);
      check(`3c updated rule applies the new category on re-import (via ${ruleTriggerPath})`, third.row?.category === categoryBId, third.row);

      // 4. ACCEPTANCE CRITERION 2 (open question 3 in the spec): a rule whose action is
      // `set payee = <transfer payee id>`. Import a matching transaction through the SAME
      // triggering path proven above, and check whether the resulting row has a transfer_id.
      // Either answer is a valid, recorded finding -- not a pass/fail -- because the spec's
      // documented fallback (post-process with set_transaction_transfer) exists precisely because
      // this was unknown. If it fails here, create_rule's description must say so and point at
      // set_transaction_transfer (left to whoever finishes live verification; NOT done in this
      // dispatch).
      const transferRuleResult: any = await createRule.handler(
        {
          stage: null,
          conditionsOp: 'and',
          conditions: [{ field: 'imported_payee', op: 'contains', value: PAYEE_XFER }],
          actions: [{ op: 'set', field: 'payee', value: transferPayeeId }],
        },
        ctx,
      );
      const transferRuleId: string | undefined = transferRuleResult?.rule?.id;
      check('4a create_rule (transfer-payee action) returns an id', typeof transferRuleId === 'string' && transferRuleId.length > 0, transferRuleResult);
      if (transferRuleId) ruleIds.push(transferRuleId);

      const fourth = await triggerImport(-9.99, PAYEE_XFER);
      if (fourth.id) txIds.push(fourth.id);
      check('4b transfer-payee rule test returns a transaction id', typeof fourth.id === 'string' && fourth.id.length > 0, fourth);

      const producesTransfer = typeof fourth.row?.transfer_id === 'string' && fourth.row.transfer_id.length > 0;
      record('acceptance criterion 2 -- rule setting payee=transfer-payee produces transfer_id', producesTransfer);
      if (producesTransfer) txIds.push(fourth.row.transfer_id); // the linked counterpart leg, also our test data

      // 5. delete_rule for every rule created; assert get_rules no longer lists them.
      for (const id of ruleIds) {
        const delResult: any = await deleteRule.handler({ id }, ctx);
        check(`5a delete_rule ${id} succeeds`, delResult?.deleted === true, delResult);
      }
      const afterDelete: any = await getRules.handler({}, ctx);
      const stillListed = (afterDelete.rules ?? []).some((r: any) => ruleIds.includes(r.id));
      check('5b get_rules no longer lists the verify rules', !stillListed, (afterDelete.rules ?? []).map((r: any) => r.id));
    } catch (err) {
      failed = true;
      console.error(err instanceof Error ? err.message : err);
    }

    // 6. Cleanup: always runs, even on failure, so partial test data (transactions AND any rule
    // that survived a mid-run throw) never lingers in the budget.
    await cleanup(txIds, ruleIds);

    console.log('RESULT=' + JSON.stringify({ checks_total: counts.total, checks_passed: counts.passed, failed }));
    return failed ? 1 : 0;
  } finally {
    try {
      await api.shutdown();
    } catch {}
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
