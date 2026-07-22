import { describe, it, expect, vi } from 'vitest';
import { ActualClient } from '../../src/core/actual-client.js';
import type { Config } from '../../src/core/config.js';

const cfg: Config = {
  serverUrl: 'https://x', password: 'p', syncId: 's', dataDir: '/tmp/x',
  locale: 'en-US', currency: 'USD', syncTtlSeconds: 60, enableWrite: false,
};

function mockApi() {
  return {
    init: vi.fn(async () => {}),
    downloadBudget: vi.fn(async () => {}),
    sync: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
  };
}

describe('ActualClient.ensureReady', () => {
  it('initializes and downloads budget on first call only', async () => {
    const api = mockApi();
    const c = new ActualClient(api, cfg, () => 1000);
    await c.ensureReady();
    await c.ensureReady();
    expect(api.init).toHaveBeenCalledTimes(1);
    expect(api.downloadBudget).toHaveBeenCalledWith('s');
  });
  it('skips sync within TTL, syncs after TTL', async () => {
    const api = mockApi();
    let now = 0;
    const c = new ActualClient(api, cfg, () => now);
    await c.ensureReady();            // t=0 -> initial sync counts
    now = 30_000;
    await c.ensureReady();            // within 60s TTL
    expect(api.sync).toHaveBeenCalledTimes(1);
    now = 90_000;
    await c.ensureReady();            // TTL expired
    expect(api.sync).toHaveBeenCalledTimes(2);
  });
  it('returns stale=true for reads when sync fails', async () => {
    const api = mockApi();
    let now = 0;
    const c = new ActualClient(api, cfg, () => now);
    await c.ensureReady();
    now = 90_000;
    api.sync.mockRejectedValueOnce(new Error('offline'));
    const r = await c.ensureReady();
    expect(r.stale).toBe(true);
    expect(r.lastSynced).not.toBeNull();
  });
  it('throws for writes when sync fails', async () => {
    const api = mockApi();
    let now = 0;
    const c = new ActualClient(api, cfg, () => now);
    await c.ensureReady();
    now = 90_000;
    api.sync.mockRejectedValueOnce(new Error('offline'));
    await expect(c.ensureReady({ forWrite: true })).rejects.toThrow(/offline/);
  });
});
