import { describe, it, expect } from 'vitest';
import { syncAfterWrite } from '../../src/core/write-sync.js';
import { mockApi } from '../helpers/mock-api.js';

describe('syncAfterWrite', () => {
  it('syncs and reports success', async () => {
    const api = mockApi();
    const r = await syncAfterWrite(api);
    expect(api.sync).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ synced: true });
  });

  it('reports the failure instead of throwing — the write already landed locally', async () => {
    const api = mockApi({ sync: async () => { throw new Error('offline'); } });
    const r = await syncAfterWrite(api);
    expect(r.synced).toBe(false);
    expect(r.error).toContain('offline');
  });

  it('survives a non-Error rejection', async () => {
    const api = mockApi({ sync: async () => { throw 'plain string'; } });
    const r = await syncAfterWrite(api);
    expect(r.synced).toBe(false);
    expect(typeof r.error).toBe('string');
  });
});
