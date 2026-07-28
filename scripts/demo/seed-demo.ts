import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as api from '@actual-app/api';
import { loadDemoEnv } from './env.js';
import { buildDemoDataset } from './dataset.js';
import { applyDataset } from './apply.js';

// Applies the demo dataset to an already-bootstrapped budget without wiping first. applyDataset
// only reuses groups/categories/accounts by name — payees, transactions, and rules are created
// UNCONDITIONALLY on every call. This script therefore assumes an EMPTY, freshly-bootstrapped
// budget that has NOT been seeded yet; it is NOT safe to re-run against a budget that already
// has the seed data (it will duplicate payees/transactions/rules). To restore a budget that has
// already been seeded, use reset-demo.ts instead, which wipes before re-applying. Note that
// bootstrap-demo.ts already seeds the budget it creates, so seed-demo and bootstrap-demo should
// not be chained.
async function main() {
  const env = loadDemoEnv(['ACTUAL_SERVER_URL', 'ACTUAL_SERVER_PASSWORD', 'ACTUAL_SYNC_ID']);
  // api.init does NOT create its dataDir; make our own throwaway one, and remove it afterwards
  // since this runs frequently and would otherwise leak a directory per invocation.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-demo-seed-'));
  try {
    await api.init({ dataDir, serverURL: env.ACTUAL_SERVER_URL, password: env.ACTUAL_SERVER_PASSWORD });
    await api.downloadBudget(env.ACTUAL_SYNC_ID);
    await applyDataset(api, buildDemoDataset());
    await api.sync();
    await api.shutdown();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
