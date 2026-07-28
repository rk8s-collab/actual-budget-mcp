import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as api from '@actual-app/api';
import { loadDemoEnv } from './env.js';
import { buildDemoDataset } from './dataset.js';
import { applyDataset } from './apply.js';

async function main() {
  const env = loadDemoEnv(['ACTUAL_SERVER_URL', 'ACTUAL_SERVER_PASSWORD']);
  // api.init does NOT create its dataDir; make our own throwaway one.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-demo-bootstrap-'));
  await api.init({ dataDir, serverURL: env.ACTUAL_SERVER_URL, password: env.ACTUAL_SERVER_PASSWORD });
  // Empty runImport callback: start-import/finish-import create and *upload* the budget to the
  // server (registering its groupId). applyDataset's own api.sync() call must run after that
  // upload — calling it from inside the runImport callback fails with "PostError: invalid
  // fileId" because start-import creates the local budget with avoidUpload:true and the server
  // only learns about it in finish-import's upload(). This matches the tested sequence in
  // scripts/demo/apply.integration.test.ts.
  await api.runImport('Actual MCP Demo', async () => {});
  await applyDataset(api, buildDemoDataset());
  const budgets = await api.getBudgets();
  const syncId = (budgets.find((b: any) => b.groupId) ?? budgets[0])?.groupId;
  await api.shutdown();
  if (!syncId) throw new Error('Could not determine Sync ID (groupId) from getBudgets()');
  // The one value the maintainer must record for the reviewer credentials:
  console.log('SYNC_ID=' + syncId);
}

main().catch((err) => { console.error(err); process.exit(1); });
