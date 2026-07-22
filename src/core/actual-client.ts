// actual-client.ts — envoltura singleton sobre @actual-app/api.
// Task 6 llama a ensureReady() antes de cada handler de tool. Semántica:
// - Primera llamada: init(...) + downloadBudget(syncId) y una sincronización inicial.
// - Llamadas posteriores: sync() solo si expiró el TTL.
// - Si sync() falla: las lecturas devuelven {stale:true}; las escrituras (forWrite) relanzan.
// Todo log va a stderr (stdout es el canal MCP).
import * as fs from 'node:fs';
import type { Config } from './config.js';

export class ActualClient {
  private initialized = false;
  private lastSyncMs: number | null = null;

  constructor(
    private api: any,
    private config: Config,
    private now: () => number = () => Date.now(),
  ) {}

  async ensureReady(
    opts: { forWrite?: boolean } = {},
  ): Promise<{ stale: boolean; lastSynced: string | null }> {
    if (!this.initialized) {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
      await this.api.init({
        dataDir: this.config.dataDir,
        serverURL: this.config.serverUrl,
        password: this.config.password,
      });
      await this.api.downloadBudget(this.config.syncId);
      this.initialized = true;
      // lastSyncMs sigue null: el bloque de TTL de abajo hará la sincronización inicial.
    }

    const ttlMs = this.config.syncTtlSeconds * 1000;
    const due = this.lastSyncMs === null || this.now() - this.lastSyncMs >= ttlMs;
    if (due) {
      try {
        await this.api.sync();
        this.lastSyncMs = this.now();
      } catch (err) {
        if (opts.forWrite) throw err;
        console.error('[actual-mcp] sync falló; sirviendo copia local:', (err as Error).message);
        return {
          stale: true,
          lastSynced: this.lastSyncMs !== null ? new Date(this.lastSyncMs).toISOString() : null,
        };
      }
    }
    return {
      stale: false,
      lastSynced: this.lastSyncMs !== null ? new Date(this.lastSyncMs).toISOString() : null,
    };
  }

  async shutdown(): Promise<void> {
    if (this.initialized) {
      await this.api.shutdown();
      this.initialized = false;
    }
  }
}
