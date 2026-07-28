import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as api from '@actual-app/api';
import { ensureServerReady } from '../../test/integration/setup.js';
import { buildDemoDataset } from './dataset.js';
import { applyDataset } from './apply.js';

// Requires the ephemeral server (Phase 0 compose) running on :5006.
describe('applyDataset', () => {
  beforeAll(async () => {
    await ensureServerReady();
    await api.init({ dataDir: '/tmp/demo-apply', serverURL: 'http://localhost:5006', password: 'test-pass' });
    await api.runImport('ApplyTest', async () => {});
  });
  afterAll(async () => {
    await api.shutdown();
  });

  it('creates accounts, categories and a rule from the dataset', async () => {
    await applyDataset(api, buildDemoDataset());
    expect((await api.getAccounts()).length).toBeGreaterThanOrEqual(3);
    expect((await api.getCategories()).length).toBeGreaterThan(0);
    expect((await api.getRules()).length).toBeGreaterThan(0);
  });
});
