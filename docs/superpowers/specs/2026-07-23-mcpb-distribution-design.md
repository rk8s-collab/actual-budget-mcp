# One-click distribution (.mcpb) — Design Spec

**Date:** 2026-07-23
**Status:** Approved by the maintainer (design review)
**Language note:** Spec in English (publication-ready), like the v2 design spec.

## Overview

Today the only way to install this server is developer-shaped: clone the repo, install Node, run a build, then hand-edit `claude_desktop_config.json` with an absolute path and a set of environment variables. That is a hard stop for the audience this project is actually useful to — people who use Claude Desktop to look at their household budget and do not write code.

This spec covers packaging the server as an **MCP Bundle (`.mcpb`)**: a zip archive containing the built server, its production dependencies and a `manifest.json`, which Claude Desktop installs with a drag-and-drop and configures through a generated form. No Node install, no Docker, no JSON editing.

It also covers restructuring both READMEs so the Claude Desktop path comes first with concrete steps, and the manual procedure follows for every other MCP client.

### Goals

- A downloadable `actual-budget-mcp-es.mcpb` on the repo's Releases page that a non-technical macOS (Apple Silicon) user can install in under a minute.
- Configuration through Claude Desktop's own form, with the Actual password declared as a **sensitive** field rather than sitting in plaintext in a config file.
- Write access remains opt-in — now a checkbox, unchecked by default.
- Documentation that leads with Claude Desktop and keeps the manual path for everyone else.

### Non-goals

- **Docker.** Considered and rejected for this audience: it would require installing Docker Desktop *and* still editing `claude_desktop_config.json` to add a `docker run -i --rm …` command — strictly more friction than today, not less. (For self-hosters who already live in Docker it would be a reasonable second channel; that is a separate decision, not this spec.)
- **Windows, Linux and Intel Macs** in this first release. The bundle embeds a platform-specific native binary (see Platform scope) and only Apple Silicon can be verified on the maintainer's machine.
- **Bundling/minifying** the server into a single file. `@actual-app/api` loads workers and resolves paths at runtime; bundlers break it. Dependencies ship as a plain `node_modules` tree.
- Publishing to npm (already possible via the `files` allowlist; unrelated to this work).

## Platform scope

`@actual-app/api` depends on `better-sqlite3`, which ships a compiled native module. In this repo's install it is a `Mach-O 64-bit bundle arm64` (~1.8 MB), i.e. **Apple Silicon only**.

The first release therefore targets **macOS on Apple Silicon (M1 and later)** and declares it in the manifest's compatibility block, so Claude Desktop refuses to install it elsewhere rather than failing mysteriously at runtime. Both READMEs state the limitation next to the download link and point Intel Mac, Windows and Linux users at the manual procedure, which works everywhere Node runs.

## Bundle contents

```
actual-budget-mcp-es.mcpb          (zip, ~40 MB)
├── manifest.json                  # metadata, tool list, config schema, compatibility
├── dist/                          # compiled server (tsc output)
├── node_modules/                  # production dependencies only, incl. the arm64 .node binary
├── package.json                   # runtime metadata (no dev scripts needed at run time)
├── README.md
├── LICENSE
└── icon.png                       # 256×256, shown in the Extensions list
```

Excluded: tests, `docs/`, `scripts/`, dev dependencies, `.env*`, `data/`.

### manifest.json

Key fields (MCPB manifest schema):

- `name`, `display_name`, `version` (kept in sync with `package.json`), `description`, `author`, `license: MIT`, `homepage`/`repository` pointing at the GitHub repo, `icon`.
- `server`: type `node`, entry point `dist/index.js`, launched with the bundle's own `node_modules` on the module path.
- `tools`: the 16 tools with their one-line descriptions, so the Extensions page shows what the server can do before installing.
- `compatibility`: `platforms: ["darwin"]`, minimum Claude Desktop version per the MCPB docs, and Node `>=22`.
- `user_config`: the form described below. Each entry maps to the environment variable the server already reads — **no code change to `src/core/config.ts` is required**, which is the point: the bundle is packaging, not a rewrite.

### Configuration form (`user_config`)

| Key | Env var | Type | Required | Default | Notes shown to the user |
|---|---|---|---|---|---|
| `server_url` | `ACTUAL_SERVER_URL` | string | yes | — | URL of your Actual Budget server |
| `password` | `ACTUAL_SERVER_PASSWORD` | string, **sensitive** | yes | — | Handled by Claude Desktop's secure storage, not written to a config file |
| `sync_id` | `ACTUAL_SYNC_ID` | string | yes | — | Actual → Settings → Advanced Settings → Sync ID |
| `locale` | `LOCALE` | string | no | `en-US` | Formats amounts, e.g. `es-ES` |
| `currency` | `CURRENCY` | string | no | `USD` | ISO 4217, e.g. `EUR` |
| `enable_write` | `ENABLE_WRITE` | boolean | no | `false` | **Unchecked by default.** When off, the 8 write tools are not registered at all |

`ACTUAL_DATA_DIR` is deliberately **not** exposed. The server already resolves a relative default against the package root (a Plan-1 fix), so the budget copy lands inside the installed bundle's directory with mode `0700`. Exposing it would invite users to point it somewhere world-readable.

## Build pipeline

A single `npm run bundle` script, implemented in `scripts/bundle.ts` (TypeScript, consistent with `scripts/smoke.ts`), performing:

1. `npm run build` — compile to `dist/`.
2. Stage a clean directory: copy `dist/`, `package.json`, `README.md`, `LICENSE`, `icon.png`, `manifest.json`.
3. `npm ci --omit=dev` inside the staging directory, so `node_modules` contains production dependencies only, with the native binary as installed on the build machine.
4. Validate the manifest with the official `@anthropic-ai/mcpb` CLI (`mcpb validate`).
5. Pack with `mcpb pack`, producing `actual-budget-mcp-es.mcpb` in `build/`.
6. Print the resulting size and the staged file count.

`manifest.json` lives at the repo root and is version-controlled; a test asserts its `version` matches `package.json`'s, so a release cannot ship a stale version number. `build/` is git-ignored.

The `@anthropic-ai/mcpb` CLI is added as a **devDependency**, pinned to a caret range like every other dependency.

## Documentation restructure

Both READMEs are reorganized so the reader hits the right path immediately. The two files currently have **different structures** (the English one opens with a generic "Installation"; the Spanish one interleaves Claude Desktop steps with environment variables); after this work they mirror each other section by section.

New shared structure:

1. **What it is** — pitch and feature highlights (unchanged).
2. **Install in Claude Desktop (recommended)** — the concrete path:
   - Download `actual-budget-mcp-es.mcpb` from the latest release (direct link).
   - Requirements stated up front: macOS with Apple Silicon, Claude Desktop, and a reachable self-hosted Actual Budget server.
   - Open Claude Desktop → Settings → Extensions → drag the file in → review → Install.
   - Fill the form: the three required fields plus locale/currency, with a screenshot-free but precise description of each and where to find the Sync ID.
   - Leave **Enable write tools** unchecked for the first run; how to turn it on later.
   - How to verify it works: ask Claude "what accounts do I have?" and expect a list.
   - How to update: download the new `.mcpb` and drag it in again.
3. **Manual installation (other MCP clients, Intel Macs, Windows, Linux)** — the standard procedure, essentially today's content with fixes: clone, `npm install`, `npm run build`, and the `claude_desktop_config.json` (or equivalent client config) snippet with the environment-variable table. Explicitly framed as the path for anything the bundle does not cover.
4. **Tools** — read and write tables (unchanged).
5. **Security** — unchanged, still linking `SECURITY.md`.
6. **Development** — unchanged.

Fixes folded into the same pass:

- `README.es.md` currently instructs `cd ~/GITs/Actual-MCP` — the maintainer's local development path. It becomes `cd actual-budget-mcp-es`, matching the clone.
- The English README gains the "Finding your Sync ID" steps in the Claude Desktop section, where a new user actually needs them.

`SECURITY.md` gains two sentences: the bundle ships production dependencies including a native SQLite binary, and the password is stored by the MCP client's secure storage when installed as a bundle rather than in a plaintext config file.

## Release process

Releases are cut manually (no CI in this repo, and adding it is out of scope):

1. Bump `version` in `package.json` and `manifest.json` (the test enforces they match).
2. `npm test && npm run build && npm run bundle`.
3. Install the produced `.mcpb` locally and verify (below).
4. `gh release create vX.Y.Z build/actual-budget-mcp-es.mcpb` with notes stating the platform limitation.

The README's download link points at `/releases/latest`, so it never goes stale.

## Verification

Automated, in the existing Vitest suite:

- `manifest.json` parses, and its `version` equals `package.json`'s.
- Every tool named in the manifest exists in `allTools`, and every tool in `allTools` appears in the manifest — so the advertised capability list cannot drift from the code.
- Each `user_config` entry maps to an environment variable that `loadConfig` actually reads.

Manual, on the maintainer's Mac (the real gate):

- Run `npm run bundle`; confirm the archive contains `dist/`, `node_modules` with the arm64 `.node` binary, and none of `tests/`, `docs/`, `.env`.
- Install the `.mcpb` in Claude Desktop, fill the form with the real server, restart.
- Confirm the Extensions page lists the server and its tools; confirm **8 tools** with the write checkbox off, **16** with it on.
- Ask Claude a read question and confirm real data comes back formatted in the configured currency.
- Uninstall it afterwards and confirm the existing manual `actual-budget` entry still works — the bundle must not disturb the maintainer's own setup.

## Risks

- **Bundle size (~40 MB).** Acceptable for a one-click install; the alternative (asking users to run npm) is what this spec exists to remove.
- **Native binary tied to the build machine's platform.** Mitigated by declaring `platforms: ["darwin"]` and documenting it; the manual path covers everyone else.
- **MCPB is a young format.** The manifest schema may evolve; the pinned CLI and the manifest-vs-code tests keep drift visible. If a future Claude Desktop rejects the bundle, the manual path still works — it is never removed from the docs.
