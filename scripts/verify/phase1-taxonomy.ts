// Standalone (non-vitest) empirical check of the Phase 1 taxonomy tools
// (create/update/delete_category, create/update/delete_category_group) against a REAL Actual
// server. Unit tests run against a mock and prove our logic; this proves Actual's actual
// behaviour — in particular the read-merge-write trap on partial updates (check 4) and real
// transaction reassignment on delete (check 7), neither of which a mock can demonstrate.
//
// Bootstrap block modelled on scripts/demo/reset-check.ts (temp data dir, try/finally
// shutdown+cleanup, machine-readable RESULT= summary) so this script behaves the same way, with
// the download-an-existing-budget step from scripts/demo/reset-demo.ts (ACTUAL_SYNC_ID +
// api.downloadBudget) since this script verifies against an already-seeded budget rather than
// creating one. Uses scripts/demo/env.ts's loadDemoEnv so a missing env var fails loudly instead
// of silently defaulting.
//
// Drives the tool handlers directly (tool.handler(input, { api, config })), the same shape used
// in tests/tools/*.test.ts, bypassing MCP entirely.
//
// Run standalone, NOT under vitest: NODE_ENV=test makes @actual-app/api take an eager resync
// path that hangs on deletes (see reset-check.ts's header comment) — the reason this is a
// separate tsx script instead of a vitest integration test.
//
//   ACTUAL_SERVER_URL=… ACTUAL_SERVER_PASSWORD=… ACTUAL_SYNC_ID=… npx tsx scripts/verify/phase1-taxonomy.ts
//
// All test data is prefixed "ZZZ Verify" and is deleted again in the cleanup step (run from a
// `finally`, so it also fires — best-effort — if a check throws partway through).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as api from '@actual-app/api';
import { loadDemoEnv } from '../demo/env.js';
import { loadConfig } from '../../src/core/config.js';
import { getTransactionById } from '../../src/core/tx-read.js';
import { tool as createCategoryGroup } from '../../src/tools/create_category_group.js';
import { tool as updateCategoryGroup } from '../../src/tools/update_category_group.js';
import { tool as deleteCategoryGroup } from '../../src/tools/delete_category_group.js';
import { tool as createCategory } from '../../src/tools/create_category.js';
import { tool as updateCategory } from '../../src/tools/update_category.js';
import { tool as deleteCategory } from '../../src/tools/delete_category.js';
import { tool as getCategories } from '../../src/tools/get_categories.js';
import { tool as createTransaction } from '../../src/tools/create_transaction.js';

const NAME_PREFIX = 'ZZZ Verify';
const GROUP_NAME = `${NAME_PREFIX} Group`;
const CAT_NAME = `${NAME_PREFIX} Cat`;
const CAT_RENAMED = `${NAME_PREFIX} Cat Renamed`;
const CAT2_NAME = `${NAME_PREFIX} Cat 2`;

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

/** Runs fn expecting it to reject; fails the check if it does not, or if the message doesn't match. */
async function checkThrows(label: string, fn: () => Promise<unknown>, match: RegExp): Promise<void> {
  try {
    await fn();
    check(label, false, 'expected it to throw, but it did not');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(label, match.test(message), `error message did not match ${match}: ${message}`);
  }
}

/** Runs fn expecting it to resolve; fails the check (with the thrown error as detail) if it rejects. */
async function checkDoesNotThrow<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const result = await fn();
    check(label, true);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(label, false, `threw unexpectedly: ${message}`);
    return undefined;
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Best-effort teardown: deletes the verification transaction (if we know its id) plus any
 *  leftover "ZZZ Verify" category/group, regardless of how far the checks above got. Never
 *  throws -- a cleanup failure must not mask the real check result. */
async function cleanup(txId: string | undefined): Promise<void> {
  if (txId) {
    try {
      await api.deleteTransaction(txId);
      console.log(`CLEANUP deleted verification transaction ${txId}`);
    } catch (err) {
      console.warn(`CLEANUP WARNING could not delete transaction ${txId}: ${(err as Error).message}`);
    }
  }
  try {
    const groups = await api.getCategoryGroups();
    for (const g of groups ?? []) {
      for (const c of g.categories ?? []) {
        if (typeof c.name === 'string' && c.name.startsWith(NAME_PREFIX)) {
          try {
            await api.deleteCategory(c.id);
            console.log(`CLEANUP deleted leftover category "${c.name}" (${c.id})`);
          } catch (err) {
            console.warn(`CLEANUP WARNING could not delete category ${c.id}: ${(err as Error).message}`);
          }
        }
      }
    }
    // Re-fetch: deleting categories above may have emptied groups that are otherwise unrelated;
    // only groups whose own name carries the prefix are ours to remove.
    const groupsAfter = await api.getCategoryGroups();
    for (const g of groupsAfter ?? []) {
      if (typeof g.name === 'string' && g.name.startsWith(NAME_PREFIX)) {
        try {
          await api.deleteCategoryGroup(g.id);
          console.log(`CLEANUP deleted leftover group "${g.name}" (${g.id})`);
        } catch (err) {
          console.warn(`CLEANUP WARNING could not delete group ${g.id}: ${(err as Error).message}`);
        }
      }
    }
  } catch (err) {
    console.warn(`CLEANUP WARNING sweep failed: ${(err as Error).message}`);
  }
}

async function run(): Promise<number> {
  const env = loadDemoEnv(['ACTUAL_SERVER_URL', 'ACTUAL_SERVER_PASSWORD', 'ACTUAL_SYNC_ID']);
  const config = loadConfig(process.env);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-verify-phase1-'));
  let txId: string | undefined;
  let failed = false;

  try {
    await api.init({ dataDir, serverURL: env.ACTUAL_SERVER_URL, password: env.ACTUAL_SERVER_PASSWORD });
    await api.downloadBudget(env.ACTUAL_SYNC_ID);

    const ctx = { api, config };

    try {
      // Preconditions: the budget must already have an account (to attach a test transaction
      // to) and at least one pre-existing category (to use as an out-of-group delete target in
      // check 8). Both are true of the seeded demo budget; fail loudly and early if not.
      const accounts = await api.getAccounts();
      if (!accounts?.length) throw new Error('Budget has no accounts -- cannot attach a verification transaction');
      const accountId = accounts[0].id;

      const preexisting: any = await getCategories.handler({ include_hidden: true }, ctx);
      const externalCategory = preexisting.groups.flatMap((g: any) => g.categories)[0];
      if (!externalCategory) throw new Error('Budget has no pre-existing categories -- cannot pick a delete_category_group destination outside the verify group');
      const externalCategoryId = externalCategory.id;

      // 1. Create group; assert an id comes back.
      const groupResult: any = await createCategoryGroup.handler({ name: GROUP_NAME }, ctx);
      const groupId: string | undefined = groupResult?.group?.id;
      check('1 create_category_group returns an id', typeof groupId === 'string' && groupId.length > 0, groupResult);

      // 2. Create category in it; assert an id comes back.
      const catResult: any = await createCategory.handler({ name: CAT_NAME, group_id: groupId }, ctx);
      const catId: string | undefined = catResult?.category?.id;
      check('2 create_category returns an id', typeof catId === 'string' && catId.length > 0, catResult);

      // 3. Rename it; re-read get_categories; assert the new name is stored.
      await updateCategory.handler({ id: catId, name: CAT_RENAMED }, ctx);
      const afterRename: any = await getCategories.handler({}, ctx);
      const renamedRow = afterRename.groups.flatMap((g: any) => g.categories).find((c: any) => c.id === catId);
      check('3 update_category rename is stored', renamedRow?.name === CAT_RENAMED, renamedRow);

      // 4. THE READ-MERGE-WRITE TRAP. update_category({ hidden: true }) sends only the hidden
      // field's *intent*; if the tool naively forwarded that as the write payload instead of
      // merging it onto the current record first, Actual would throw reading undefined fields
      // (e.g. name.trim()) downstream. Re-read with include_hidden: true to also confirm the
      // category comes back archived, not just that the call survived.
      await checkDoesNotThrow('4a update_category(hidden:true) does not throw (read-merge-write trap)', () =>
        updateCategory.handler({ id: catId, hidden: true }, ctx),
      );
      const afterHide: any = await getCategories.handler({ include_hidden: true }, ctx);
      const hiddenRow = afterHide.groups.flatMap((g: any) => g.categories).find((c: any) => c.id === catId);
      check('4b archived category reads back with hidden:true', hiddenRow?.hidden === true, hiddenRow);

      // 5. Archive the group; assert it did not throw (same read-merge-write trap, on the group).
      await checkDoesNotThrow('5 update_category_group(hidden:true) does not throw', () =>
        updateCategoryGroup.handler({ id: groupId, hidden: true }, ctx),
      );

      // 6. Second category + a transaction against it, then delete_category WITHOUT a target.
      const cat2Result: any = await createCategory.handler({ name: CAT2_NAME, group_id: groupId }, ctx);
      const cat2Id: string | undefined = cat2Result?.category?.id;
      check('6a create_category (second) returns an id', typeof cat2Id === 'string' && cat2Id.length > 0, cat2Result);

      const txResult: any = await createTransaction.handler(
        {
          account_id: accountId,
          date: new Date().toISOString().slice(0, 10),
          amount: -1.23,
          category_id: cat2Id,
          notes: `${NAME_PREFIX} tx`,
        },
        ctx,
      );
      txId = txResult?.transaction?.id;
      check('6b create_transaction returns an id', typeof txId === 'string' && (txId as string).length > 0, txResult);

      await checkThrows(
        '6c delete_category without transfer_category_id throws the needs-target error',
        () => deleteCategory.handler({ id: cat2Id, confirm_delete: true }, ctx),
        /transfer_category_id/,
      );

      // 7. delete_category WITH a target: THE CLAIM THE MOCK CANNOT MAKE. Assert it succeeds and
      // that Actual really reassigned the transaction's category_id, by reading the row back.
      const deleteResult: any = await deleteCategory.handler(
        { id: cat2Id, confirm_delete: true, transfer_category_id: catId },
        ctx,
      );
      check('7a delete_category with transfer_category_id succeeds', deleteResult?.deleted === true, deleteResult);
      check('7b delete_category reports the transaction as reassigned', deleteResult?.transactions_reassigned === 1, deleteResult);
      const rowAfterCategoryDelete = await getTransactionById(api, txId as string);
      check(
        '7c transaction.category_id is now the destination category (real Actual reassignment)',
        rowAfterCategoryDelete?.category === catId,
        rowAfterCategoryDelete,
      );

      // 8. delete_category_group on the verify group, with a destination OUTSIDE it.
      const groupDeleteResult: any = await deleteCategoryGroup.handler(
        { id: groupId, confirm_delete: true, transfer_category_id: externalCategoryId },
        ctx,
      );
      check('8a delete_category_group succeeds', groupDeleteResult?.deleted === true, groupDeleteResult);
      const afterGroupDelete: any = await getCategories.handler({ include_hidden: true }, ctx);
      const groupStillListed = afterGroupDelete.groups.some((g: any) => g.id === groupId);
      check('8b get_categories no longer lists the verify group', !groupStillListed, afterGroupDelete.groups.map((g: any) => g.id));
      const rowAfterGroupDelete = await getTransactionById(api, txId as string);
      check(
        '8c (bonus) transaction.category_id followed the second reassignment to the external category',
        rowAfterGroupDelete?.category === externalCategoryId,
        rowAfterGroupDelete,
      );
    } catch (err) {
      failed = true;
      console.error(err instanceof Error ? err.message : err);
    }

    // 9. Cleanup: always runs, even on failure, so partial test data never lingers in the budget.
    await cleanup(txId);

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
