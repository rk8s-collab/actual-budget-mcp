import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import { ActualClient } from '../../src/core/actual-client.js';

// El namespace ESM de node:fs no es spy-able (propiedades no reconfigurables):
// se mockea el módulo entero y se conserva el resto de la API real.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, default: actual, mkdirSync: vi.fn() };
});
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
  it('does not double-init on concurrent first calls', async () => {
    const api = mockApi();
    const c = new ActualClient(api, cfg, () => 0);
    await Promise.all([c.ensureReady(), c.ensureReady()]);
    expect(api.init).toHaveBeenCalledTimes(1);
    expect(api.downloadBudget).toHaveBeenCalledTimes(1);
  });
  it('creates the data dir with restrictive permissions', async () => {
    const api = mockApi();
    const mkdir = vi.mocked(fs.mkdirSync);
    mkdir.mockClear();
    const c = new ActualClient(api, cfg, () => 0);
    await c.ensureReady();
    expect(mkdir).toHaveBeenCalledWith(cfg.dataDir, { recursive: true, mode: 0o700 });
  });
  it('retries init after a failed first attempt', async () => {
    const api = mockApi();
    (api.init as any).mockRejectedValueOnce(new Error('offline'));
    const c = new ActualClient(api, cfg, () => 0);
    await expect(c.ensureReady()).rejects.toThrow(/offline/);
    await c.ensureReady(); // debe reintentar, no re-lanzar la promesa cacheada
    expect(api.init).toHaveBeenCalledTimes(2);
    expect(api.downloadBudget).toHaveBeenCalledTimes(1);
  });
});

describe('contención entre instancias', () => {
  const busy = () => new Error('We had an unknown problem opening "My-Finances-6b776d4".');

  it('cae a una copia propia cuando otro proceso tiene el presupuesto abierto', async () => {
    const api = mockApi();
    const mkdir = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
    (api.downloadBudget as any).mockRejectedValueOnce(busy());

    const c = new ActualClient(api, cfg, () => 0);
    await c.ensureReady();

    expect(api.init).toHaveBeenCalledTimes(2);
    const usado = (api.init as any).mock.calls[1][0].dataDir;
    expect(usado).not.toBe(cfg.dataDir);
    expect(usado).toContain(String(process.pid));
    expect(c.dataDir).toBe(usado);
    expect(mkdir).toHaveBeenLastCalledWith(usado, { recursive: true, mode: 0o700 });
    mkdir.mockRestore();
  });

  it('no cae a la copia propia ante errores ajenos a la contención', async () => {
    const api = mockApi();
    const mkdir = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
    (api.downloadBudget as any).mockRejectedValueOnce(new Error('invalid password'));

    const c = new ActualClient(api, cfg, () => 0);
    await expect(c.ensureReady()).rejects.toThrow(/invalid password/);
    expect(api.init).toHaveBeenCalledTimes(1);
    mkdir.mockRestore();
  });

  it('si ambos directorios fallan, el error nombra los dos y cómo resolverlo', async () => {
    const api = mockApi();
    const mkdir = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
    (api.downloadBudget as any).mockRejectedValue(busy());

    const c = new ActualClient(api, cfg, () => 0);
    await expect(c.ensureReady()).rejects.toThrow(/ACTUAL_DATA_DIR/);
    mkdir.mockRestore();
  });
});
