// actual-client.ts — envoltura singleton sobre @actual-app/api.
// Task 6 llama a ensureReady() antes de cada handler de tool. Semántica:
// - Primera llamada: init(...) + downloadBudget(syncId) y una sincronización inicial.
// - Llamadas posteriores: sync() solo si expiró el TTL.
// - Si sync() falla: las lecturas devuelven {stale:true}; las escrituras (forWrite) relanzan.
// Todo log va a stderr (stdout es el canal MCP).
import * as fs from 'node:fs';
import type { Config } from './config.js';

// El servidor stdio se arranca UNA VEZ POR CLIENTE conectado (Claude Desktop, Claude Code,
// bridges...). Actual no permite que dos procesos abran el mismo presupuesto: el segundo
// recibe "We had an unknown problem opening ...". Cuando eso pasa, caemos a una copia propia
// por instancia en lugar de fallar; ver openBudget().
const BUSY_PATTERN = /problem opening|already open|is open|locked|SQLITE_BUSY|EBUSY/i;

export class ActualClient {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private lastSyncMs: number | null = null;
  private activeDataDir: string | null = null;

  constructor(
    private api: any,
    private config: Config,
    private now: () => number = () => Date.now(),
  ) {}

  /** Directorio de datos realmente en uso: puede no ser el configurado si hubo contención. */
  get dataDir(): string | null {
    return this.activeDataDir;
  }

  /** Directorio propio de esta instancia, hermano del configurado. */
  private instanceDataDir(): string {
    return `${this.config.dataDir}-instance-${process.pid}`;
  }

  private async openBudgetIn(dataDir: string): Promise<void> {
    // 0700: la copia local del presupuesto no está cifrada; solo el propietario debe leerla.
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    await this.api.init({
      dataDir,
      serverURL: this.config.serverUrl,
      password: this.config.password,
    });
    await this.api.downloadBudget(this.config.syncId);
    this.activeDataDir = dataDir;
  }

  /** Abre el presupuesto, cayendo a una copia propia si otro proceso lo tiene tomado. */
  private async openBudget(): Promise<void> {
    try {
      await this.openBudgetIn(this.config.dataDir);
    } catch (err) {
      const first = (err as Error).message ?? String(err);
      if (!BUSY_PATTERN.test(first)) throw err;

      const fallback = this.instanceDataDir();
      console.error(
        `[actual-mcp] Otro proceso tiene abierto el presupuesto en ${this.config.dataDir} (${first}). Usando copia propia en ${fallback}`,
      );
      // La API pudo quedar a medio inicializar con el directorio anterior.
      await Promise.resolve(this.api.shutdown?.()).catch(() => {});
      try {
        await this.openBudgetIn(fallback);
      } catch (err2) {
        throw new Error(
          `No se pudo abrir el presupuesto ni en ${this.config.dataDir} (${first}) ni en la copia propia ${fallback} (${(err2 as Error).message}). ` +
            'Si tienes varios clientes MCP conectados a la vez, cierra los que no uses o da a cada uno su propio ACTUAL_DATA_DIR.',
        );
      }
    }
    console.error(`[actual-mcp] Presupuesto abierto en ${this.activeDataDir}`);
  }

  async ensureReady(
    opts: { forWrite?: boolean } = {},
  ): Promise<{ stale: boolean; lastSynced: string | null }> {
    if (!this.initialized) {
      if (!this.initPromise) {
        this.initPromise = (async () => {
          try {
            await this.openBudget();
            this.initialized = true;
          } catch (err) {
            this.initPromise = null; // init fallido: permitir reintento en la siguiente llamada
            throw err;
          }
        })();
      }
      await this.initPromise;
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
