// actual-client.ts — envoltura singleton sobre @actual-app/api.
// Task 6 llama a ensureReady() antes de cada handler de tool. Semántica:
// - Primera llamada: init(...) + downloadBudget(syncId) y una sincronización inicial.
// - Llamadas posteriores: sync() solo si expiró el TTL.
// - Si sync() falla: las lecturas devuelven {stale:true}; las escrituras (forWrite) relanzan.
//   Excepción: si el presupuesto ha quedado CERRADO no hay copia local que servir —
//   se reabre una vez y, si sigue cerrado, se relanza con un mensaje legible.
// Todo log va a stderr (stdout es el canal MCP).
import * as fs from 'node:fs';
import type { Config } from './config.js';
import { msg } from './messages.js';

// El servidor stdio se arranca UNA VEZ POR CLIENTE conectado (Claude Desktop, Claude Code,
// bridges...). Actual no permite que dos procesos abran el mismo presupuesto: el segundo
// recibe "We had an unknown problem opening ...". Cuando eso pasa, caemos a una copia propia
// por instancia en lugar de fallar; ver openBudget().
const BUSY_PATTERN = /problem opening|already open|is open|locked|SQLITE_BUSY|EBUSY/i;

// checkFileOpen() de la API lanza este mensaje cuando no hay presupuesto abierto.
const BUDGET_CLOSED_PATTERN = /No budget file is open/i;

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
          msg(this.config).budgetOpenFailed(this.config.dataDir, first, fallback, (err2 as Error).message),
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
        // Un sync fallido no implica que la copia local siga consultable: loot-core cierra
        // el presupuesto cuando no logra abrir la base. Servir {stale:true} en ese estado
        // hacía que la consulta posterior muriera con "No budget file is open".
        if (!(await this.isBudgetOpen())) {
          console.error('[actual-mcp] el presupuesto está cerrado; reabriendo…');
          if (await this.reopen()) {
            this.lastSyncMs = this.now();
            return { stale: false, lastSynced: new Date(this.lastSyncMs).toISOString() };
          }
          throw new Error(
            msg(this.config).budgetClosed(
              (err as Error).message,
              this.activeDataDir ?? this.config.dataDir,
            ),
          );
        }
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

  // Sonda barata y local: getBudgetMonths() pasa por checkFileOpen() en la API.
  // Cualquier otro fallo (base corrupta, etc.) no es "cerrado" y no debe disparar la reapertura.
  private async isBudgetOpen(): Promise<boolean> {
    try {
      await this.api.getBudgetMonths();
      return true;
    } catch (err) {
      return !BUDGET_CLOSED_PATTERN.test((err as Error).message ?? '');
    }
  }

  // Un único reintento. downloadBudget() reabre el presupuesto local o lo vuelve a bajar;
  // el sync() posterior es la prueba de que quedó realmente abierto (la API lee las prefs
  // antes de sincronizar, así que con el presupuesto cerrado siempre falla).
  private async reopen(): Promise<boolean> {
    try {
      await this.api.downloadBudget(this.config.syncId);
      await this.api.sync();
      return true;
    } catch (err) {
      console.error('[actual-mcp] no se pudo reabrir el presupuesto:', (err as Error).message);
      return false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.initialized) {
      await this.api.shutdown();
      this.initialized = false;
    }
  }
}
