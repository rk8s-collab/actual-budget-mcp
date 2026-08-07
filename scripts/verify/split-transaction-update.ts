// Standalone (non-vitest) empirical check that @actual-app/api 26.8.0's updateTransaction fix
// (upstream PR #8467) behaves as the design spec assumes, against a REAL Actual server. Unit
// tests run against a mock and prove our logic; this proves Actual's actual behaviour --
// specifically whether converting a plain transaction into a split via
// updateTransaction(id, { subtransactions }) preserves fields the new split_transaction handler
// never sends (cleared, reconciled, imported_id, imported_payee), and that a reconciled
// transaction split with force:true keeps its reconciled/cleared state -- neither of which a
// mock can demonstrate.
//
// Bootstrap block modelled on scripts/verify/phase2-transfers.ts / phase3-rules.ts (temp data
// dir, try/finally shutdown+cleanup, machine-readable RESULT= summary): download-an-existing
// budget via ACTUAL_SYNC_ID + api.downloadBudget. Uses scripts/demo/env.ts's loadDemoEnv so a
// missing env var fails loudly instead of silently defaulting.
//
// Drives split_transaction's tool.handler directly (the same shape used in
// tests/tools/*.test.ts), bypassing MCP entirely. Falls back to api.addTransactions directly to
// seed imported_id/imported_payee/reconciled -- none of those fields are exposed by the
// create_transaction tool, so raw API access is the only way to set them up. `schedule` is
// deliberately NOT exercised here: linking a real schedule is disproportionate setup for this
// check, and its preservation follows the exact same reasoning as the other fields checked here
// (the new handler never includes it in the updateTransaction payload).
//
//   ACTUAL_SERVER_URL=… ACTUAL_SERVER_PASSWORD=… ACTUAL_SYNC_ID=… npx tsx scripts/verify/split-transaction-update.ts
//
// All test data is prefixed "ZZZ Verify Split268" and is deleted again in the cleanup step (run
// unconditionally after the checks, so it also fires -- best-effort -- if a check throws partway
// through).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as api from '@actual-app/api';
import { loadDemoEnv } from '../demo/env.js';
import { loadConfig } from '../../src/core/config.js';
import { candidateIds, newIdFromDiff, getTransactionById } from '../../src/core/tx-read.js';
import { tool as getAccounts } from '../../src/tools/get_accounts.js';
import { tool as getCategories } from '../../src/tools/get_categories.js';
import { tool as splitTransaction } from '../../src/tools/split_transaction.js';

const NAME_PREFIX = 'ZZZ Verify Split268';
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

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Best-effort teardown: deletes every verification transaction created, then sweeps for any
 *  stray row carrying the NAME_PREFIX note that wasn't tracked (e.g. an interrupted prior run) --
 *  self-healing rather than relying solely on txIds. Never throws -- a cleanup failure must not
 *  mask the real check result. */
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
    const { data: stray } = (await (api as any).runQuery(
      (api as any).q('transactions').filter({ notes: { $like: `%${NAME_PREFIX}%` } }).select(['id', 'notes']),
    )) as { data: any[] };
    for (const row of stray ?? []) {
      try {
        await api.deleteTransaction(row.id);
        console.log(`CLEANUP swept stray verification transaction ${row.id} (${row.notes})`);
      } catch (err) {
        console.warn(`CLEANUP WARNING could not delete stray transaction ${row.id}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    console.warn(`CLEANUP WARNING stray sweep failed: ${(err as Error).message}`);
  }
}

async function run(): Promise<number> {
  const env = loadDemoEnv(['ACTUAL_SERVER_URL', 'ACTUAL_SERVER_PASSWORD', 'ACTUAL_SYNC_ID']);
  const config = loadConfig(process.env);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-verify-split268-'));
  const txIds: string[] = [];
  let failed = false;

  try {
    await api.init({ dataDir, serverURL: env.ACTUAL_SERVER_URL, password: env.ACTUAL_SERVER_PASSWORD });
    await api.downloadBudget(env.ACTUAL_SYNC_ID);

    const ctx = { api, config };

    try {
      const accountsResult: any = await getAccounts.handler({ include_closed: false, include_off_budget: true }, ctx);
      const accountId = accountsResult.accounts?.[0]?.id as string | undefined;
      if (!accountId) throw new Error('Budget needs at least 1 account to verify split_transaction');

      const catsResult: any = await getCategories.handler({}, ctx);
      const allCats = catsResult.groups.flatMap((g: any) => g.categories);
      if (allCats.length < 2) throw new Error('Budget needs at least 2 categories to verify a 2-part split');
      const [catA, catB] = allCats;

      // --- Check group 1: plain (non-reconciled) transaction, no extra metadata. ---
      // addTransactions resolves to the literal "ok" (see @actual-app/api's addTransactions
      // .d.ts: Promise<"ok">), never ids -- the new row is found the same way
      // create_transaction.ts does it: a before/after candidateIds snapshot diff on
      // (account, date, amount).
      const plainBefore = new Set(await candidateIds(api, accountId, TX_DATE, -18000));
      await api.addTransactions(accountId, [
        { date: TX_DATE, amount: -18000, notes: `${NAME_PREFIX} plain`, cleared: false },
      ], { learnCategories: false, runTransfers: false });
      const plainDiff = newIdFromDiff(plainBefore, await candidateIds(api, accountId, TX_DATE, -18000));
      check('1a plain transaction created', typeof plainDiff.id === 'string' && plainDiff.id.length > 0, plainDiff);
      const plainTxId = plainDiff.id as string;
      txIds.push(plainTxId);

      const plainResult: any = await splitTransaction.handler(
        { transaction_id: plainTxId, splits: [
          { amount: -120, category_id: catA.id },
          { amount: -60, category_id: catB.id },
        ] },
        ctx,
      );
      check('1b split_transaction reports split:true', plainResult?.split === true, plainResult);
      check('1c original_id equals the id we split (no new row created)', plainResult?.original_id === plainTxId, plainResult);
      check('1d echoed transaction id equals the id we split', plainResult?.transaction?.id === plainTxId, plainResult);
      check('1e echo has 2 splits', plainResult?.transaction?.splits?.length === 2, plainResult);

      const plainRow = await getTransactionById(api, plainTxId);
      check('1f re-read shows is_parent:true', plainRow?.is_parent === true, plainRow);
      check('1g re-read shows 2 subtransactions', Array.isArray(plainRow?.subtransactions) && plainRow.subtransactions.length === 2, plainRow);
      const child = plainRow?.subtransactions?.[0];
      check('1h child inherits the parent account (upstream PR #8467 regression case)', child?.account === accountId, child);
      check('1i child inherits the parent date', child?.date === TX_DATE, child);

      // --- Check group 2: reconciled transaction, force:true. ---
      const reconciledBefore = new Set(await candidateIds(api, accountId, TX_DATE, -9000));
      await api.addTransactions(accountId, [
        { date: TX_DATE, amount: -9000, notes: `${NAME_PREFIX} reconciled`, cleared: true, reconciled: true },
      ], { learnCategories: false, runTransfers: false });
      const reconciledDiff = newIdFromDiff(reconciledBefore, await candidateIds(api, accountId, TX_DATE, -9000));
      check('2a reconciled transaction created', typeof reconciledDiff.id === 'string' && reconciledDiff.id.length > 0, reconciledDiff);
      const reconciledTxId = reconciledDiff.id as string;
      txIds.push(reconciledTxId);

      await splitTransaction.handler(
        { transaction_id: reconciledTxId, force: true, splits: [
          { amount: -60, category_id: catA.id },
          { amount: -30, category_id: catB.id },
        ] },
        ctx,
      );
      const reconciledRow = await getTransactionById(api, reconciledTxId);
      check('2b reconciled transaction keeps reconciled:true after splitting with force', !!reconciledRow?.reconciled, reconciledRow);
      check('2c reconciled transaction keeps cleared:true after splitting with force', !!reconciledRow?.cleared, reconciledRow);

      // --- Check group 3: imported_id/imported_payee survive untouched. ---
      const importedBefore = new Set(await candidateIds(api, accountId, TX_DATE, -4500));
      await api.addTransactions(accountId, [
        {
          date: TX_DATE, amount: -4500, notes: `${NAME_PREFIX} imported`, cleared: true,
          imported_id: `${NAME_PREFIX}-imp-1`, imported_payee: `${NAME_PREFIX} MERCADONA`,
        },
      ], { learnCategories: false, runTransfers: false });
      const importedDiff = newIdFromDiff(importedBefore, await candidateIds(api, accountId, TX_DATE, -4500));
      check('3a transaction with imported metadata created', typeof importedDiff.id === 'string' && importedDiff.id.length > 0, importedDiff);
      const importedTxId = importedDiff.id as string;
      txIds.push(importedTxId);

      await splitTransaction.handler(
        { transaction_id: importedTxId, splits: [
          { amount: -30, category_id: catA.id },
          { amount: -15, category_id: catB.id },
        ] },
        ctx,
      );
      const importedRow = await getTransactionById(api, importedTxId);
      check('3b imported_id survives splitting untouched', importedRow?.imported_id === `${NAME_PREFIX}-imp-1`, importedRow);
      check('3c imported_payee survives splitting untouched', importedRow?.imported_payee === `${NAME_PREFIX} MERCADONA`, importedRow);
    } catch (err) {
      failed = true;
      console.error(err instanceof Error ? err.message : err);
    }

    await cleanup(txIds);

    try {
      // deleteTransaction resolves before the delete lands (the same "write resolves before it
      // lands" race documented at length on readBack in src/core/tx-read.ts), so a query fired
      // immediately after cleanup() can still see rows that are already gone a moment later.
      // Poll briefly instead of asserting on the first read.
      let leftoverTx: any[] = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 200));
        const { data } = (await (api as any).runQuery(
          (api as any).q('transactions').filter({ notes: { $like: `%${NAME_PREFIX}%` } }).select(['id', 'notes']),
        )) as { data: any[] };
        leftoverTx = data ?? [];
        if (leftoverTx.length === 0) break;
      }
      check('4a no transaction with a ZZZ Verify note remains after cleanup', leftoverTx.length === 0, leftoverTx);
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
