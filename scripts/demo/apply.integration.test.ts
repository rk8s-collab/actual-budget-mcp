import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as api from '@actual-app/api';
import { ensureServerReady } from '../../test/integration/setup.js';
import { buildDemoDataset } from './dataset.js';
import { applyDataset } from './apply.js';

// Requires the ephemeral server (Phase 0 compose) running on :5006.
describe('applyDataset', () => {
  let dataDir: string;

  beforeAll(async () => {
    await ensureServerReady();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-apply-test-'));
    await api.init({ dataDir, serverURL: 'http://localhost:5006', password: 'test-pass' });
    await api.runImport('ApplyTest', async () => {});
  });
  afterAll(async () => {
    await api.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates accounts, categories and a rule from the dataset', async () => {
    await applyDataset(api, buildDemoDataset());
    expect((await api.getAccounts()).length).toBeGreaterThanOrEqual(3);
    expect((await api.getCategories()).length).toBeGreaterThan(0);
    expect((await api.getRules()).length).toBeGreaterThan(0);
  });
});
