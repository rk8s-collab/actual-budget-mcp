import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as api from '@actual-app/api';
import { loadDemoEnv } from './env.js';
import { buildDemoDataset } from './dataset.js';
import { applyDataset } from './apply.js';
import { wipeBudgetContents } from './wipe.js';

// Runs daily (cron): restores the demo budget to its seed state WITHOUT changing its Sync ID
// (the budget is created once by bootstrap-demo.ts; this only wipes and re-applies its contents).
async function main() {
  const env = loadDemoEnv(['ACTUAL_SERVER_URL', 'ACTUAL_SERVER_PASSWORD', 'ACTUAL_SYNC_ID']);
  // api.init does NOT create its dataDir; make our own throwaway one, and remove it afterwards
  // since this runs frequently and would otherwise leak a directory per invocation.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-demo-reset-'));
  try {
    await api.init({ dataDir, serverURL: env.ACTUAL_SERVER_URL, password: env.ACTUAL_SERVER_PASSWORD });
    await api.downloadBudget(env.ACTUAL_SYNC_ID);
    await wipeBudgetContents(api);
    await applyDataset(api, buildDemoDataset());
    await api.sync();
    await api.shutdown();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
