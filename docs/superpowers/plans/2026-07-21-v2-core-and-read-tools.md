# Actual-MCP v2 — Plan 1: Core TypeScript + Read Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 JavaScript server with a TypeScript core and the 8 read tools defined in `docs/superpowers/specs/2026-07-21-actual-mcp-v2-design.md`.

**Architecture:** `src/core/` (config, actual-client with sync TTL, money, tool registry, server) + `src/tools/` (one file per tool). Tools are pure handlers receiving an injected context `{api, config}` so unit tests never touch a real Actual server. A wrapper converts handler results into MCP text + structuredContent.

**Tech Stack:** TypeScript 6.x, Zod 4.x, `@modelcontextprotocol/sdk` 1.29.x, `@actual-app/api` 26.7+, Vitest.

## Global Constraints

- Node >= 22. ESM only (`"type": "module"`).
- All logging to **stderr** (`console.error`); stdout is the MCP channel.
- Amounts: Actual API uses integer cents; every tool output exposes `amount` (units, number) + `amount_formatted` (Intl string with `LOCALE`/`CURRENCY`). Conversion only via `money.ts`.
- Spending summaries and averages always exclude transfers (`transfer_id != null`); `get_transactions` excludes them unless `include_transfers: true`.
- Net worth includes off-budget accounts.
- Tool names use snake_case matching `^[a-zA-Z0-9_-]{1,64}$`.
- Read tools declare `annotations: { readOnlyHint: true }`.
- Env vars (validated in `config.ts`): `ACTUAL_SERVER_URL`, `ACTUAL_SERVER_PASSWORD`, `ACTUAL_SYNC_ID` required; `ACTUAL_DATA_DIR` (default `./data`), `LOCALE` (`en-US`), `CURRENCY` (`USD`), `SYNC_TTL_SECONDS` (`60`), `ENABLE_WRITE` (`false`).
- Commits in Spanish, imperative, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: TypeScript + Vitest scaffolding

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`, `vitest.config.ts`, `src/core/.gitkeep`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: npm scripts `build`, `test`, `dev`; TS toolchain all later tasks compile against.

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/USUARIO/GITs/Actual-MCP
npm install @actual-app/api@latest @modelcontextprotocol/sdk@latest zod@latest
npm install -D typescript@latest vitest@latest @types/node@latest tsx@latest
```

- [ ] **Step 2: Replace package.json fields** (keep dependencies added above)

```json
{
  "name": "actual-budget-mcp",
  "version": "2.0.0-dev",
  "description": "MCP server for Actual Budget — read/write financial assistant for LLMs",
  "type": "module",
  "main": "dist/index.js",
  "bin": { "actual-budget-mcp": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": false,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
```

- [ ] **Step 5: Write toolchain smoke test** — `tests/smoke.test.ts`

```ts
import { describe, it, expect } from 'vitest';
describe('toolchain', () => {
  it('runs TypeScript tests', () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 6: Run** `npm test` — Expected: 1 passed. Run `npm run build` — Expected: exits 0 (no src/*.ts yet is fine once index.ts exists; if tsc errors on empty include, create `src/index.ts` with `export {};` placeholder to be replaced in Task 6).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts tests/ src/
git commit -m "Migrar toolchain a TypeScript + Vitest (base v2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: money.ts — cents/units conversion and formatting

**Files:**
- Create: `src/core/money.ts`
- Test: `tests/core/money.test.ts`

**Interfaces:**
- Produces: `toUnits(cents: number): number`, `toCents(units: number): number`, `formatAmount(cents: number, locale: string, currency: string): string`, `moneyFields(cents: number, locale: string, currency: string): { amount: number; amount_formatted: string }`.

- [ ] **Step 1: Write failing tests** — `tests/core/money.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { toUnits, toCents, formatAmount, moneyFields } from '../../src/core/money.js';

describe('money', () => {
  it('converts cents to units with 2 decimals', () => {
    expect(toUnits(162498)).toBe(1624.98);
    expect(toUnits(-2305)).toBe(-23.05);
    expect(toUnits(0)).toBe(0);
  });
  it('converts units to integer cents without float drift', () => {
    expect(toCents(60.5)).toBe(6050);
    expect(toCents(0.1 + 0.2)).toBe(30); // classic float trap
    expect(toCents(-19.99)).toBe(-1999);
  });
  it('round-trips', () => {
    expect(toCents(toUnits(33333))).toBe(33333);
  });
  it('formats with es-ES / EUR', () => {
    expect(formatAmount(162498, 'es-ES', 'EUR')).toBe('1.624,98 €');
  });
  it('formats with en-US / USD', () => {
    expect(formatAmount(-2305, 'en-US', 'USD')).toBe('-$23.05');
  });
  it('moneyFields returns both fields', () => {
    expect(moneyFields(12000, 'en-US', 'USD')).toEqual({ amount: 120, amount_formatted: '$120.00' });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/money.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/core/money.ts`

```ts
// money.ts — única frontera de conversión céntimos<->unidades. Nada fuera de
// este módulo convierte importes.
export function toUnits(cents: number): number {
  return Math.round(cents) / 100;
}

export function toCents(units: number): number {
  return Math.round(units * 100);
}

export function formatAmount(cents: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(toUnits(cents));
}

export function moneyFields(cents: number, locale: string, currency: string) {
  return { amount: toUnits(cents), amount_formatted: formatAmount(cents, locale, currency) };
}
```

- [ ] **Step 4: Run** `npx vitest run tests/core/money.test.ts` — Expected: PASS (6 tests). If the es-ES assertion fails on the space character, adjust the expected string to what Node's ICU emits (narrow no-break space ` ` on some versions) — verify manually with `node -e "console.log(new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(1624.98))"` and pin the test to the real output.

- [ ] **Step 5: Commit**

```bash
git add src/core/money.ts tests/core/money.test.ts
git commit -m "Añadir money.ts: conversión céntimos/unidades y formato Intl (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: config.ts — Zod-validated environment

**Files:**
- Create: `src/core/config.ts`
- Test: `tests/core/config.test.ts`

**Interfaces:**
- Produces: `interface Config { serverUrl: string; password: string; syncId: string; dataDir: string; locale: string; currency: string; syncTtlSeconds: number; enableWrite: boolean }` and `loadConfig(env?: Record<string, string | undefined>): Config` (throws `Error` listing every missing/invalid var).

- [ ] **Step 1: Write failing tests** — `tests/core/config.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/core/config.js';

const base = {
  ACTUAL_SERVER_URL: 'https://actual.example.com',
  ACTUAL_SERVER_PASSWORD: 'secret',
  ACTUAL_SYNC_ID: 'abc-123',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      serverUrl: 'https://actual.example.com',
      dataDir: './data',
      locale: 'en-US',
      currency: 'USD',
      syncTtlSeconds: 60,
      enableWrite: false,
    });
  });
  it('reads overrides', () => {
    const c = loadConfig({ ...base, LOCALE: 'es-ES', CURRENCY: 'EUR', SYNC_TTL_SECONDS: '30', ENABLE_WRITE: 'true' });
    expect(c.locale).toBe('es-ES');
    expect(c.currency).toBe('EUR');
    expect(c.syncTtlSeconds).toBe(30);
    expect(c.enableWrite).toBe(true);
  });
  it('names every missing required var in the error', () => {
    expect(() => loadConfig({})).toThrowError(/ACTUAL_SERVER_URL.*ACTUAL_SERVER_PASSWORD.*ACTUAL_SYNC_ID/s);
  });
  it('rejects non-numeric SYNC_TTL_SECONDS', () => {
    expect(() => loadConfig({ ...base, SYNC_TTL_SECONDS: 'soon' })).toThrowError(/SYNC_TTL_SECONDS/);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/config.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/core/config.ts`

```ts
import { z } from 'zod';

const envSchema = z.object({
  ACTUAL_SERVER_URL: z.url({ message: 'ACTUAL_SERVER_URL debe ser una URL válida' }),
  ACTUAL_SERVER_PASSWORD: z.string().min(1, 'ACTUAL_SERVER_PASSWORD es obligatoria'),
  ACTUAL_SYNC_ID: z.string().min(1, 'ACTUAL_SYNC_ID es obligatorio'),
  ACTUAL_DATA_DIR: z.string().default('./data'),
  LOCALE: z.string().default('en-US'),
  CURRENCY: z.string().length(3).default('USD'),
  SYNC_TTL_SECONDS: z.coerce.number().int().nonnegative().default(60),
  ENABLE_WRITE: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
});

export interface Config {
  serverUrl: string;
  password: string;
  syncId: string;
  dataDir: string;
  locale: string;
  currency: string;
  syncTtlSeconds: number;
  enableWrite: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${details}`);
  }
  const e = parsed.data;
  return {
    serverUrl: e.ACTUAL_SERVER_URL,
    password: e.ACTUAL_SERVER_PASSWORD,
    syncId: e.ACTUAL_SYNC_ID,
    dataDir: e.ACTUAL_DATA_DIR,
    locale: e.LOCALE,
    currency: e.CURRENCY,
    syncTtlSeconds: e.SYNC_TTL_SECONDS,
    enableWrite: e.ENABLE_WRITE,
  };
}
```

- [ ] **Step 4: Run** `npx vitest run tests/core/config.test.ts` — Expected: PASS (4 tests). Note: Zod reports all issues at once, so the "names every missing var" regex passes; if issue ordering differs, loosen the regex to three separate `toThrowError` checks.

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/core/config.test.ts
git commit -m "Añadir config.ts: entorno validado con Zod y defaults (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Tool types + registry with ENABLE_WRITE gating

**Files:**
- Create: `src/core/types.ts`, `src/core/tool-registry.ts`
- Test: `tests/core/tool-registry.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts
import type { ZodRawShape } from 'zod';
import type { Config } from './config.js';

export interface ToolContext {
  api: any;            // @actual-app/api module (injected; mocked in tests)
  config: Config;
}

export interface ToolDef {
  name: string;
  description: string;
  readOnly: boolean;                 // false => only registered when enableWrite
  inputSchema: ZodRawShape;          // Zod raw shape consumed by SDK registerTool
  outputSchema?: ZodRawShape;        // optional; enables SDK-side structuredContent validation
  handler: (input: any, ctx: ToolContext) => Promise<unknown>;
}
```

- `collectTools(all: ToolDef[], enableWrite: boolean): ToolDef[]` — filters write tools out unless enabled.
- Every tool file in `src/tools/` exports `export const tool: ToolDef`. `src/tools/index.ts` re-exports `allTools: ToolDef[]` (created in Task 7, grown in each tool task).

- [ ] **Step 1: Write failing tests** — `tests/core/tool-registry.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { collectTools } from '../../src/core/tool-registry.js';
import type { ToolDef } from '../../src/core/types.js';

const mk = (name: string, readOnly: boolean): ToolDef => ({
  name, description: name, readOnly, inputSchema: {}, handler: async () => ({}),
});

describe('collectTools', () => {
  const tools = [mk('get_a', true), mk('set_b', false), mk('get_c', true)];
  it('filters out write tools when enableWrite=false', () => {
    expect(collectTools(tools, false).map((t) => t.name)).toEqual(['get_a', 'get_c']);
  });
  it('keeps all tools when enableWrite=true', () => {
    expect(collectTools(tools, true)).toHaveLength(3);
  });
  it('rejects invalid tool names', () => {
    expect(() => collectTools([mk('bad.name', true)], true)).toThrowError(/bad\.name/);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/tool-registry.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/core/types.ts` exactly as in Interfaces above, and `src/core/tool-registry.ts`:

```ts
import type { ToolDef } from './types.js';

const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function collectTools(all: ToolDef[], enableWrite: boolean): ToolDef[] {
  for (const t of all) {
    if (!NAME_RE.test(t.name)) throw new Error(`Nombre de tool inválido: ${t.name}`);
  }
  return all.filter((t) => t.readOnly || enableWrite);
}
```

- [ ] **Step 4: Run** `npx vitest run tests/core/tool-registry.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/tool-registry.ts tests/core/tool-registry.test.ts
git commit -m "Añadir tipos de tool y registro con gating ENABLE_WRITE (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: actual-client.ts — init + sync with TTL + stale flag

**Files:**
- Create: `src/core/actual-client.ts`
- Test: `tests/core/actual-client.test.ts`

**Interfaces:**
- Produces: `class ActualClient` with constructor `(api, config, now?: () => number)` and:
  - `ensureReady(opts?: { forWrite?: boolean }): Promise<{ stale: boolean; lastSynced: string | null }>` — first call runs `api.init(...)` + `api.downloadBudget(syncId)`; later calls run `api.sync()` only if TTL expired. If sync throws: reads return `{stale: true, lastSynced}`; `forWrite: true` re-throws.
  - `shutdown(): Promise<void>`.
- Consumed by Task 6's wrapper; tools never call it directly.

- [ ] **Step 1: Write failing tests** — `tests/core/actual-client.test.ts`

```ts
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
```

- [ ] **Step 2: Run** `npx vitest run tests/core/actual-client.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/core/actual-client.ts`

```ts
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

  async ensureReady(opts: { forWrite?: boolean } = {}): Promise<{ stale: boolean; lastSynced: string | null }> {
    if (!this.initialized) {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
      await this.api.init({
        dataDir: this.config.dataDir,
        serverURL: this.config.serverUrl,
        password: this.config.password,
      });
      await this.api.downloadBudget(this.config.syncId);
      this.initialized = true;
      this.lastSyncMs = this.now();
      return { stale: false, lastSynced: new Date(this.lastSyncMs).toISOString() };
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
        return { stale: true, lastSynced: this.lastSyncMs ? new Date(this.lastSyncMs).toISOString() : null };
      }
    }
    return { stale: false, lastSynced: this.lastSyncMs ? new Date(this.lastSyncMs).toISOString() : null };
  }

  async shutdown(): Promise<void> {
    if (this.initialized) {
      await this.api.shutdown();
      this.initialized = false;
    }
  }
}
```

- [ ] **Step 4: Run** `npx vitest run tests/core/actual-client.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/actual-client.ts tests/core/actual-client.test.ts
git commit -m "Añadir ActualClient: init único y sync con TTL y modo stale (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: server.ts + index.ts — MCP wiring and result wrapper

**Files:**
- Create: `src/core/server.ts`, `src/index.ts` (replaces placeholder), `src/tools/index.ts` (empty list for now)
- Test: `tests/core/server.test.ts`

**Interfaces:**
- Produces:
  - `buildToolResult(payload: unknown, meta: { stale: boolean; lastSynced: string | null }): { content: [{ type: 'text'; text: string }]; structuredContent: any }` — if `meta.stale`, payload gains `stale_data: true` and `last_synced`.
  - `createServer(deps: { tools: ToolDef[]; client: ActualClient; api: any; config: Config }): McpServer` — registers each tool via `server.registerTool(name, { description, inputSchema, annotations }, wrappedHandler)`; the wrapped handler calls `client.ensureReady({ forWrite: !tool.readOnly })`, then `tool.handler(input, { api, config })`, then `buildToolResult`. Errors are caught and returned as `{ content: [{type:'text', text: JSON.stringify({error: {...}})}], isError: true }` with shape `{ error: { code: string; message: string; hint?: string } }` (`code`: `invalid_input` for ZodError, otherwise `tool_failed`).
  - `src/tools/index.ts`: `export const allTools: ToolDef[] = [];` — each tool task appends its import here.
- `src/index.ts`: loads dotenv, redirects `console.log` to stderr BEFORE importing `@actual-app/api` (v1 lesson), builds config/client/server, connects `StdioServerTransport`, handles SIGINT/SIGTERM with `client.shutdown()`.

- [ ] **Step 1: Write failing tests** — `tests/core/server.test.ts` (test `buildToolResult` pure function; server wiring is covered by registry tests + smoke)

```ts
import { describe, it, expect } from 'vitest';
import { buildToolResult } from '../../src/core/server.js';

describe('buildToolResult', () => {
  it('wraps payload as text + structuredContent', () => {
    const r = buildToolResult({ a: 1 }, { stale: false, lastSynced: '2026-07-21T10:00:00.000Z' });
    expect(r.content[0].type).toBe('text');
    expect(JSON.parse(r.content[0].text)).toEqual({ a: 1 });
    expect(r.structuredContent).toEqual({ a: 1 });
  });
  it('adds stale_data flags when stale', () => {
    const r = buildToolResult({ a: 1 }, { stale: true, lastSynced: '2026-07-20T09:00:00.000Z' });
    expect(r.structuredContent).toMatchObject({ a: 1, stale_data: true, last_synced: '2026-07-20T09:00:00.000Z' });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/core/server.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/core/server.ts`

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodError } from 'zod';
import type { Config } from './config.js';
import type { ToolDef, ToolContext } from './types.js';
import type { ActualClient } from './actual-client.js';

export function buildToolResult(
  payload: unknown,
  meta: { stale: boolean; lastSynced: string | null },
) {
  const body: any =
    meta.stale && payload && typeof payload === 'object'
      ? { ...(payload as object), stale_data: true, last_synced: meta.lastSynced }
      : payload;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(body) }],
    structuredContent: body,
  };
}

function errorResult(code: string, message: string, hint?: string) {
  const body = { error: { code, message, ...(hint ? { hint } : {}) } };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(body) }],
    isError: true,
  };
}

export function createServer(deps: {
  tools: ToolDef[];
  client: ActualClient;
  api: any;
  config: Config;
}): McpServer {
  const server = new McpServer({ name: 'actual-budget-mcp', version: '2.0.0' });
  const ctx: ToolContext = { api: deps.api, config: deps.config };

  for (const tool of deps.tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        annotations: tool.readOnly
          ? { readOnlyHint: true }
          : { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      async (input: any) => {
        try {
          const meta = await deps.client.ensureReady({ forWrite: !tool.readOnly });
          const payload = await tool.handler(input ?? {}, ctx);
          return buildToolResult(payload, meta);
        } catch (err) {
          if (err instanceof ZodError) {
            return errorResult('invalid_input', 'Entrada inválida', err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
          }
          console.error(`[actual-mcp] Error en ${tool.name}:`, err);
          return errorResult('tool_failed', `${tool.name}: ${(err as Error).message}`);
        }
      },
    );
  }
  return server;
}
```

`src/tools/index.ts`:

```ts
import type { ToolDef } from '../core/types.js';
export const allTools: ToolDef[] = [];
```

`src/index.ts`:

```ts
#!/usr/bin/env node
// stdout es el canal MCP: redirigir console.log ANTES de cargar nada.
const origLog = console.log;
console.log = (...args: unknown[]) => console.error('[log]', ...args);

import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as api from '@actual-app/api';
import { loadConfig } from './core/config.js';
import { ActualClient } from './core/actual-client.js';
import { collectTools } from './core/tool-registry.js';
import { createServer } from './core/server.js';
import { allTools } from './tools/index.js';

async function main() {
  const config = loadConfig();
  const client = new ActualClient(api, config);
  const tools = collectTools(allTools, config.enableWrite);
  const server = createServer({ tools, client, api, config });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => { await client.shutdown(); process.exit(0); });
  }

  await server.connect(new StdioServerTransport());
  console.error(`[actual-mcp] v2 activo por stdio — ${tools.length} tools (write=${config.enableWrite})`);
}

main().catch((err) => { console.error('[actual-mcp] Error fatal:', err); process.exit(1); });
```

Also: `npm install dotenv@latest` (kept from v1 dependencies if already present).

- [ ] **Step 4: Run** `npx vitest run tests/core/server.test.ts` — Expected: PASS. Run `npm run build` — Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/server.ts src/index.ts src/tools/index.ts tests/core/server.test.ts package.json package-lock.json
git commit -m "Añadir server MCP v2: wrapper de resultados, errores estructurados y arranque stdio

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Test helper + `get_accounts`

**Files:**
- Create: `tests/helpers/mock-api.ts`, `src/tools/get_accounts.ts`
- Modify: `src/tools/index.ts`
- Test: `tests/tools/get_accounts.test.ts`

**Interfaces:**
- Produces (helper, reused by every tool test):

```ts
// tests/helpers/mock-api.ts
import { vi } from 'vitest';
import type { Config } from '../../src/core/config.js';

export const testConfig: Config = {
  serverUrl: 'https://x', password: 'p', syncId: 's', dataDir: '/tmp/x',
  locale: 'en-US', currency: 'USD', syncTtlSeconds: 60, enableWrite: true,
};

/** Chainable stand-in for api.q(): records table + calls, returned as the query object. */
export function chainableQ() {
  const calls: Record<string, unknown[]> = {};
  const builder: any = { calls };
  for (const m of ['filter', 'select', 'orderBy', 'limit', 'offset', 'calculate', 'options', 'groupBy']) {
    builder[m] = vi.fn((arg: unknown) => { (calls[m] ??= []).push(arg); return builder; });
  }
  return builder;
}

export function mockApi(overrides: Record<string, unknown> = {}) {
  return {
    getAccounts: vi.fn(async () => []),
    getCategories: vi.fn(async () => []),
    getCategoryGroups: vi.fn(async () => []),
    getBudgetMonth: vi.fn(async () => ({})),
    getNote: vi.fn(async () => null),
    q: vi.fn((table: string) => { const b = chainableQ(); b.table = table; return b; }),
    runQuery: vi.fn(async () => ({ data: [] })),
    ...overrides,
  };
}
```

- Produces (tool): `get_accounts` output `{ accounts: [{ id, name, type, on_budget, closed, amount, amount_formatted }], total_count }`.
- Registration pattern used by ALL tool tasks: add `import { tool as toolGetAccounts } from './get_accounts.js';` to `src/tools/index.ts` and append it to `allTools`.

- [ ] **Step 1: Write failing test** — `tests/tools/get_accounts.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_accounts.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const accounts = [
  { id: 'a1', name: 'Banco', type: 'checking', offbudget: false, closed: false, balance_current: 162498 },
  { id: 'a2', name: 'Pensión', type: 'investment', offbudget: true, closed: false, balance_current: 500000 },
  { id: 'a3', name: 'Vieja', type: 'checking', offbudget: false, closed: true, balance_current: 0 },
];

describe('get_accounts', () => {
  it('excludes closed by default, converts amounts', async () => {
    const api = mockApi({ getAccounts: async () => accounts });
    const r: any = await tool.handler({}, { api, config: testConfig });
    expect(r.accounts.map((a: any) => a.id)).toEqual(['a1', 'a2']);
    expect(r.accounts[0]).toMatchObject({ amount: 1624.98, amount_formatted: '$1,624.98', on_budget: true });
    expect(r.total_count).toBe(2);
  });
  it('includes closed and filters off-budget on demand', async () => {
    const api = mockApi({ getAccounts: async () => accounts });
    const r: any = await tool.handler({ include_closed: true, include_off_budget: false }, { api, config: testConfig });
    expect(r.accounts.map((a: any) => a.id)).toEqual(['a1', 'a3']);
  });
  it('is registered as read-only with valid name', () => {
    expect(tool.readOnly).toBe(true);
    expect(tool.name).toBe('get_accounts');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tools/get_accounts.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/get_accounts.ts`

```ts
import { z } from 'zod';
import { moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

const input = {
  include_closed: z.boolean().default(false).describe('Include closed accounts'),
  include_off_budget: z.boolean().default(true).describe('Include off-budget accounts (pensions, funds, mortgage)'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_accounts',
  description: 'List accounts with current balances. Off-budget accounts (pensions, funds, mortgage) included by default.',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const args = schema.parse(raw ?? {});
    const all = await api.getAccounts();
    const accounts = all
      .filter((a: any) => (args.include_closed || !a.closed) && (args.include_off_budget || !a.offbudget))
      .map((a: any) => ({
        id: a.id,
        name: a.name,
        type: a.type ?? 'checking',
        on_budget: !a.offbudget,
        closed: !!a.closed,
        ...moneyFields(a.balance_current ?? 0, config.locale, config.currency),
      }));
    return { accounts, total_count: accounts.length };
  },
};
```

`src/tools/index.ts` becomes:

```ts
import type { ToolDef } from '../core/types.js';
import { tool as getAccounts } from './get_accounts.js';

export const allTools: ToolDef[] = [getAccounts];
```

- [ ] **Step 4: Run** `npx vitest run tests/tools/get_accounts.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/mock-api.ts src/tools/get_accounts.ts src/tools/index.ts tests/tools/get_accounts.test.ts
git commit -m "Añadir get_accounts y helper de mocks para tests de tools (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: `get_net_worth`

**Files:**
- Create: `src/tools/get_net_worth.ts`
- Modify: `src/tools/index.ts` (append import + entry, same pattern as Task 7 Step 3)
- Test: `tests/tools/get_net_worth.test.ts`

**Interfaces:**
- Produces output: `{ net_worth: {amount, amount_formatted}, on_budget: { total: {amount, amount_formatted}, accounts: [{name, amount, amount_formatted}] }, off_budget: { total: {...}, accounts: [...] } }`. Open accounts only; off-budget ALWAYS included (spec pillar).

- [ ] **Step 1: Write failing test** — `tests/tools/get_net_worth.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_net_worth.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

describe('get_net_worth', () => {
  it('includes off-budget (pensions, mortgage) and excludes closed', async () => {
    const api = mockApi({
      getAccounts: async () => [
        { id: 'a1', name: 'Banco', offbudget: false, closed: false, balance_current: 1234567 },
        { id: 'a2', name: 'Pensión', offbudget: true, closed: false, balance_current: 5000000 },
        { id: 'a3', name: 'Hipoteca', offbudget: true, closed: false, balance_current: -12000000 },
        { id: 'a4', name: 'Cerrada', offbudget: false, closed: true, balance_current: 77777 },
      ],
    });
    const r: any = await tool.handler({}, { api, config: testConfig });
    expect(r.net_worth.amount).toBeCloseTo(-57654.33, 2);   // 12345.67 + 50000.00 - 120000.00
    expect(r.on_budget.total.amount).toBeCloseTo(12345.67, 2);
    expect(r.off_budget.total.amount).toBeCloseTo(-70000.0, 1);
    expect(r.off_budget.accounts).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tools/get_net_worth.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/get_net_worth.ts`

```ts
import { moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

export const tool: ToolDef = {
  name: 'get_net_worth',
  description: 'Full net worth: on-budget + off-budget (pensions, funds, mortgage) with per-account breakdown. Open accounts only.',
  readOnly: true,
  inputSchema: {},
  handler: async (_raw, { api, config }) => {
    const fmt = (c: number) => moneyFields(c, config.locale, config.currency);
    const open = (await api.getAccounts()).filter((a: any) => !a.closed);
    const bucket = (off: boolean) => {
      const accs = open.filter((a: any) => !!a.offbudget === off);
      const cents = accs.reduce((s: number, a: any) => s + (a.balance_current ?? 0), 0);
      return { total: fmt(cents), accounts: accs.map((a: any) => ({ name: a.name, ...fmt(a.balance_current ?? 0) })), cents };
    };
    const on = bucket(false);
    const offb = bucket(true);
    return {
      net_worth: fmt(on.cents + offb.cents),
      on_budget: { total: on.total, accounts: on.accounts },
      off_budget: { total: offb.total, accounts: offb.accounts },
    };
  },
};
```

Append to `src/tools/index.ts`: `import { tool as getNetWorth } from './get_net_worth.js';` and add `getNetWorth` to `allTools`.

- [ ] **Step 4: Run** `npx vitest run tests/tools/get_net_worth.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/get_net_worth.ts src/tools/index.ts tests/tools/get_net_worth.test.ts
git commit -m "Añadir get_net_worth con desglose on/off-budget (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `get_categories`

**Files:**
- Create: `src/tools/get_categories.ts`
- Modify: `src/tools/index.ts` (append, Task 7 pattern)
- Test: `tests/tools/get_categories.test.ts`

**Interfaces:**
- Produces output: `{ groups: [{ id, name, is_income, categories: [{ id, name, hidden, note? }] }] }`. `include_notes: true` calls `api.getNote(category.id)` per category (26.6 API).

- [ ] **Step 1: Write failing test** — `tests/tools/get_categories.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_categories.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const groups = [
  { id: 'g1', name: 'Comida', is_income: false, categories: [
    { id: 'c1', name: 'Alimentacion', hidden: false, group_id: 'g1' },
    { id: 'c2', name: 'Oculta', hidden: true, group_id: 'g1' },
  ]},
  { id: 'g2', name: 'Income', is_income: true, categories: [{ id: 'c3', name: 'Salary', hidden: false, group_id: 'g2' }] },
];

describe('get_categories', () => {
  it('returns groups with visible categories by default', async () => {
    const api = mockApi({ getCategoryGroups: async () => groups });
    const r: any = await tool.handler({}, { api, config: testConfig });
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0].categories.map((c: any) => c.id)).toEqual(['c1']);
    expect(r.groups[1].is_income).toBe(true);
  });
  it('includes hidden and notes on demand', async () => {
    const api = mockApi({
      getCategoryGroups: async () => groups,
      getNote: async (id: string) => (id === 'c1' ? '#template 350' : null),
    });
    const r: any = await tool.handler({ include_hidden: true, include_notes: true }, { api, config: testConfig });
    expect(r.groups[0].categories).toHaveLength(2);
    expect(r.groups[0].categories[0].note).toBe('#template 350');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tools/get_categories.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/get_categories.ts`

```ts
import { z } from 'zod';
import type { ToolDef } from '../core/types.js';

const input = {
  include_hidden: z.boolean().default(false).describe('Include hidden categories'),
  include_notes: z.boolean().default(false).describe('Include category notes (templates/goals)'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_categories',
  description: 'Category groups and categories with their IDs (IDs are required by write tools).',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api }) => {
    const args = schema.parse(raw ?? {});
    const groups = await api.getCategoryGroups();
    const out = [];
    for (const g of groups) {
      const cats = [];
      for (const c of g.categories ?? []) {
        if (!args.include_hidden && c.hidden) continue;
        const row: any = { id: c.id, name: c.name, hidden: !!c.hidden };
        if (args.include_notes) {
          const note = await api.getNote(c.id);
          if (note) row.note = note;
        }
        cats.push(row);
      }
      out.push({ id: g.id, name: g.name, is_income: !!g.is_income, categories: cats });
    }
    return { groups: out };
  },
};
```

Append to `src/tools/index.ts` (Task 7 pattern).

- [ ] **Step 4: Run** `npx vitest run tests/tools/get_categories.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/get_categories.ts src/tools/index.ts tests/tools/get_categories.test.ts
git commit -m "Añadir get_categories con notas opcionales (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: `get_transactions` (ActualQL)

**Files:**
- Create: `src/tools/get_transactions.ts`
- Modify: `src/tools/index.ts` (append, Task 7 pattern)
- Test: `tests/tools/get_transactions.test.ts`

**Interfaces:**
- Produces output: `{ transactions: [{ id, date, account, payee, category, amount, amount_formatted, notes?, is_transfer?, is_split? }], total_count, limit, offset }`.
- ActualQL detail: rows are fetched with `api.q('transactions')` + `api.runQuery`. Select uses dotted fields so names come resolved: `['id','date','account.name','payee.name','category.name','amount','notes','transfer_id','is_parent']`. `runQuery` returns `{ data }` where dotted selects arrive as flat keys (`row['account.name']`). Two queries per call: one `.calculate({ $count: 'id' })` for `total_count`, one paged select.

- [ ] **Step 1: Write failing test** — `tests/tools/get_transactions.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_transactions.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const rows = [
  { id: 't1', date: '2026-06-10', 'account.name': 'Banco', 'payee.name': 'Mercadona',
    'category.name': 'Alimentacion', amount: -4550, notes: null, transfer_id: null, is_parent: false },
  { id: 't2', date: '2026-06-09', 'account.name': 'Banco', 'payee.name': 'Traspaso',
    'category.name': null, amount: -10000, notes: null, transfer_id: 'x9', is_parent: false },
];

describe('get_transactions', () => {
  it('maps rows compactly and flags transfers', async () => {
    const api = mockApi({
      runQuery: async (q: any) => (q.calls?.calculate ? { data: 2 } : { data: rows }),
    });
    const r: any = await tool.handler(
      { start_date: '2026-06-01', end_date: '2026-06-30', include_transfers: true },
      { api, config: testConfig },
    );
    expect(r.transactions[0]).toMatchObject({
      id: 't1', account: 'Banco', payee: 'Mercadona', category: 'Alimentacion', amount: -45.5,
    });
    expect(r.transactions[0].is_transfer).toBeUndefined();
    expect(r.transactions[1].is_transfer).toBe(true);
    expect(r.total_count).toBe(2);
  });
  it('filters transfers out via query by default and applies pagination filters', async () => {
    const api = mockApi();
    await tool.handler({ start_date: '2026-06-01', end_date: '2026-06-30', limit: 10, offset: 20 }, { api, config: testConfig });
    // Inspect the recorded chainable calls of the SELECT query (2nd q() call)
    const selectQ: any = (api.q as any).mock.results[1].value;
    const filters = Object.assign({}, ...selectQ.calls.filter.flat());
    expect(filters.transfer_id).toEqual(null);
    expect(selectQ.calls.limit).toEqual([10]);
    expect(selectQ.calls.offset).toEqual([20]);
  });
  it('rejects an invalid date', async () => {
    const api = mockApi();
    await expect(
      tool.handler({ start_date: 'junio', end_date: '2026-06-30' }, { api, config: testConfig }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tools/get_transactions.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/get_transactions.ts`

```ts
import { z } from 'zod';
import { moneyFields, toCents } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato YYYY-MM-DD');

const input = {
  start_date: DATE.describe('Start date YYYY-MM-DD'),
  end_date: DATE.describe('End date YYYY-MM-DD'),
  account_id: z.string().optional(),
  category_id: z.string().optional(),
  search_text: z.string().optional().describe('Substring match on payee name or notes'),
  min_amount: z.number().optional().describe('Units, e.g. -500'),
  max_amount: z.number().optional(),
  uncategorized: z.boolean().default(false),
  include_transfers: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_transactions',
  description: 'Search transactions by date range with optional filters (account, category, text, amount range, uncategorized). Transfers excluded by default. Paginated (max 200).',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const filters: any[] = [{ date: { $gte: a.start_date, $lte: a.end_date } }, { is_parent: false }];
    if (!a.include_transfers) filters.push({ transfer_id: null });
    if (a.account_id) filters.push({ account: a.account_id });
    if (a.category_id) filters.push({ category: a.category_id });
    if (a.uncategorized) filters.push({ category: null, transfer_id: null });
    if (a.min_amount !== undefined) filters.push({ amount: { $gte: toCents(a.min_amount) } });
    if (a.max_amount !== undefined) filters.push({ amount: { $lte: toCents(a.max_amount) } });
    if (a.search_text) {
      filters.push({ $or: [{ 'payee.name': { $like: `%${a.search_text}%` } }, { notes: { $like: `%${a.search_text}%` } }] });
    }

    let countQ: any = api.q('transactions');
    for (const f of filters) countQ = countQ.filter(f);
    const { data: total } = await api.runQuery(countQ.calculate({ $count: 'id' }));

    let selQ: any = api.q('transactions');
    for (const f of filters) selQ = selQ.filter(f);
    const { data } = await api.runQuery(
      selQ
        .orderBy({ date: 'desc' })
        .limit(a.limit)
        .offset(a.offset)
        .select(['id', 'date', 'account.name', 'payee.name', 'category.name', 'amount', 'notes', 'transfer_id', 'is_parent']),
    );

    const transactions = (data as any[]).map((t) => {
      const row: any = {
        id: t.id,
        date: t.date,
        account: t['account.name'] ?? 'Unknown',
        payee: t['payee.name'] ?? '',
        category: t['category.name'] ?? (t.transfer_id ? null : 'Uncategorized'),
        ...moneyFields(t.amount ?? 0, config.locale, config.currency),
      };
      if (t.notes) row.notes = t.notes;
      if (t.transfer_id) row.is_transfer = true;
      if (t.is_parent) row.is_split = true;
      return row;
    });

    return { transactions, total_count: typeof total === 'number' ? total : transactions.length, limit: a.limit, offset: a.offset };
  },
};
```

Append to `src/tools/index.ts` (Task 7 pattern).

- [ ] **Step 4: Run** `npx vitest run tests/tools/get_transactions.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/get_transactions.ts src/tools/index.ts tests/tools/get_transactions.test.ts
git commit -m "Añadir get_transactions con ActualQL, filtros y paginación (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: `get_spending_summary`

**Files:**
- Create: `src/tools/get_spending_summary.ts`
- Modify: `src/tools/index.ts` (append, Task 7 pattern)
- Test: `tests/tools/get_spending_summary.test.ts`

**Interfaces:**
- Produces output: `{ group_by, start_date, end_date, rows: [{ key, amount, amount_formatted, transaction_count? }], others? }` where `key` is the category/payee/month name. Sign convention: spending is returned as POSITIVE amounts (inverted), income rows negative — description says so, so the LLM reads "spent 1755.50 on groceries" directly.
- Implementation strategy: single ActualQL query selecting raw rows `['category.name','category.group.is_income','payee.name','date','amount','transfer_id']` filtered by date + `transfer_id: null` + `is_parent: false`, then aggregation in TypeScript (deterministic, unit-testable; avoids AQL groupBy quirks).

- [ ] **Step 1: Write failing test** — `tests/tools/get_spending_summary.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_spending_summary.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const rows = [
  { 'category.name': 'Alimentacion', 'category.group.is_income': false, 'payee.name': 'Mercadona', date: '2026-06-03', amount: -112340, transfer_id: null },
  { 'category.name': 'Alimentacion', 'category.group.is_income': false, 'payee.name': 'Lidl', date: '2026-06-20', amount: -63210, transfer_id: null },
  { 'category.name': 'Ropa', 'category.group.is_income': false, 'payee.name': 'Zara', date: '2026-06-10', amount: -8420, transfer_id: null },
  { 'category.name': 'Salary', 'category.group.is_income': true, 'payee.name': 'Taiko', date: '2026-06-01', amount: 350000, transfer_id: null },
];

describe('get_spending_summary', () => {
  it('groups by category, inverts sign, excludes income by default, sorts desc', async () => {
    const api = mockApi({ runQuery: async () => ({ data: rows }) });
    const r: any = await tool.handler({ start_date: '2026-06-01', end_date: '2026-06-30' }, { api, config: testConfig });
    expect(r.rows.map((x: any) => x.key)).toEqual(['Alimentacion', 'Ropa']);
    expect(r.rows[0]).toMatchObject({ amount: 1755.50, transaction_count: 2 });
  });
  it('groups by month across categories', async () => {
    const api = mockApi({ runQuery: async () => ({ data: rows }) });
    const r: any = await tool.handler(
      { start_date: '2026-06-01', end_date: '2026-06-30', group_by: 'month' },
      { api, config: testConfig },
    );
    expect(r.rows).toEqual([expect.objectContaining({ key: '2026-06', amount: 1839.70 })]);
  });
  it('rolls tail into others with top_n', async () => {
    const api = mockApi({ runQuery: async () => ({ data: rows }) });
    const r: any = await tool.handler(
      { start_date: '2026-06-01', end_date: '2026-06-30', top_n: 1 },
      { api, config: testConfig },
    );
    expect(r.rows).toHaveLength(1);
    expect(r.others).toMatchObject({ amount: 84.20, transaction_count: 1 });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tools/get_spending_summary.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/get_spending_summary.ts`

```ts
import { z } from 'zod';
import { moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato YYYY-MM-DD');

const input = {
  start_date: DATE,
  end_date: DATE,
  group_by: z.enum(['category', 'payee', 'month']).default('category'),
  include_income: z.boolean().default(false),
  top_n: z.number().int().min(1).optional().describe('Return top N rows and roll the rest into "others"'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_spending_summary',
  description: 'Aggregated spending by category, payee or month. Transfers always excluded. Spending amounts are positive; income negative. Sorted descending.',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const fmt = (c: number) => moneyFields(c, config.locale, config.currency);

    let q: any = api.q('transactions')
      .filter({ date: { $gte: a.start_date, $lte: a.end_date } })
      .filter({ transfer_id: null })
      .filter({ is_parent: false });
    const { data } = await api.runQuery(
      q.select(['category.name', 'category.group.is_income', 'payee.name', 'date', 'amount', 'transfer_id']),
    );

    const buckets = new Map<string, { cents: number; count: number }>();
    for (const t of data as any[]) {
      const isIncome = !!t['category.group.is_income'];
      if (!a.include_income && isIncome) continue;
      const key =
        a.group_by === 'month' ? String(t.date).slice(0, 7)
        : a.group_by === 'payee' ? (t['payee.name'] ?? 'Unknown')
        : (t['category.name'] ?? 'Uncategorized');
      const b = buckets.get(key) ?? { cents: 0, count: 0 };
      b.cents += -(t.amount ?? 0); // invert: spending positive
      b.count += 1;
      buckets.set(key, b);
    }

    let rows = [...buckets.entries()]
      .map(([key, b]) => ({ key, ...fmt(b.cents), transaction_count: b.count }))
      .sort((x, y) => y.amount - x.amount);
    if (a.group_by === 'month') rows = rows.sort((x, y) => x.key.localeCompare(y.key));

    let others;
    if (a.top_n && rows.length > a.top_n) {
      const tail = rows.slice(a.top_n);
      others = {
        ...fmt(tail.reduce((s, r) => s + Math.round(r.amount * 100), 0)),
        transaction_count: tail.reduce((s, r) => s + r.transaction_count, 0),
      };
      rows = rows.slice(0, a.top_n);
    }

    return { group_by: a.group_by, start_date: a.start_date, end_date: a.end_date, rows, ...(others ? { others } : {}) };
  },
};
```

Append to `src/tools/index.ts` (Task 7 pattern).

- [ ] **Step 4: Run** `npx vitest run tests/tools/get_spending_summary.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/get_spending_summary.ts src/tools/index.ts tests/tools/get_spending_summary.test.ts
git commit -m "Añadir get_spending_summary: agregados sin transferencias (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: `get_budget_month`

**Files:**
- Create: `src/tools/get_budget_month.ts`
- Modify: `src/tools/index.ts` (append, Task 7 pattern)
- Test: `tests/tools/get_budget_month.test.ts`

**Interfaces:**
- Produces output: `{ month, to_budget: {amount, amount_formatted}, income: {...}, budgeted: {...}, spent: {...}, categories: [{ id, name, group, budgeted, spent, balance, amount_formatted fields per each }] }`. `only_active=true` keeps rows where `budgeted != 0 || spent != 0 || balance != 0`. Category `id` included (write tools in Plan 2 need it for `set_budget`).

- [ ] **Step 1: Write failing test** — `tests/tools/get_budget_month.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_budget_month.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const budgetMonth = {
  month: '2026-07', toBudget: -5000000, totalIncome: 60000, totalBudgeted: 0, totalSpent: -150000,
  categoryGroups: [
    { id: 'g1', name: 'Comida', is_income: false, categories: [
      { id: 'c1', name: 'Alimentacion', budgeted: 0, spent: -45000, balance: -45000 },
      { id: 'c2', name: 'Sin actividad', budgeted: 0, spent: 0, balance: 0 },
    ]},
    { id: 'gi', name: 'Income', is_income: true, categories: [{ id: 'ci', name: 'Salary', budgeted: 0, spent: 0, balance: 0 }] },
  ],
};

describe('get_budget_month', () => {
  it('summarizes totals and filters inactive categories by default', async () => {
    const api = mockApi({ getBudgetMonth: async () => budgetMonth });
    const r: any = await tool.handler({ month: '2026-07' }, { api, config: testConfig });
    expect(r.to_budget.amount).toBeCloseTo(-50000.00, 2);
    expect(r.categories).toHaveLength(1);
    expect(r.categories[0]).toMatchObject({ id: 'c1', name: 'Alimentacion', group: 'Comida', spent: { amount: -450.00 } });
  });
  it('returns every expense category with only_active=false', async () => {
    const api = mockApi({ getBudgetMonth: async () => budgetMonth });
    const r: any = await tool.handler({ month: '2026-07', only_active: false }, { api, config: testConfig });
    expect(r.categories).toHaveLength(2); // income group still excluded
  });
  it('rejects bad month format', async () => {
    await expect(tool.handler({ month: 'julio' }, { api: mockApi(), config: testConfig })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tools/get_budget_month.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/get_budget_month.ts`

```ts
import { z } from 'zod';
import { moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

const input = {
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Mes en formato YYYY-MM'),
  only_active: z.boolean().default(true).describe('Only categories with budgeted, spent or balance != 0'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_budget_month',
  description: 'Budget status for a month: to-budget, income, totals and per-category budgeted/spent/balance. Category ids included for set_budget.',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const fmt = (c: number) => moneyFields(c ?? 0, config.locale, config.currency);
    const m = await api.getBudgetMonth(a.month);

    const categories = [];
    for (const g of m.categoryGroups ?? []) {
      if (g.is_income) continue;
      for (const c of g.categories ?? []) {
        const active = (c.budgeted ?? 0) !== 0 || (c.spent ?? 0) !== 0 || (c.balance ?? 0) !== 0;
        if (a.only_active && !active) continue;
        categories.push({
          id: c.id, name: c.name, group: g.name,
          budgeted: fmt(c.budgeted), spent: fmt(c.spent), balance: fmt(c.balance),
        });
      }
    }
    return {
      month: m.month,
      to_budget: fmt(m.toBudget), income: fmt(m.totalIncome),
      budgeted: fmt(m.totalBudgeted), spent: fmt(m.totalSpent),
      categories,
    };
  },
};
```

Append to `src/tools/index.ts` (Task 7 pattern).

- [ ] **Step 4: Run** `npx vitest run tests/tools/get_budget_month.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/get_budget_month.ts src/tools/index.ts tests/tools/get_budget_month.test.ts
git commit -m "Añadir get_budget_month compacto con ids de categoría (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: `get_budget_averages`

**Files:**
- Create: `src/tools/get_budget_averages.ts`
- Modify: `src/tools/index.ts` (append, Task 7 pattern)
- Test: `tests/tools/get_budget_averages.test.ts`

**Interfaces:**
- Produces output: `{ months_back, months_analyzed: ['2026-01', ...], categories: [{ id, name, group, average, median, max (each {amount, amount_formatted}), months_with_data }] }` sorted by average desc. Spending positive (inverted), income categories and transfers excluded. Reuses the raw-rows query pattern from Task 11 but selecting `['category.id','category.name','category.group.name','category.group.is_income','date','amount']`.
- Month window: computed from the CURRENT date at runtime — last `months_back` COMPLETE months (exclude the running month, it would bias averages down). Helper `lastCompleteMonths(n: number, today?: Date): { start: string; end: string; months: string[] }` exported for tests.

- [ ] **Step 1: Write failing test** — `tests/tools/get_budget_averages.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { tool, lastCompleteMonths } from '../../src/tools/get_budget_averages.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

describe('lastCompleteMonths', () => {
  it('excludes the running month', () => {
    const w = lastCompleteMonths(3, new Date('2026-07-21'));
    expect(w.months).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(w.start).toBe('2026-04-01');
    expect(w.end).toBe('2026-06-30');
  });
});

describe('get_budget_averages', () => {
  it('computes average, median and max per category', async () => {
    const rows = [
      { 'category.id': 'c1', 'category.name': 'Alimentacion', 'category.group.name': 'Comida', 'category.group.is_income': false, date: '2026-04-10', amount: -30000 },
      { 'category.id': 'c1', 'category.name': 'Alimentacion', 'category.group.name': 'Comida', 'category.group.is_income': false, date: '2026-05-10', amount: -50000 },
      { 'category.id': 'c1', 'category.name': 'Alimentacion', 'category.group.name': 'Comida', 'category.group.is_income': false, date: '2026-06-10', amount: -100000 },
    ];
    const api = mockApi({ runQuery: async () => ({ data: rows }) });
    const r: any = await tool.handler({ months_back: 3 }, { api, config: testConfig });
    const cat = r.categories[0];
    expect(cat).toMatchObject({ id: 'c1', months_with_data: 3 });
    expect(cat.average.amount).toBe(600);   // (300+500+1000)/3
    expect(cat.median.amount).toBe(500);
    expect(cat.max.amount).toBe(1000);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tools/get_budget_averages.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/get_budget_averages.ts`

```ts
import { z } from 'zod';
import { moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

export function lastCompleteMonths(n: number, today: Date = new Date()) {
  const months: string[] = [];
  const y = today.getFullYear(), m = today.getMonth(); // current (running) month excluded
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const endDate = new Date(Date.UTC(y, m, 0)); // last day of previous month
  return { start: `${months[0]}-01`, end: endDate.toISOString().slice(0, 10), months };
}

const input = {
  months_back: z.number().int().min(1).max(24).default(6).describe('Complete months to analyze (running month excluded)'),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_budget_averages',
  description: 'Per-category spending average, median and max over the last N complete months — input for budget preparation. Median resists anomalous months. Spending positive; transfers and income excluded.',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const fmt = (c: number) => moneyFields(Math.round(c), config.locale, config.currency);
    const win = lastCompleteMonths(a.months_back);

    let q: any = api.q('transactions')
      .filter({ date: { $gte: win.start, $lte: win.end } })
      .filter({ transfer_id: null })
      .filter({ is_parent: false });
    const { data } = await api.runQuery(
      q.select(['category.id', 'category.name', 'category.group.name', 'category.group.is_income', 'date', 'amount']),
    );

    // category -> month -> cents spent
    const perCat = new Map<string, { name: string; group: string; byMonth: Map<string, number> }>();
    for (const t of data as any[]) {
      if (t['category.group.is_income']) continue;
      const id = t['category.id'] ?? '__uncategorized__';
      const entry = perCat.get(id) ?? {
        name: t['category.name'] ?? 'Uncategorized',
        group: t['category.group.name'] ?? '',
        byMonth: new Map(),
      };
      const month = String(t.date).slice(0, 7);
      entry.byMonth.set(month, (entry.byMonth.get(month) ?? 0) + -(t.amount ?? 0));
      perCat.set(id, entry);
    }

    const categories = [...perCat.entries()]
      .map(([id, e]) => {
        const values = [...e.byMonth.values()].sort((x, y) => x - y);
        const sum = values.reduce((s, v) => s + v, 0);
        const mid = Math.floor(values.length / 2);
        const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
        return {
          id, name: e.name, group: e.group,
          average: fmt(sum / a.months_back),
          median: fmt(median),
          max: fmt(values[values.length - 1] ?? 0),
          months_with_data: values.length,
        };
      })
      .sort((x, y) => y.average.amount - x.average.amount);

    return { months_back: a.months_back, months_analyzed: win.months, categories };
  },
};
```

Append to `src/tools/index.ts` (Task 7 pattern).

- [ ] **Step 4: Run** `npx vitest run tests/tools/get_budget_averages.test.ts` — Expected: PASS (2 tests). Note the average divides by `months_back` (not months_with_data): a category with spending in 3 of 6 months averages over 6 — that is the correct budgeting basis.

- [ ] **Step 5: Commit**

```bash
git add src/tools/get_budget_averages.ts src/tools/index.ts tests/tools/get_budget_averages.test.ts
git commit -m "Añadir get_budget_averages: media/mediana/máximo por categoría (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: `get_schedules`

**Files:**
- Create: `src/tools/get_schedules.ts`
- Modify: `src/tools/index.ts` (append, Task 7 pattern)
- Test: `tests/tools/get_schedules.test.ts`

**Interfaces:**
- Produces output: `{ schedules: [{ id, name, next_date, amount, amount_formatted, completed }] }`. Queried via ActualQL `q('schedules').select(['id','name','next_date','completed','_amount'])` — the public API has no getSchedules; the schedules table is reachable through ActualQL (`_amount` holds cents; can be a number or a range object `{num1,num2}` for approximate amounts — take `num1` when object).

- [ ] **Step 1: Write failing test** — `tests/tools/get_schedules.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_schedules.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const rows = [
  { id: 's1', name: 'Hipoteca', next_date: '2026-08-01', completed: false, _amount: -85000 },
  { id: 's2', name: 'Gimnasio (aprox)', next_date: '2026-08-05', completed: false, _amount: { num1: -3500, num2: -4000 } },
  { id: 's3', name: 'Terminado', next_date: '2026-01-01', completed: true, _amount: -1000 },
];

describe('get_schedules', () => {
  it('excludes completed by default and normalizes amounts', async () => {
    const api = mockApi({ runQuery: async () => ({ data: rows }) });
    const r: any = await tool.handler({}, { api, config: testConfig });
    expect(r.schedules).toHaveLength(2);
    expect(r.schedules[0]).toMatchObject({ name: 'Hipoteca', amount: -850 });
    expect(r.schedules[1].amount).toBe(-35);
  });
  it('includes completed on demand', async () => {
    const api = mockApi({ runQuery: async () => ({ data: rows }) });
    const r: any = await tool.handler({ include_completed: true }, { api, config: testConfig });
    expect(r.schedules).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/tools/get_schedules.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `src/tools/get_schedules.ts`

```ts
import { z } from 'zod';
import { moneyFields } from '../core/money.js';
import type { ToolDef } from '../core/types.js';

const input = {
  include_completed: z.boolean().default(false),
};
const schema = z.object(input);

export const tool: ToolDef = {
  name: 'get_schedules',
  description: 'Recurring schedules configured in Actual (name, next date, amount).',
  readOnly: true,
  inputSchema: input,
  handler: async (raw, { api, config }) => {
    const a = schema.parse(raw ?? {});
    const { data } = await api.runQuery(
      api.q('schedules').select(['id', 'name', 'next_date', 'completed', '_amount']),
    );
    const schedules = (data as any[])
      .filter((s) => a.include_completed || !s.completed)
      .map((s) => {
        const cents = typeof s._amount === 'object' && s._amount !== null ? s._amount.num1 : (s._amount ?? 0);
        return { id: s.id, name: s.name ?? '', next_date: s.next_date, completed: !!s.completed, ...moneyFields(cents, config.locale, config.currency) };
      });
    return { schedules };
  },
};
```

Append to `src/tools/index.ts` (Task 7 pattern).

- [ ] **Step 4: Run** `npx vitest run tests/tools/get_schedules.test.ts` — Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/get_schedules.ts src/tools/index.ts tests/tools/get_schedules.test.ts
git commit -m "Añadir get_schedules vía ActualQL (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Retire v1, smoke script, full suite green

**Files:**
- Delete: `src/index.js`, `src/actualClient.js`, `src/tools/*.js` (all v1 files)
- Create: `scripts/smoke.ts`
- Modify: `package.json` (add `smoke` script), `README.md` (v2 usage note)
- Test: full suite + registry count test added to `tests/core/tool-registry.test.ts`

**Interfaces:**
- Consumes: everything. Final state of Plan 1: 8 read tools, `ENABLE_WRITE=false` default.

- [ ] **Step 1: Add the catalog-count test** (append to `tests/core/tool-registry.test.ts`)

```ts
import { allTools } from '../../src/tools/index.js';

describe('catalog (plan 1)', () => {
  it('ships exactly 8 read tools', () => {
    expect(allTools).toHaveLength(8);
    expect(allTools.every((t) => t.readOnly)).toBe(true);
    expect(collectTools(allTools, false)).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run** `npm test` — Expected: ALL tests pass (catalog test included).

- [ ] **Step 3: Delete v1 files**

```bash
git rm src/index.js src/actualClient.js src/tools/getAccounts.js src/tools/getBudgetMonths.js src/tools/getCategories.js src/tools/getNetWorth.js src/tools/getSummaryByCategory.js src/tools/getTransactions.js
```

- [ ] **Step 4: Create `scripts/smoke.ts`** (manual check against the real server; NOT in CI)

```ts
// Uso: npm run smoke  (requiere .env con credenciales reales)
import 'dotenv/config';
import * as api from '@actual-app/api';
import { loadConfig } from '../src/core/config.js';
import { ActualClient } from '../src/core/actual-client.js';
import { allTools } from '../src/tools/index.js';

const config = loadConfig();
const client = new ActualClient(api, config);
await client.ensureReady();
const ctx = { api, config };

const accounts: any = await allTools.find((t) => t.name === 'get_accounts')!.handler({}, ctx);
console.error(`Cuentas abiertas: ${accounts.total_count}`);
const nw: any = await allTools.find((t) => t.name === 'get_net_worth')!.handler({}, ctx);
console.error(`Patrimonio neto: ${nw.net_worth.amount_formatted} (on ${nw.on_budget.total.amount_formatted} / off ${nw.off_budget.total.amount_formatted})`);
console.error('>> Compara estas cifras con la UI de Actual antes de dar el smoke por bueno.');
await client.shutdown();
```

Add to `package.json` scripts: `"smoke": "tsx scripts/smoke.ts"`.

- [ ] **Step 5: Update `README.md`** — replace the v1 usage section with: v2 requires build (`npm run build`), Claude Desktop config uses `node dist/index.js` (or `npm run dev` with tsx during development), and document the 8 env vars from Global Constraints in a table.

- [ ] **Step 6: Run the full gate**

```bash
npm test && npm run build && npm run smoke
```

Expected: tests pass, build clean, smoke prints account count + net worth matching the Actual UI (manual verification by Marco).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Retirar v1 y cerrar Plan 1: 8 tools de lectura v2 con smoke manual

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Plan 2 preview (separate plan, written after Plan 1 ships)

The 8 write tools (`update_transaction`, `categorize_transactions`, `split_transaction`, `create_transaction`, `create_schedule`, `set_budget`, `transfer_budget`, `update_category_note`) build on this core: same ToolDef pattern with `readOnly: false`, amounts in units via `toCents`, sum validation for splits in integer cents, per-item results for batches. Spec sections: "Tool catalog — write (8)".
