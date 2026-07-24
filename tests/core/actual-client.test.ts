import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import { ActualClient } from '../../src/core/actual-client.js';
import type { NativeCheckResult } from '../../src/core/native-check.js';

// El namespace ESM de node:fs no es spy-able (propiedades no reconfigurables):
// se mockea el módulo entero y se conserva el resto de la API real.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, default: actual, mkdirSync: vi.fn() };
});
import type { Config } from '../../src/core/config.js';

const cfg: Config = {
  serverUrl: 'https://x', password: 'p', syncId: 's', dataDir: '/tmp/x',
  locale: 'en-US', currency: 'USD', syncTtlSeconds: 60, enableWrite: false, messagesLang: 'es',
};

function mockApi() {
  return {
    init: vi.fn(async () => {}),
    downloadBudget: vi.fn(async () => {}),
    sync: vi.fn(async () => {}),
    // Sonda de "¿sigue abierto el presupuesto?": en la API real pasa por checkFileOpen().
    getBudgetMonths: vi.fn(async () => ['2026-07']),
    shutdown: vi.fn(async () => {}),
  };
}

// El fallo real de la extensión .mcpb: loot-core cierra el presupuesto cuando no consigue
// abrir la base local, sync() revienta al desestructurar unas prefs ya descargadas y
// cualquier consulta posterior lanza "No budget file is open".
const CLOSED_SYNC_ERROR = "Cannot destructure property 'id' of 'getPrefs(...)' as it is null.";
const CLOSED_QUERY_ERROR = 'No budget file is open';

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
  it('no intenta reabrir cuando el sync falla pero el presupuesto sigue abierto', async () => {
    const api = mockApi();
    let now = 0;
    const c = new ActualClient(api, cfg, () => now);
    await c.ensureReady();
    now = 90_000;
    api.sync.mockRejectedValueOnce(new Error('offline'));
    const r = await c.ensureReady();
    expect(r.stale).toBe(true);
    expect(api.downloadBudget).toHaveBeenCalledTimes(1);
  });

  it('reabre el presupuesto y vuelve a sincronizar cuando el sync lo encuentra cerrado', async () => {
    const api = mockApi();
    let now = 0;
    const c = new ActualClient(api, cfg, () => now);
    await c.ensureReady();

    // Entre una llamada y la siguiente, el presupuesto se cierra por debajo.
    let open = false;
    api.sync.mockImplementation(async () => {
      if (!open) throw new Error(CLOSED_SYNC_ERROR);
    });
    api.getBudgetMonths.mockImplementation(async () => {
      if (!open) throw new Error(CLOSED_QUERY_ERROR);
      return ['2026-07'];
    });
    api.downloadBudget.mockImplementation(async () => {
      open = true;
    });

    now = 90_000;
    const r = await c.ensureReady();
    expect(r.stale).toBe(false);
    expect(r.lastSynced).toBe(new Date(90_000).toISOString());
    expect(api.downloadBudget).toHaveBeenCalledTimes(2);
  });

  it('lanza un error legible cuando el presupuesto sigue cerrado tras reabrirlo', async () => {
    const api = mockApi();
    let now = 0;
    const c = new ActualClient(api, cfg, () => now);
    await c.ensureReady();

    // downloadBudget resuelve sin error pero deja el presupuesto cerrado: es lo que hace
    // la API real cuando load-budget falla (ignora su resultado).
    api.sync.mockRejectedValue(new Error(CLOSED_SYNC_ERROR));
    api.getBudgetMonths.mockRejectedValue(new Error(CLOSED_QUERY_ERROR));

    now = 90_000;
    await expect(c.ensureReady()).rejects.toThrow(/presupuesto.*cerr/i);
    expect(api.downloadBudget).toHaveBeenCalledTimes(2); // un único reintento
  });

  it('falla legiblemente si el presupuesto nunca llegó a abrirse en el arranque', async () => {
    // Reproduce la extensión .mcpb: downloadBudget() resuelve aunque load-budget haya
    // fallado por debajo (la API ignora su resultado), así que la primera tool ya
    // encontraba el presupuesto cerrado.
    const api = mockApi();
    api.sync.mockRejectedValue(new Error(CLOSED_SYNC_ERROR));
    api.getBudgetMonths.mockRejectedValue(new Error(CLOSED_QUERY_ERROR));
    const c = new ActualClient(api, cfg, () => 0);
    await expect(c.ensureReady()).rejects.toThrow(/presupuesto.*cerr/i);
  });

  it('no sirve datos obsoletos con el presupuesto cerrado', async () => {
    const api = mockApi();
    let now = 0;
    const c = new ActualClient(api, cfg, () => now);
    await c.ensureReady();
    api.sync.mockRejectedValue(new Error(CLOSED_SYNC_ERROR));
    api.getBudgetMonths.mockRejectedValue(new Error(CLOSED_QUERY_ERROR));

    now = 90_000;
    // Ni en lectura ni en escritura: devolver {stale:true} aquí es lo que producía
    // el incomprensible "get_accounts: No budget file is open".
    await expect(c.ensureReady()).rejects.toThrow();
    await expect(c.ensureReady({ forWrite: true })).rejects.toThrow(/presupuesto.*cerr/i);
  });

  it('conserva la causa original en el mensaje de error', async () => {
    const api = mockApi();
    let now = 0;
    const c = new ActualClient(api, cfg, () => now);
    await c.ensureReady();
    api.sync.mockRejectedValue(new Error(CLOSED_SYNC_ERROR));
    api.getBudgetMonths.mockRejectedValue(new Error(CLOSED_QUERY_ERROR));

    now = 90_000;
    await expect(c.ensureReady()).rejects.toThrow(/getPrefs/);
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

// Comprobación de compatibilidad del módulo nativo (better-sqlite3 bajo el Electron de
// Claude Desktop): ver src/core/native-check.ts. Se inyecta por constructor precisamente
// para que estos tests (y todos los de arriba, que no la pasan) no disparen un dlopen
// real — su valor por defecto es inerte ({ ok: true }) y solo src/index.ts lo sustituye
// por la comprobación real en producción.
describe('ActualClient — comprobación de ABI del módulo nativo', () => {
  it('no afecta a ensureReady cuando la comprobación no se inyecta (valor por defecto inerte)', async () => {
    const api = mockApi();
    const c = new ActualClient(api, cfg, () => 0);
    await expect(c.ensureReady()).resolves.toBeDefined();
  });

  it('lanza el error del catálogo con los dos NODE_MODULE_VERSION antes de tocar la API', async () => {
    const api = mockApi();
    const checkNative = vi.fn(
      (): NativeCheckResult => ({ ok: false, compiladoPara: 146, runtime: 147 }),
    );
    const c = new ActualClient(api, cfg, () => 0, checkNative);
    await expect(c.ensureReady()).rejects.toThrow(/146/);
    await expect(c.ensureReady()).rejects.toThrow(/147/);
    expect(api.init).not.toHaveBeenCalled();
    expect(api.downloadBudget).not.toHaveBeenCalled();
  });

  it('ejecuta la comprobación una sola vez aunque ensureReady se llame varias veces', async () => {
    const api = mockApi();
    const checkNative = vi.fn((): NativeCheckResult => ({ ok: true }));
    const c = new ActualClient(api, cfg, () => 0, checkNative);
    await c.ensureReady();
    await c.ensureReady();
    await c.ensureReady();
    expect(checkNative).toHaveBeenCalledTimes(1);
  });

  it('sigue lanzando en llamadas posteriores usando el resultado cacheado (sin repetir la comprobación)', async () => {
    const api = mockApi();
    const checkNative = vi.fn(
      (): NativeCheckResult => ({ ok: false, compiladoPara: 146, runtime: 147 }),
    );
    const c = new ActualClient(api, cfg, () => 0, checkNative);
    await expect(c.ensureReady()).rejects.toThrow(/146/);
    await expect(c.ensureReady()).rejects.toThrow(/146/);
    expect(checkNative).toHaveBeenCalledTimes(1);
  });

  it('registra una línea en stderr, una sola vez, cuando detecta el desajuste', async () => {
    const api = mockApi();
    const checkNative = vi.fn(
      (): NativeCheckResult => ({ ok: false, compiladoPara: 146, runtime: 147 }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = new ActualClient(api, cfg, () => 0, checkNative);
    await expect(c.ensureReady()).rejects.toThrow();
    await expect(c.ensureReady()).rejects.toThrow();
    const lineasNativas = errorSpy.mock.calls.filter((call) =>
      String(call[0]).includes('146'),
    );
    expect(lineasNativas.length).toBe(1);
    errorSpy.mockRestore();
  });
});
