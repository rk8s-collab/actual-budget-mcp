// Standalone (non-vitest) runner for the reset flow. @actual-app/api's delete-heavy calls
// (api.deleteRule() in particular) deadlock when driven in-process under vitest — the identical
// flow completes in ~1s in a plain node/tsx process. This script exists so the integration test
// can exercise the real reset flow from a clean subprocess instead of hanging vitest's worker.
//
// Reads ACTUAL_SERVER_URL/ACTUAL_SERVER_PASSWORD (defaulting to the ephemeral test server),
// seeds a fresh budget, wipes it, re-seeds it, and prints a machine-readable RESULT= line for
// the caller to parse. Exit code 0 = all invariants held, 1 = a check failed.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as api from '@actual-app/api';
import { applyDataset } from './apply.js';
import { wipeBudgetContents } from './wipe.js';
import { buildDemoDataset } from './dataset.js';

async function run(): Promise<number> {
  const url = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
  const password = process.env.ACTUAL_SERVER_PASSWORD ?? 'test-pass';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-reset-check-'));
  try {
    await api.init({ dataDir, serverURL: url, password });
    await api.runImport('ResetCheck', async () => {});
    await applyDataset(api, buildDemoDataset()); // first seed
    const budgets1 = await api.getBudgets();
    const b1 = budgets1.find((x: any) => x.groupId) ?? budgets1[0];
    if (!b1?.groupId) throw new Error('Could not determine Sync ID (groupId)');
    const syncId1 = b1.groupId;
    const accounts1 = (await api.getAccounts()).length;
    await wipeBudgetContents(api);
    await applyDataset(api, buildDemoDataset()); // reset
    await api.sync();
    const budgets2 = await api.getBudgets();
    const b2 = budgets2.find((x: any) => x.groupId) ?? budgets2[0];
    if (!b2?.groupId) throw new Error('Could not determine Sync ID (groupId)');
    const syncId2 = b2.groupId;
    const accounts2 = (await api.getAccounts()).length;
    const categories = (await api.getCategories()).length;
    const rules = (await api.getRules()).length;
    const result = {
      syncStable: syncId1 === syncId2,
      accountsStable: accounts1 === accounts2,
      accounts: accounts2,
      categories,
      rules,
    };
    console.log('RESULT=' + JSON.stringify(result));
    return result.syncStable && result.accountsStable && categories > 0 && rules > 0 ? 0 : 1;
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
