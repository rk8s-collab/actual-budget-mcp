// Standalone (non-vitest) empirical check of the Phase 2 tools (set_transaction_transfer, plus
// update_transaction's new category_id: null / payee_id support) against a REAL Actual server.
// Unit tests run against a mock and prove our logic; this proves Actual's actual behaviour --
// in particular whether pointing a transaction at another account's transfer payee really
// creates and LINKS a counterpart transaction on that account (open question 1 from the spec),
// what happens to the category on same-side vs opposite-side account pairs, and what re-pointing
// an existing transfer does to the old counterpart -- none of which a mock can demonstrate.
//
// Bootstrap block modelled on scripts/demo/reset-check.ts (temp data dir, try/finally
// shutdown+cleanup, machine-readable RESULT= summary), same shape as
// scripts/verify/phase1-taxonomy.ts and scripts/verify/phase3-rules.ts: download-an-existing
// budget via ACTUAL_SYNC_ID + api.downloadBudget, since this verifies against an already-seeded
// budget rather than creating one. Uses scripts/demo/env.ts's loadDemoEnv so a missing env var
// fails loudly instead of silently defaulting.
//
// Drives the tool handlers directly (tool.handler(input, { api, config })), the same shape used
// in tests/tools/*.test.ts, bypassing MCP entirely. Falls back to api.runQuery directly (via the
// same q()/filter()/select() idiom as src/core/tx-read.ts) to read the counterpart leg -- there
// is no "get counterpart transaction" tool in the catalogue, so the raw API is the only way to
// look at the OTHER side of a transfer.
//
// Run standalone, NOT under vitest: NODE_ENV=test makes @actual-app/api take an eager resync
// path that hangs on deletes (see reset-check.ts's header comment) -- the reason this is a
// separate tsx script instead of a vitest integration test.
//
//   ACTUAL_SERVER_URL=… ACTUAL_SERVER_PASSWORD=… ACTUAL_SYNC_ID=… npx tsx scripts/verify/phase2-transfers.ts
//
// All test data (transactions and any leftover payee) is prefixed "ZZZ Verify Transfer" and is
// deleted again in the cleanup step (run unconditionally after the checks, so it also fires --
// best-effort -- if a check throws partway through).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as api from '@actual-app/api';
import { loadDemoEnv } from '../demo/env.js';
import { loadConfig } from '../../src/core/config.js';
import { getPayeeIndex } from '../../src/core/payees.js';
import { getTransactionById } from '../../src/core/tx-read.js';
import { tool as getAccounts } from '../../src/tools/get_accounts.js';
import { tool as getCategories } from '../../src/tools/get_categories.js';
import { tool as createTransaction } from '../../src/tools/create_transaction.js';
import { tool as setTransactionTransfer } from '../../src/tools/set_transaction_transfer.js';
import { tool as updateTransaction } from '../../src/tools/update_transaction.js';

const NAME_PREFIX = 'ZZZ Verify Transfer';
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
 *  informative outcome (e.g. "does the category survive on an opposite-side transfer?"). Does
 *  not count towards counts.total/passed and never throws. Same idiom as
 *  scripts/verify/phase3-rules.ts's record(). */
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

/** Reads the raw transaction row(s) on `accountId` whose transfer_id equals `transferId`, the
 *  same q()/filter()/select(['*']) idiom src/core/tx-read.ts's getTransactionById uses, but
 *  filtered by account+transfer_id instead of id -- there is no tool that reads "the other leg
 *  of a transfer" directly, so this is how the script looks at the counterpart. */
async function findByTransferId(accountId: string, transferId: string): Promise<any[]> {
  const { data } = (await (api as any).runQuery(
    (api as any)
      .q('transactions')
      .filter({ account: accountId })
      .filter({ transfer_id: transferId })
      .options({ splits: 'grouped' })
      .select(['*']),
  )) as { data: any[] };
  return data as any[];
}

/** Best-effort teardown: deletes every verification transaction created, then sweeps
 *  api.getPayees() for any leftover payee whose name carries NAME_PREFIX (created by
 *  create_transaction's payee_name on the ordinary-transaction test in check 7, then abandoned
 *  once update_transaction re-points the transaction to a pre-existing payee). Never throws --
 *  a cleanup failure must not mask the real check result. */
async function cleanup(txIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(txIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  for (const id of uniqueIds) {
    try {
      await api.deleteTransaction(id);
      console.log(`CLEANUP deleted verification transaction ${id}`);
    } catch (err) {
      console.warn(`CLEANUP WARNING could not delete transaction ${id}: ${(err as Error).message}`);
    }
  }
  try {
    const payees = ((await api.getPayees()) ?? []) as any[];
    for (const p of payees) {
      if (typeof p.name === 'string' && p.name.startsWith(NAME_PREFIX)) {
        try {
          await api.deletePayee(p.id);
          console.log(`CLEANUP deleted leftover payee "${p.name}" (${p.id})`);
        } catch (err) {
          console.warn(`CLEANUP WARNING could not delete payee ${p.id}: ${(err as Error).message}`);
        }
      }
    }
  } catch (err) {
    console.warn(`CLEANUP WARNING payee sweep failed: ${(err as Error).message}`);
  }
}

async function run(): Promise<number> {
  const env = loadDemoEnv(['ACTUAL_SERVER_URL', 'ACTUAL_SERVER_PASSWORD', 'ACTUAL_SYNC_ID']);
  const config = loadConfig(process.env);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-verify-phase2-'));
  const txIds: string[] = [];
  let failed = false;

  try {
    await api.init({ dataDir, serverURL: env.ACTUAL_SERVER_URL, password: env.ACTUAL_SERVER_PASSWORD });
    await api.downloadBudget(env.ACTUAL_SYNC_ID);

    const ctx = { api, config };

    try {
      // --- Step 1: pick account pairs from get_accounts. ---
      // Preconditions: at least 3 on-budget accounts (two for the same-side pair, a third to
      // re-point the transfer to in check 6) and at least 1 category (to categorize the source
      // legs so the category-survives-or-not question in check 5 has something to observe). Both
      // are true of the seeded demo budget; fail loudly and early if not. An off-budget account is
      // used for the opposite-side pair if the budget has one, but its absence does not fail the
      // script -- that half of check 5 is then skipped and recorded as such.
      const accountsResult: any = await getAccounts.handler({ include_closed: false, include_off_budget: true }, ctx);
      const allAccounts: any[] = accountsResult.accounts ?? [];
      const onBudget = allAccounts.filter((a) => a.on_budget);
      const offBudget = allAccounts.filter((a) => !a.on_budget);
      if (onBudget.length < 2) {
        throw new Error(`Budget needs at least 2 on-budget accounts to verify a same-side transfer (found ${onBudget.length})`);
      }
      const sameA = onBudget[0].id as string;
      const sameB = onBudget[1].id as string;
      // A third, distinct account to re-point the same-side transfer to in check 6. A third
      // ON-budget account is preferred (keeps the re-point itself same-side), but the brief only
      // asks for "a third account" -- an off-budget one still proves check 6's real claim (no
      // second counterpart appears), it just makes the re-point cross budget sides too.
      const thirdAccount = onBudget[2] ?? offBudget[0];
      if (!thirdAccount) {
        throw new Error('Budget needs a third account (on- or off-budget) distinct from the same-side pair to verify re-pointing');
      }
      const sameC = thirdAccount.id as string;
      const hasOffBudget = offBudget.length > 0;
      // Reuses sameA when there is no 4th on-budget account -- a second, independent test
      // transaction on an account that already holds one is not a conflict (accounts hold many
      // transactions); it just means the opposite-side pair's on-budget leg is not exclusive to it.
      const oppositeOnBudgetId = (onBudget[3]?.id ?? sameA) as string;
      const oppositeOffBudgetId = offBudget[0]?.id as string | undefined;

      const catsResult: any = await getCategories.handler({}, ctx);
      const allCats = catsResult.groups.flatMap((g: any) => g.categories);
      if (!allCats.length) throw new Error('Budget has no categories -- cannot verify category behaviour on a transfer');
      const categoryId = allCats[0].id as string;

      // A pre-existing, non-transfer payee is needed as the update_transaction(payee_id) target
      // in check 7 -- picked once, up front, before this script creates any payee of its own, so
      // it can never accidentally be one of ours.
      const { all: payeesBefore } = await getPayeeIndex(api);
      const normalPayees = payeesBefore.filter((p) => !p.transfer_acct && !p.name.startsWith(NAME_PREFIX));
      if (!normalPayees.length) {
        throw new Error('Budget has no pre-existing non-transfer payee -- cannot verify update_transaction(payee_id)');
      }
      const targetPayeeId = normalPayees[0].id;

      // Steps 2-5, parameterised so the same sequence runs for the same-side pair (required) and
      // the opposite-side pair (only if the budget has an off-budget account). Returns the source
      // transaction id and the counterpart id so check 6 can re-point the same-side leg.
      async function testTransferPair(label: string, fromAccountId: string, toAccountId: string, amount: number): Promise<{ txId: string; counterpartId: string }> {
        // 2. Plain categorized transaction on the first account.
        const created: any = await createTransaction.handler(
          {
            account_id: fromAccountId,
            date: TX_DATE,
            amount,
            category_id: categoryId,
            notes: `${NAME_PREFIX} ${label} source`,
          },
          ctx,
        );
        const txId: string | undefined = created?.transaction?.id;
        check(`${label} 2 create_transaction returns an id`, typeof txId === 'string' && txId.length > 0, created);
        if (txId) txIds.push(txId);

        // 3. set_transaction_transfer towards the second account.
        const transferResult: any = await setTransactionTransfer.handler({ transaction_id: txId, target_account_id: toAccountId }, ctx);
        check(`${label} 3 set_transaction_transfer reports updated:true`, transferResult?.updated === true, transferResult);

        // 4. Assert the counterpart exists: read the target account's transactions and find the
        // row whose transfer_id is the original id, with the opposite amount.
        const reportedCounterpartId: string | null = transferResult?.transfer_id ?? null;
        check(`${label} 4a set_transaction_transfer's own response reports a transfer_id`, typeof reportedCounterpartId === 'string' && reportedCounterpartId.length > 0, transferResult);

        const counterpartRows = await findByTransferId(toAccountId, txId as string);
        check(`${label} 4b exactly one counterpart row exists on the target account`, counterpartRows.length === 1, counterpartRows);
        const counterpart = counterpartRows[0];
        check(`${label} 4c counterpart id matches what set_transaction_transfer reported`, counterpart?.id === reportedCounterpartId, { reportedCounterpartId, counterpart });

        const sourceRaw = await getTransactionById(api, txId as string);
        check(
          `${label} 4d counterpart amount is the exact negation of the source (cents)`,
          typeof sourceRaw?.amount === 'number' && counterpart?.amount === -sourceRaw.amount,
          { sourceAmount: sourceRaw?.amount, counterpartAmount: counterpart?.amount },
        );
        // Bonus, not required by the brief but cheap given sourceRaw is already in hand: confirms
        // the link is mutual (source.transfer_id -> counterpart, counterpart.transfer_id -> source),
        // not just one-directional.
        check(
          `${label} 4e (bonus) source row's own transfer_id points back to the counterpart (mutual link)`,
          sourceRaw?.transfer_id === counterpart?.id,
          { sourceTransferId: sourceRaw?.transfer_id, counterpartId: counterpart?.id },
        );

        // 5. Category behaviour -- RECORDED, not asserted. The tool description claims same-side
        // clears the category on both legs and opposite-side leaves it; that claim is exactly what
        // this script exists to prove or disprove, so a wrong answer here must not abort the run
        // before the remaining checks (6-8) get a chance to run too. Same idiom as
        // scripts/verify/phase3-rules.ts's record() for its own open question.
        record(`${label} 5 source category_id after transfer`, sourceRaw?.category ?? null);
        record(`${label} 5 counterpart category_id`, counterpart?.category ?? null);
        record(`${label} 5 category cleared on both legs`, (sourceRaw?.category ?? null) === null && (counterpart?.category ?? null) === null);

        return { txId: txId as string, counterpartId: counterpart?.id as string };
      }

      const samePair = await testTransferPair('same-side', sameA, sameB, -12.34);
      if (samePair.counterpartId) txIds.push(samePair.counterpartId);

      if (hasOffBudget && oppositeOffBudgetId) {
        const oppositePair = await testTransferPair('opposite-side', oppositeOnBudgetId, oppositeOffBudgetId, -23.45);
        if (oppositePair.counterpartId) txIds.push(oppositePair.counterpartId);
      } else {
        console.log('SKIP opposite-side pair: budget has no off-budget account');
        record('opposite-side pair tested', false);
      }

      // 6. Re-point the same-side transfer to a third account; assert no second counterpart
      // appeared -- i.e. across the whole budget there is still exactly ONE row linked to the
      // source transaction's id, now on the NEW target account, and none left behind on the old
      // one (whether Actual moves the same row or deletes+recreates it is itself an open question,
      // recorded below rather than assumed).
      const repointResult: any = await setTransactionTransfer.handler({ transaction_id: samePair.txId, target_account_id: sameC }, ctx);
      check('6a re-point set_transaction_transfer reports updated:true', repointResult?.updated === true, repointResult);

      const oldSideRows = await findByTransferId(sameB, samePair.txId);
      const newSideRows = await findByTransferId(sameC, samePair.txId);
      check('6b old target account no longer holds a counterpart for the re-pointed transaction', oldSideRows.length === 0, oldSideRows);
      check('6c new target account holds exactly one counterpart after re-pointing (no second counterpart appeared)', newSideRows.length === 1, newSideRows);
      const newCounterpartId: string | undefined = newSideRows[0]?.id;
      if (newCounterpartId) txIds.push(newCounterpartId);
      record('6d counterpart id stability across re-point (same id reused vs a new row created)', {
        oldCounterpartId: samePair.counterpartId,
        newCounterpartId: newCounterpartId ?? null,
        reused: newCounterpartId === samePair.counterpartId,
      });

      // 7. update_transaction({ category_id: null }) on an ordinary (non-transfer) transaction,
      // then payee_id, each asserted against a fresh re-read.
      const ordinary: any = await createTransaction.handler(
        {
          account_id: sameC,
          date: TX_DATE,
          amount: -5.0,
          category_id: categoryId,
          payee_name: `${NAME_PREFIX} Ordinary Payee`,
          notes: `${NAME_PREFIX} ordinary`,
        },
        ctx,
      );
      const ordinaryTxId: string | undefined = ordinary?.transaction?.id;
      check('7a create_transaction (ordinary) returns an id', typeof ordinaryTxId === 'string' && ordinaryTxId.length > 0, ordinary);
      if (ordinaryTxId) txIds.push(ordinaryTxId);

      const clearResult: any = await updateTransaction.handler({ transaction_id: ordinaryTxId, category_id: null }, ctx);
      check('7b update_transaction(category_id:null) reports updated:true', clearResult?.updated === true, clearResult);
      check('7c update_transaction(category_id:null) echo shows category_id:null', clearResult?.transaction?.category_id === null, clearResult);
      const afterClearRaw = await getTransactionById(api, ordinaryTxId as string);
      check('7d re-read confirms the category is actually cleared', (afterClearRaw?.category ?? null) === null, afterClearRaw);

      const payeeResult: any = await updateTransaction.handler({ transaction_id: ordinaryTxId, payee_id: targetPayeeId }, ctx);
      check('7e update_transaction(payee_id) reports updated:true', payeeResult?.updated === true, payeeResult);
      // mapTxEcho names this field "payee" (holding the raw id when no payee_name was echoed),
      // not "payee_id" -- see src/core/tx-read.ts's mapTxEcho.
      check('7f update_transaction(payee_id) echo shows the requested payee', payeeResult?.transaction?.payee === targetPayeeId, { targetPayeeId, echo: payeeResult?.transaction });
      const afterPayeeRaw = await getTransactionById(api, ordinaryTxId as string);
      check('7g re-read confirms the payee actually changed', afterPayeeRaw?.payee === targetPayeeId, afterPayeeRaw);
    } catch (err) {
      failed = true;
      console.error(err instanceof Error ? err.message : err);
    }

    // 8a. Cleanup: always runs, even on failure, so partial test data never lingers in the budget.
    await cleanup(txIds);

    // 8b. Confirm nothing marked "ZZZ Verify" is left, per the brief's own wording for this step
    // -- an explicit assertion, not just a best-effort sweep, run in its own try/catch so a
    // failure here is reported the same way (FAIL line, failed=true) without masking whatever
    // happened in the checks above.
    try {
      const { data: leftoverTx } = (await (api as any).runQuery(
        (api as any).q('transactions').filter({ notes: { $like: `%${NAME_PREFIX}%` } }).select(['id', 'notes']),
      )) as { data: any[] };
      check('8c no transaction with a ZZZ Verify note remains after cleanup', ((leftoverTx as any[]) ?? []).length === 0, leftoverTx);
      const leftoverPayees = ((await api.getPayees()) ?? []).filter((p: any) => typeof p.name === 'string' && p.name.startsWith(NAME_PREFIX));
      check('8d no ZZZ Verify payee remains after cleanup', leftoverPayees.length === 0, leftoverPayees);
    } catch (err) {
      failed = true;
      console.error(err instanceof Error ? err.message : err);
    }

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
