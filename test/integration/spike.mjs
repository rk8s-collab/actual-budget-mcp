// Throwaway probe script for Task 0.1 (Phase 0 demo-instance spike).
// NOT part of the test suite — run manually with `node test/integration/spike.mjs`
// against the ephemeral server started via docker-compose.actual.yml.
//
// Usage:
//   node test/integration/spike.mjs create   # Step 4+5: create budget, print getBudgets(), wipe content, re-check Sync ID
//   node test/integration/spike.mjs download <syncId>   # Step 4: confirm which field downloadBudget() accepts

import * as api from '@actual-app/api';
import fs from 'node:fs';

const SERVER_URL = 'http://localhost:5006';
const PASSWORD = 'spike-pass';

const mode = process.argv[2] ?? 'create';

if (mode === 'create') {
  const dataDir = '/tmp/spike-create';
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });

  await api.init({ dataDir, serverURL: SERVER_URL, password: PASSWORD });

  await api.runImport('Demo', async () => {
    await api.createCategoryGroup({ name: 'X', is_income: false });
  });

  console.log('=== getBudgets() after runImport ===');
  const budgets = await api.getBudgets();
  console.log(JSON.stringify(budgets, null, 2));

  const entry = budgets.find((b) => b.name === 'Demo');
  if (!entry) {
    console.error('BLOCKED: no "Demo" budget found in getBudgets() after runImport.');
    await api.shutdown();
    process.exit(1);
  }

  // Step 5: wipe content, sync, re-check the Sync ID is unchanged.
  console.log('=== wiping categories/payees/transactions ===');
  const groups = await api.getCategoryGroups();
  for (const g of groups) {
    for (const c of g.categories ?? []) {
      await api.deleteCategory(c.id);
    }
  }
  const payees = await api.getPayees();
  for (const p of payees) {
    if (!p.transfer_acct) {
      await api.deletePayee(p.id);
    }
  }
  await api.sync();

  console.log('=== getBudgets() after wipe + sync ===');
  const budgetsAfter = await api.getBudgets();
  console.log(JSON.stringify(budgetsAfter, null, 2));

  const entryAfter = budgetsAfter.find((b) => b.name === 'Demo');
  console.log('=== comparison ===');
  console.log('cloudFileId before:', entry.cloudFileId, 'after:', entryAfter?.cloudFileId, 'stable:', entry.cloudFileId === entryAfter?.cloudFileId);
  console.log('groupId    before:', entry.groupId, 'after:', entryAfter?.groupId, 'stable:', entry.groupId === entryAfter?.groupId);

  await api.shutdown();
} else if (mode === 'download') {
  const syncId = process.argv[3];
  if (!syncId) {
    console.error('Usage: node test/integration/spike.mjs download <syncId>');
    process.exit(1);
  }
  const dataDir = '/tmp/spike-download';
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });

  await api.init({ dataDir, serverURL: SERVER_URL, password: PASSWORD });
  console.log(`=== downloadBudget(${JSON.stringify(syncId)}) ===`);
  try {
    await api.downloadBudget(syncId);
    console.log('SUCCESS: downloadBudget resolved without throwing.');
    const groups = await api.getCategoryGroups();
    console.log('Category groups after download:', JSON.stringify(groups, null, 2));
  } catch (err) {
    console.error('FAILED:', err.message);
  } finally {
    await api.shutdown();
  }
}
