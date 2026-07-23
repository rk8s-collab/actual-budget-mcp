# One-click distribution (.mcpb) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the server as an installable MCP Bundle (`.mcpb`) so a non-technical macOS user installs it in Claude Desktop by dragging one file, and restructure both READMEs to lead with that path.

**Architecture:** Packaging only — no change to `src/`. A version-controlled `manifest.json` at the repo root declares metadata, the 16 tools and a configuration form whose fields map to the environment variables `src/core/config.ts` already reads. A `scripts/bundle.ts` script stages a clean tree, installs production dependencies into it, validates the manifest and packs it with the official CLI. Vitest tests keep the manifest and the code from drifting apart.

**Tech Stack:** unchanged (TypeScript 6, Zod 4, Vitest) plus `@anthropic-ai/mcpb` 2.1.2 as a devDependency.

## Global Constraints

- **Manifest schema is MCPB v0.4** — verified against `@anthropic-ai/mcpb@2.1.2`'s bundled `mcpb-manifest-v0.4.schema.json`. Exact facts to honour:
  - `manifest_version` is the constant string `"0.4"`.
  - Root required fields: `name`, `version`, `description`, `author`, `server`.
  - `server` required fields: `type`, `entry_point`, `mcp_config`. `mcp_config` accepts `command`, `args`, `env`, `platform_overrides`.
  - Each `user_config` entry requires `type`, `title`, `description`; optional `required`, `default`, `multiple`, `sensitive`, `min`, `max`. `type` is one of `string | number | boolean | directory | file`.
  - `compatibility` accepts `claude_desktop`, `platforms` (`darwin | win32 | linux`), `runtimes` (`node`, `python`).
- **Platform scope: macOS Apple Silicon only** in this release — the bundled `better-sqlite3` binary is `Mach-O 64-bit arm64`. Declare `platforms: ["darwin"]` and `runtimes.node: ">=22"`.
- `ACTUAL_DATA_DIR` is deliberately NOT exposed in `user_config` (the server resolves it against the package root with mode `0700`).
- `ENABLE_WRITE` defaults to **false** (unchecked) in the form.
- No changes to any file under `src/`. If a task seems to need one, stop and report — it means the plan is wrong.
- Commits in Spanish, imperative, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- If `git commit` fails with a 1Password signing error, retry once after a few seconds; if it still fails, leave the work staged and report — never `--no-gpg-sign`.

---

### Task 1: manifest.json + version-consistency test

**Files:**
- Create: `manifest.json` (repo root)
- Test: `tests/bundle/manifest.test.ts`

**Interfaces:**
- Produces: `manifest.json` with `server.mcp_config.env` mapping each `user_config` key to the env var the server reads, using MCPB's `${user_config.KEY}` substitution syntax and `${__dirname}` for the entry point.
- Later tasks read this file; the packing script copies it into the bundle root.

- [ ] **Step 1: Write the failing test** — `tests/bundle/manifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('manifest.json', () => {
  it('declares MCPB schema 0.4 and the required root fields', () => {
    expect(manifest.manifest_version).toBe('0.4');
    for (const field of ['name', 'version', 'description', 'author', 'server']) {
      expect(manifest[field], `falta el campo obligatorio ${field}`).toBeDefined();
    }
  });

  it('keeps its version in sync with package.json', () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it('runs the built entry point with node', () => {
    expect(manifest.server.type).toBe('node');
    expect(manifest.server.entry_point).toBe('dist/index.js');
    expect(manifest.server.mcp_config.command).toBe('node');
    expect(manifest.server.mcp_config.args).toEqual(['${__dirname}/dist/index.js']);
  });

  it('targets macOS with Node >= 22', () => {
    expect(manifest.compatibility.platforms).toEqual(['darwin']);
    expect(manifest.compatibility.runtimes.node).toBe('>=22');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/bundle/manifest.test.ts` — Expected: FAIL (`manifest.json` does not exist).

- [ ] **Step 3: Create `manifest.json`** at the repo root (copy the version from `package.json`; at the time of writing it is `2.0.0-dev`):

```json
{
  "manifest_version": "0.4",
  "name": "actual-budget-mcp-es",
  "display_name": "Actual Budget",
  "version": "2.0.0-dev",
  "description": "Talk to your self-hosted Actual Budget: spending analysis, budget tracking, net worth and assisted writes.",
  "long_description": "An MCP server built for LLM consumption: transfers never pollute spending summaries, net worth includes off-budget accounts, amounts are converted server-side, and split transactions use real subtransactions. Write tools are opt-in and there are no delete tools.",
  "author": { "name": "Marco Antonio Pérez", "url": "https://github.com/marcoaperez" },
  "homepage": "https://github.com/marcoaperez/actual-budget-mcp-es",
  "documentation": "https://github.com/marcoaperez/actual-budget-mcp-es#readme",
  "support": "https://github.com/marcoaperez/actual-budget-mcp-es/issues",
  "license": "MIT",
  "icon": "icon.png",
  "keywords": ["actual-budget", "finance", "budgeting", "personal-finance"],
  "server": {
    "type": "node",
    "entry_point": "dist/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/index.js"],
      "env": {
        "ACTUAL_SERVER_URL": "${user_config.server_url}",
        "ACTUAL_SERVER_PASSWORD": "${user_config.password}",
        "ACTUAL_SYNC_ID": "${user_config.sync_id}",
        "LOCALE": "${user_config.locale}",
        "CURRENCY": "${user_config.currency}",
        "ENABLE_WRITE": "${user_config.enable_write}"
      }
    }
  },
  "user_config": {
    "server_url": {
      "type": "string",
      "title": "Actual server URL",
      "description": "URL of your self-hosted Actual Budget server, e.g. https://actual.example.org/",
      "required": true
    },
    "password": {
      "type": "string",
      "title": "Server password",
      "description": "The password you use to open Actual Budget in the browser",
      "required": true,
      "sensitive": true
    },
    "sync_id": {
      "type": "string",
      "title": "Budget Sync ID",
      "description": "In Actual: Settings → Advanced Settings → Sync ID",
      "required": true
    },
    "locale": {
      "type": "string",
      "title": "Locale",
      "description": "Formats amounts, e.g. en-US or es-ES",
      "required": false,
      "default": "en-US"
    },
    "currency": {
      "type": "string",
      "title": "Currency",
      "description": "ISO 4217 code, e.g. USD or EUR",
      "required": false,
      "default": "USD"
    },
    "enable_write": {
      "type": "boolean",
      "title": "Enable write tools",
      "description": "Off: 8 read-only tools. On: 8 more that can edit transactions, splits, budgets and notes. Your MCP client still asks for approval on every call.",
      "required": false,
      "default": false
    }
  },
  "compatibility": {
    "platforms": ["darwin"],
    "runtimes": { "node": ">=22" }
  },
  "tools": []
}
```

Leave `"tools": []` for now — Task 2 fills it and locks it with a test.

- [ ] **Step 4: Run** `npx vitest run tests/bundle/manifest.test.ts` — Expected: PASS (4 tests). Then `npm test` — Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add manifest.json tests/bundle/manifest.test.ts
git commit -m "Añadir manifest.json de MCPB con el formulario de configuración (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Manifest ↔ code consistency tests

**Files:**
- Modify: `manifest.json` (fill the `tools` array)
- Test: `tests/bundle/manifest.test.ts` (append)

**Interfaces:**
- Consumes: `allTools` from `src/tools/index.ts` (array of `ToolDef` with `name` and `description`); `loadConfig` from `src/core/config.ts`.
- Produces: a manifest whose `tools` array matches the registered catalogue exactly, and whose `user_config` keys are provably wired to env vars the server reads.

- [ ] **Step 1: Write the failing tests** — append to `tests/bundle/manifest.test.ts`:

```ts
import { allTools } from '../../src/tools/index.js';
import { loadConfig } from '../../src/core/config.js';

describe('manifest ↔ code consistency', () => {
  it('advertises exactly the registered tools', () => {
    const declared = (manifest.tools as Array<{ name: string }>).map((t) => t.name).sort();
    const registered = allTools.map((t) => t.name).sort();
    expect(declared).toEqual(registered);
  });

  it('gives every declared tool a description', () => {
    for (const tool of manifest.tools as Array<{ name: string; description?: string }>) {
      expect(tool.description, `${tool.name} sin description`).toBeTruthy();
    }
  });

  it('maps every user_config key to an env var the server actually reads', () => {
    const env = manifest.server.mcp_config.env as Record<string, string>;
    // Cada clave del formulario se referencia exactamente una vez en env
    for (const key of Object.keys(manifest.user_config)) {
      const refs = Object.values(env).filter((v) => v === '${user_config.' + key + '}');
      expect(refs, `user_config.${key} no está cableada en mcp_config.env`).toHaveLength(1);
    }
    // Y cada variable de entorno del manifiesto la entiende loadConfig
    const cfg = loadConfig({
      ACTUAL_SERVER_URL: 'https://actual.example.org/',
      ACTUAL_SERVER_PASSWORD: 'x',
      ACTUAL_SYNC_ID: '00000000-0000-0000-0000-000000000000',
      LOCALE: 'es-ES',
      CURRENCY: 'EUR',
      ENABLE_WRITE: 'true',
    });
    expect(cfg.locale).toBe('es-ES');
    expect(cfg.currency).toBe('EUR');
    expect(cfg.enableWrite).toBe(true);
  });

  it('does not expose ACTUAL_DATA_DIR in the form', () => {
    expect(Object.keys(manifest.user_config)).not.toContain('data_dir');
    expect(JSON.stringify(manifest.server.mcp_config.env)).not.toContain('ACTUAL_DATA_DIR');
  });

  it('defaults the write toggle to off', () => {
    expect(manifest.user_config.enable_write.default).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/bundle/manifest.test.ts` — Expected: FAIL on the first test (declared `[]` vs 16 registered names).

- [ ] **Step 3: Fill the `tools` array** in `manifest.json` with the 16 registered tools. Take each `name` and a one-line English `description` from the tool's own `description` field in `src/tools/*.ts` (shorten to one clause if the source description is long — the array is a shop window, not documentation):

```json
  "tools": [
    { "name": "get_accounts", "description": "List accounts with current balances" },
    { "name": "get_net_worth", "description": "Net worth with on/off-budget breakdown" },
    { "name": "get_categories", "description": "Category groups and categories with their ids" },
    { "name": "get_transactions", "description": "Search transactions by date, account, category, text or amount" },
    { "name": "get_spending_summary", "description": "Aggregated spending by category, payee or month" },
    { "name": "get_budget_month", "description": "Budget status for a month, per category" },
    { "name": "get_budget_averages", "description": "Average, median and max spending per category over N months" },
    { "name": "get_schedules", "description": "Recurring scheduled transactions" },
    { "name": "update_transaction", "description": "Edit a transaction's category, payee, notes, date or amount" },
    { "name": "categorize_transactions", "description": "Categorize up to 50 transactions in one call" },
    { "name": "split_transaction", "description": "Split a transaction into real subtransactions" },
    { "name": "create_transaction", "description": "Record a new expense or income, optionally already split" },
    { "name": "create_schedule", "description": "Create a recurring or one-off scheduled transaction" },
    { "name": "set_budget", "description": "Assign budget amounts to categories, single or bulk" },
    { "name": "transfer_budget", "description": "Move budgeted money between categories" },
    { "name": "update_category_note", "description": "Write a category note (goal templates)" }
  ]
```

- [ ] **Step 4: Run** `npx vitest run tests/bundle/manifest.test.ts` — Expected: PASS (9 tests total). Then `npm test` — Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add manifest.json tests/bundle/manifest.test.ts
git commit -m "Declarar las 16 tools en el manifiesto y blindar su coherencia con el código (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Bundle icon

**Files:**
- Create: `icon.png` (repo root, 256×256 PNG)
- Test: `tests/bundle/manifest.test.ts` (append one test)

**Interfaces:**
- Produces: `icon.png`, referenced by `manifest.json`'s `icon` field and copied into the bundle by Task 4.

- [ ] **Step 1: Write the failing test** — append:

```ts
describe('icon', () => {
  it('ships a 256x256 PNG next to the manifest', () => {
    const file = path.join(root, manifest.icon as string);
    const buf = readFileSync(file);
    // Cabecera PNG y dimensiones en el chunk IHDR (bytes 16-23, big-endian)
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBe(256);
    expect(buf.readUInt32BE(20)).toBe(256);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL (`icon.png` missing).

- [ ] **Step 3: Generate the icon.** No design dependency and no binary editing by hand — render an SVG to PNG with macOS's built-in tooling. Write `scripts/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="56" fill="#2b3a55"/>
  <path d="M64 168 L104 112 L136 144 L192 76" fill="none" stroke="#7cc4a4" stroke-width="16"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="192" cy="76" r="14" fill="#7cc4a4"/>
  <rect x="60" y="188" width="136" height="12" rx="6" fill="#7cc4a4" opacity="0.55"/>
</svg>
```

Then convert it (`qlmanage` ships with macOS; `sips` resizes):

```bash
qlmanage -t -s 256 -o . scripts/icon.svg && mv icon.svg.png icon.png && sips -z 256 256 icon.png > /dev/null
```

If `qlmanage` is unavailable or produces a non-256 image, fall back to `sips -s format png --resampleHeightWidth 256 256 scripts/icon.svg --out icon.png`. Verify with `sips -g pixelWidth -g pixelHeight icon.png` before moving on — the test asserts exactly 256×256.

- [ ] **Step 4: Run** `npx vitest run tests/bundle/manifest.test.ts` — Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add icon.png scripts/icon.svg tests/bundle/manifest.test.ts
git commit -m "Añadir icono del bundle generado desde SVG (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Bundle build script

**Files:**
- Create: `scripts/bundle.ts`
- Modify: `package.json` (devDependency + `bundle` script), `.gitignore` (ignore `build/`)

**Interfaces:**
- Consumes: `manifest.json`, `icon.png`, the `dist/` produced by `npm run build`.
- Produces: `build/actual-budget-mcp-es.mcpb`, and a staging tree at `build/stage/`. Run with `npm run bundle`.

- [ ] **Step 1: Add the tooling**

```bash
npm install -D @anthropic-ai/mcpb@^2.1.2
```

Add to `package.json` scripts: `"bundle": "tsx scripts/bundle.ts"`. Add `build/` to `.gitignore`.

- [ ] **Step 2: Write `scripts/bundle.ts`**

```ts
// Empaqueta el servidor como MCP Bundle (.mcpb) instalable en Claude Desktop.
// Uso: npm run bundle  →  build/actual-budget-mcp-es.mcpb
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'build');
const stage = path.join(build, 'stage');

function run(cmd: string, args: string[], cwd = root) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

// 1. Compilar
run('npm', ['run', 'build']);

// 2. Escenario limpio
fs.rmSync(build, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// 3. Copiar lo que va dentro del bundle (y nada más)
fs.cpSync(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true });
for (const file of ['manifest.json', 'package-lock.json', 'icon.png', 'README.md', 'LICENSE']) {
  fs.copyFileSync(path.join(root, file), path.join(stage, file));
}

// package.json del bundle: sin scripts. `prepare` ejecuta `npm run build`, y npm lo
// lanzaría durante el `npm ci` de abajo — en el escenario no hay ni src/ ni TypeScript.
// Las dependencias nativas (better-sqlite3) SÍ conservan sus scripts de instalación.
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
delete pkg.scripts;
delete pkg.devDependencies;
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// 4. Solo dependencias de producción, con su binario nativo
run('npm', ['ci', '--omit=dev'], stage);
// package-lock.json solo hacía falta para `npm ci`; no viaja en el bundle
fs.rmSync(path.join(stage, 'package-lock.json'), { force: true });

// 5. Validar el manifiesto y empaquetar
run('npx', ['mcpb', 'validate', path.join(stage, 'manifest.json')]);
const out = path.join(build, 'actual-budget-mcp-es.mcpb');
run('npx', ['mcpb', 'pack', stage, out]);

// 6. Informe
const sizeMb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.error(`\nBundle listo: ${out} (${sizeMb} MB)`);
console.error('Instálalo arrastrándolo a Claude Desktop → Ajustes → Extensiones.');
```

- [ ] **Step 3: Run it** — `npm run bundle`. Expected: `mcpb validate` reports the manifest is valid, `mcpb pack` writes the archive, and the script prints a size around 40 MB.

Two failure modes to expect, and what each means:
  - **`npm ci` complains that the lockfile does not match `package.json`.** The staged `package.json` drops `devDependencies`, which `npm ci` tolerates with `--omit=dev`; if it still refuses, the lockfile is genuinely stale — run `npm install` at the REPO ROOT to refresh it, commit that, and re-run. Do not run `npm install` inside the staging directory.
  - **The staged install skips the native binary.** If `unzip -l` (Step 4) shows no `better_sqlite3.node`, the install ran with scripts disabled — check for an `.npmrc` setting `ignore-scripts=true`, and report rather than working around it.

- [ ] **Step 4: Verify the archive contents**

```bash
npx mcpb info build/actual-budget-mcp-es.mcpb
unzip -l build/actual-budget-mcp-es.mcpb | grep -cE 'tests/|docs/|\.env'
unzip -l build/actual-budget-mcp-es.mcpb | grep -c 'better_sqlite3.node'
```

Expected: `info` prints the name, version and 16 tools; the first grep prints `0` (nothing that should not ship); the second prints at least `1` (the native binary is inside).

- [ ] **Step 5: Commit**

```bash
git add scripts/bundle.ts package.json package-lock.json .gitignore
git commit -m "Añadir script de empaquetado del bundle .mcpb

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: README restructure — Claude Desktop first, standard procedure second

**Files:**
- Modify: `README.md` (English), `README.es.md` (Spanish), `SECURITY.md`

**Interfaces:**
- Consumes: nothing in code. Both files end with the same section order so they can be diffed against each other.

Target section order, identical in both languages:

1. Title + pitch + feature highlights (existing content, unchanged)
2. **Install in Claude Desktop (recommended)** / **Instalación en Claude Desktop (recomendado)**
3. **Manual installation** / **Instalación manual** — for other MCP clients, Intel Macs, Windows, Linux
4. Tools tables (existing)
5. Security (existing, plus one line about the bundle)
6. Development (existing)
7. License (existing)

- [ ] **Step 1: Write the Claude Desktop section** (English wording; mirror it in Spanish). It must contain, in this order:

```markdown
## Install in Claude Desktop (recommended)

**Requirements:** a Mac with Apple Silicon (M1 or later), Claude Desktop, and a self-hosted
Actual Budget server you can reach. On Intel Macs, Windows or Linux, use
[Manual installation](#manual-installation) instead.

1. **Download** the latest `actual-budget-mcp-es.mcpb` from the
   [Releases page](https://github.com/marcoaperez/actual-budget-mcp-es/releases/latest).
2. **Find your Sync ID** — open Actual Budget in the browser, go to **Settings** →
   **Advanced Settings** → **IDs**, and copy the **Sync ID**.
3. **Install** — in Claude Desktop, open **Settings → Extensions**, drag the downloaded
   `.mcpb` file onto the page, review what it declares, and select **Install**.
4. **Fill the form** Claude Desktop shows:
   - **Actual server URL** — e.g. `https://actual.example.org/`
   - **Server password** — the one you use to open Actual in the browser (stored by Claude
     Desktop's secure storage, not in a config file)
   - **Budget Sync ID** — from step 2
   - **Locale** and **Currency** — e.g. `es-ES` and `EUR`; defaults are `en-US` and `USD`
   - **Enable write tools** — leave this **off** for now (see below)
5. **Check it works** — start a new conversation and ask *"what accounts do I have?"*.
   You should get your account list with balances.

### Turning on write access

With the checkbox off you get the 8 read-only tools. Turn it on (Settings → Extensions →
this extension → configure) to add the 8 write tools: editing and categorizing transactions,
real splits, scheduled transactions, budget assignment and category notes. Claude Desktop
still asks for your approval on every single call, and there are no delete tools.

### Updating

Download the newer `.mcpb` and drag it in again — your configuration is kept.
```

- [ ] **Step 2: Rewrite the manual section** as `## Manual installation` / `## Instalación manual`, opening with one line saying who it is for ("other MCP clients, Intel Macs, Windows and Linux"), then the existing clone/install/build steps and the client-config JSON with the env-var table. Two fixes while you are in there:
  - `README.es.md` says `cd ~/GITs/Actual-MCP` (the maintainer's local path). It must be `cd actual-budget-mcp-es`, matching the clone command above it.
  - The English README's "Finding your Sync ID" steps move up into the Claude Desktop section (step 2 above); keep a one-line cross-reference in the manual section instead of duplicating them.

- [ ] **Step 3: Add the bundle note to `SECURITY.md`**, at the end of the "Credentials" subsection:

```markdown
When installed as an MCP Bundle (`.mcpb`), the Actual password is a **sensitive** config
field: the MCP client stores it in its own secure storage instead of a plaintext config
file. The bundle also ships production dependencies, including a native SQLite binary
compiled for the platform it targets.
```

- [ ] **Step 4: Verify both files**

```bash
grep -n '^## ' README.md
grep -n '^## ' README.es.md
grep -rn 'GITs/Actual-MCP' README.md README.es.md || echo "sin rutas locales"
```

Expected: the two `grep -n '^## '` listings describe the same section order (allowing for translated headings); the third prints `sin rutas locales`.

- [ ] **Step 5: Commit**

```bash
git add README.md README.es.md SECURITY.md
git commit -m "Reestructurar ambos README: Claude Desktop primero, instalación manual después

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Release documentation and closing

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `README.es.md` (Development sections)
- Test: full suite

- [ ] **Step 1: Document the release procedure** in the Development section of both READMEs:

```markdown
### Releasing a bundle

1. Bump `version` in `package.json` **and** `manifest.json` (a test enforces they match).
2. `npm test && npm run build && npm run bundle`
3. Install `build/actual-budget-mcp-es.mcpb` locally and check it works.
4. `gh release create vX.Y.Z build/actual-budget-mcp-es.mcpb`, noting in the release
   description that the bundle targets macOS on Apple Silicon.
```

- [ ] **Step 2: Update `CLAUDE.md`** — in "Estado y próximos pasos", record that the project is distributed as an `.mcpb` bundle for Claude Desktop (macOS arm64) with the manual path documented for everything else, and that `manifest.json` must be kept in sync with `package.json` and with the tool catalogue (tests enforce both).

- [ ] **Step 3: Full gate**

```bash
npm test && npm run build && npm run bundle
```

Expected: tests green, build clean, bundle produced.

- [ ] **Step 4: Manual verification on the maintainer's Mac** (not automatable; the real gate):
  - Install `build/actual-budget-mcp-es.mcpb` in Claude Desktop and fill the form with the real server.
  - Confirm the Extensions page lists the server and its tools.
  - With **Enable write tools** off, confirm the model sees **8** tools; turn it on and confirm **16**.
  - Ask a read question and confirm real data comes back in the configured currency.
  - Uninstall the extension and confirm the pre-existing manual `actual-budget` entry still works.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Documentar el proceso de release del bundle y actualizar el estado

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
