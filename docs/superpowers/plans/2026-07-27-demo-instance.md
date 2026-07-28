# Demo Instance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an isolated, internet-reachable Actual Budget demo instance, seeded with
fictional data that exercises all 29 tools, that Connectors Directory reviewers can connect to and
that doubles as the empirical-verification target for the classification write tools.

**Architecture:** Three public, secret-free TypeScript scripts in this repo — `bootstrap-demo`,
`seed-demo`, `reset-demo` — build and apply a deterministic demo dataset through `@actual-app/api`.
They are exercised by integration tests against an ephemeral `actual-server` Docker container. The
deployment (a disposable Proxmox VM running `actual-server` + a dedicated `cloudflared` tunnel,
hardened, with a daily reset timer) lives in the private `arcane-stacks` repo and is executed by
the maintainer following the runbook in Phase 3.

**Tech Stack:** TypeScript 6.x (ESM), `@actual-app/api` 26.7, Node ≥18, Vitest, Docker
(`actualbudget/actual-server`, `cloudflare/cloudflared`), Proxmox VM (Ubuntu), Cloudflare Tunnel,
systemd timer.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-27-demo-instance-design.md` governs; every acceptance
  criterion there is in scope here.
- **Public/private split:** scripts + this plan + tests in `actual-mcp` (public, secret-free);
  Docker/compose, `cloudflared` config, VM provisioning, reset timer, and the `.env` in
  `arcane-stacks` (private). Never commit secrets to the public repo.
- **Secrets only via env vars:** scripts read `ACTUAL_SERVER_URL`, `ACTUAL_SERVER_PASSWORD`,
  `ACTUAL_SYNC_ID` from the environment and **fail loudly** if any required one is missing. No
  credential is ever hardcoded or logged.
- **Stable Sync ID:** the demo budget is created **once** (bootstrap); seed and reset only empty
  and re-populate its contents. They must never recreate the budget.
- **No PII:** all seeded data is fictional — no real names, emails, or maintainer-identifying
  patterns.
- **Image pinned by digest:** `actualbudget/actual-server` is pinned by `@sha256:…`, not `latest`.
- **Money:** the seed works in integer cents (the API's native unit); no unit conversion needed
  inside the scripts.
- **`gitleaks`** must pass on the public repo; a pre-commit hook and CI job enforce it.

---

## Phase 0 — Technical spike (resolve the open questions)

Resolves spec Open Questions 1–5 against a **local ephemeral `actual-server`**, so later tasks use
confirmed API behaviour, not guesses. Deliverable: a short findings doc committed to the repo.

### Task 0.1: Ephemeral actual-server for local dev & tests

**Files:**
- Create: `test/integration/docker-compose.actual.yml`
- Create: `docs/superpowers/notes/2026-07-27-demo-spike.md`

- [ ] **Step 1: Write the compose file for a throwaway server**

```yaml
# test/integration/docker-compose.actual.yml — local only, never deployed
services:
  actual:
    image: actualbudget/actual-server:25.7.1
    ports:
      - "5006:5006"
    tmpfs:
      - /data          # ephemeral: wiped on container removal
```

- [ ] **Step 2: Start it and confirm it serves**

Run: `docker compose -f test/integration/docker-compose.actual.yml up -d && sleep 5 && curl -sf http://localhost:5006/info`
Expected: JSON with `build`/`version` fields (server is up).

- [ ] **Step 3: Spike the password bootstrap**

Determine how a fresh server sets its password. Try the bootstrap endpoint:

Run: `curl -s -X POST http://localhost:5006/account/bootstrap -H 'content-type: application/json' -d '{"password":"spike-pass"}'`
Expected: a JSON success (`{"status":"ok",...}`) or a "already bootstrapped" error. Record the
exact request/response in the findings doc, and whether an env var can preseed it instead.

- [ ] **Step 4: Spike budget creation + Sync ID retrieval**

Write a one-off script `test/integration/spike.mjs` that: `init({serverURL, password, dataDir})`,
`runImport('Demo', async () => { await api.createCategoryGroup({name:'X'}); })`, then `getBudgets()`
and print the result.

Run: `node test/integration/spike.mjs`
Expected: `getBudgets()` returns an entry with a `cloudFileId`. Record whether `cloudFileId` equals
the Settings→Advanced "Sync ID" and which value `downloadBudget()` accepts.

- [ ] **Step 5: Spike Sync-ID stability under content wipe**

In the spike script, after creating the budget, delete all its categories/payees/transactions and
`sync()`, then re-`getBudgets()`. Confirm `cloudFileId` is unchanged.
Expected: same `cloudFileId` before and after — proves reset can keep the Sync ID.

- [ ] **Step 6: Record findings and tear down**

Write answers to Open Questions 1–5 into `docs/superpowers/notes/2026-07-27-demo-spike.md`
(password bootstrap method, budget-creation call, the Sync ID value to hand to reviewers, stability
result, `ACTUAL_TRUSTED_PROXIES` note). Then:

Run: `docker compose -f test/integration/docker-compose.actual.yml down -v`

- [ ] **Step 7: Commit**

```bash
git add test/integration/docker-compose.actual.yml docs/superpowers/notes/2026-07-27-demo-spike.md
git commit -m "spike: confirm actual-server bootstrap, budget creation and Sync ID stability"
```

---

## Phase 1 — Demo dataset (pure, TDD)

The dataset is a pure, deterministic data structure — testable without any server. This isolates
the "what data" decision from the "how to apply it" I/O.

### Task 1.1: `buildDemoDataset()` shape and coverage

**Files:**
- Create: `scripts/demo/dataset.ts`
- Test: `scripts/demo/dataset.test.ts`

**Interfaces:**
- Produces: `buildDemoDataset(): DemoDataset` where
  ```ts
  export interface DemoDataset {
    accounts: { name: string; offBudget: boolean }[];
    groups: { name: string; isIncome: boolean }[];
    categories: { name: string; group: string; isIncome: boolean }[];
    payees: { name: string; transferAccount?: string }[];
    // amounts in integer cents; date is 'YYYY-MM-DD'
    transactions: {
      account: string; date: string; amount: number;
      payee?: string; category?: string | null;
      transferAccount?: string;
      splits?: { amount: number; category: string | null }[];
    }[];
    budgets: { month: string; category: string; amount: number }[]; // 'YYYY-MM'
    rules: {
      stage: 'pre' | 'post' | null;
      conditionsOp: 'and' | 'or';
      conditions: { field: string; op: string; value: unknown }[];
      actions: { field: string; op: 'set'; value: unknown }[];
    }[];
  }
  ```

- [ ] **Step 1: Write the failing test (coverage assertions)**

```ts
import { describe, it, expect } from 'vitest';
import { buildDemoDataset } from './dataset.js';

describe('buildDemoDataset', () => {
  const d = buildDemoDataset();

  it('has on-budget and off-budget accounts', () => {
    expect(d.accounts.some(a => !a.offBudget)).toBe(true);
    expect(d.accounts.some(a => a.offBudget)).toBe(true);
  });
  it('covers a transfer, a split, and an uncategorized transaction', () => {
    expect(d.transactions.some(t => t.transferAccount)).toBe(true);
    expect(d.transactions.some(t => t.splits && t.splits.length > 0)).toBe(true);
    expect(d.transactions.some(t => t.category === null)).toBe(true);
  });
  it('defines transfer payees and at least one rule', () => {
    expect(d.payees.some(p => p.transferAccount)).toBe(true);
    expect(d.rules.length).toBeGreaterThan(0);
  });
  it('references only accounts/categories it defines', () => {
    const accts = new Set(d.accounts.map(a => a.name));
    const cats = new Set(d.categories.map(c => c.name));
    for (const t of d.transactions) {
      expect(accts.has(t.account)).toBe(true);
      if (t.category) expect(cats.has(t.category)).toBe(true);
    }
  });
  it('is deterministic', () => {
    expect(buildDemoDataset()).toEqual(buildDemoDataset());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/demo/dataset.test.ts`
Expected: FAIL — `buildDemoDataset` is not defined.

- [ ] **Step 3: Implement the dataset**

Write `scripts/demo/dataset.ts` returning a hardcoded, fictional, English dataset that satisfies
every assertion: on/off-budget accounts (e.g. "Checking", "Savings", "Pension"), groups
("Income", "Housing", "Savings & Investment", "Taxes"), categories under them, payees including a
transfer payee for "Savings", several months of transactions including one categorized, one
`category: null`, one `splits: [...]`, and one `transferAccount: 'Savings'`, a couple of monthly
budgets, and one rule (`payee contains "Rent" → set category "Rent"`). All amounts in cents.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/demo/dataset.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/demo/dataset.ts scripts/demo/dataset.test.ts
git commit -m "feat(demo): deterministic demo dataset covering all tool surfaces"
```

---

## Phase 2 — Apply, bootstrap, seed, reset (integration TDD)

These tasks do I/O through `@actual-app/api`; they are tested against the ephemeral server from
Phase 0. Use the exact calls confirmed in the spike doc.

### Task 2.1: `applyDataset(api, dataset)`

**Files:**
- Create: `scripts/demo/apply.ts`
- Test: `scripts/demo/apply.integration.test.ts`

**Interfaces:**
- Consumes: `DemoDataset` from `scripts/demo/dataset.ts`.
- Produces: `applyDataset(api, dataset: DemoDataset): Promise<void>` — creates groups, categories,
  accounts, payees, transactions (resolving names to ids), budgets and rules, then `await api.sync()`.

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as api from '@actual-app/api';
import { buildDemoDataset } from './dataset.js';
import { applyDataset } from './apply.js';

// Requires the ephemeral server (Phase 0) running on :5006, password 'test-pass'.
describe('applyDataset', () => {
  beforeAll(async () => {
    await api.init({ dataDir: '/tmp/demo-apply', serverURL: 'http://localhost:5006', password: 'test-pass' });
    await api.runImport('ApplyTest', async () => {});
  }, 60_000);
  afterAll(async () => { await api.shutdown(); });

  it('creates accounts and categories from the dataset', async () => {
    await applyDataset(api, buildDemoDataset());
    const accounts = await api.getAccounts();
    expect(accounts.length).toBeGreaterThanOrEqual(3);
    const cats = await api.getCategories();
    expect(cats.length).toBeGreaterThan(0);
  }, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose -f test/integration/docker-compose.actual.yml up -d && npx vitest run scripts/demo/apply.integration.test.ts`
Expected: FAIL — `applyDataset` is not defined.

- [ ] **Step 3: Implement `applyDataset`**

Create groups → capture ids; create categories under their group ids; create accounts (via
`api.createAccount({name, offbudget})`); create payees; for each transaction resolve account/
payee/category names to ids and `api.addTransactions(accountId, [...])`, handling splits (subtransactions)
and transfers (payee = transfer payee); apply budgets via `api.setBudgetAmount(month, catId, cents)`;
create rules via `api.createRule(...)`. End with `await api.sync()`. Use only calls confirmed in the
spike doc.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/demo/apply.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/demo/apply.ts scripts/demo/apply.integration.test.ts
git commit -m "feat(demo): apply demo dataset through the Actual API"
```

### Task 2.2: Env-var config loader (fail-loud)

**Files:**
- Create: `scripts/demo/env.ts`
- Test: `scripts/demo/env.test.ts`

**Interfaces:**
- Produces: `loadDemoEnv(required: string[]): Record<string,string>` — returns the requested env
  vars, throws `Error("Missing required env var: X")` if any is absent or empty.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { loadDemoEnv } from './env.js';

describe('loadDemoEnv', () => {
  it('throws with the var name when missing', () => {
    delete process.env.ACTUAL_SYNC_ID;
    expect(() => loadDemoEnv(['ACTUAL_SYNC_ID'])).toThrow(/ACTUAL_SYNC_ID/);
  });
  it('returns present vars', () => {
    process.env.ACTUAL_SERVER_URL = 'http://x';
    expect(loadDemoEnv(['ACTUAL_SERVER_URL'])).toEqual({ ACTUAL_SERVER_URL: 'http://x' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/demo/env.test.ts`
Expected: FAIL — `loadDemoEnv` is not defined.

- [ ] **Step 3: Implement**

```ts
export function loadDemoEnv(required: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of required) {
    const v = process.env[key];
    if (!v) throw new Error(`Missing required env var: ${key}`);
    out[key] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/demo/env.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/demo/env.ts scripts/demo/env.test.ts
git commit -m "feat(demo): fail-loud env-var loader for demo scripts"
```

### Task 2.3: `bootstrap-demo` entrypoint (create the budget once)

**Files:**
- Create: `scripts/demo/bootstrap-demo.ts`
- Modify: `package.json` (add `"demo:bootstrap": "tsx scripts/demo/bootstrap-demo.ts"`)

**Interfaces:**
- Consumes: `loadDemoEnv`, `buildDemoDataset`, `applyDataset`.
- Produces: a CLI that inits against the server, `runImport('Actual MCP Demo', …)` applying the
  dataset, then prints the resulting **Sync ID** (from `getBudgets()`, per the spike) to stdout so
  the maintainer records it. Run once.

- [ ] **Step 1: Write the script**

Reads `ACTUAL_SERVER_URL`, `ACTUAL_SERVER_PASSWORD` via `loadDemoEnv`; `api.init(...)`;
`await api.runImport('Actual MCP Demo', async () => { await applyDataset(api, buildDemoDataset()); })`;
`const [file] = await api.getBudgets(); console.log('SYNC_ID=' + file.cloudFileId);`; `await api.shutdown()`.

- [ ] **Step 2: Add the npm script**

Add to `package.json` scripts: `"demo:bootstrap": "tsx scripts/demo/bootstrap-demo.ts"`.

- [ ] **Step 3: Verify against the ephemeral server**

Run: `ACTUAL_SERVER_URL=http://localhost:5006 ACTUAL_SERVER_PASSWORD=test-pass npm run demo:bootstrap`
Expected: prints `SYNC_ID=<value>`; `getBudgets` shows the "Actual MCP Demo" budget populated.

- [ ] **Step 4: Commit**

```bash
git add scripts/demo/bootstrap-demo.ts package.json
git commit -m "feat(demo): bootstrap-demo creates the demo budget and prints its Sync ID"
```

### Task 2.4: `reset-demo` and `seed-demo` entrypoints (idempotent, Sync-ID-stable)

**Files:**
- Create: `scripts/demo/reset-demo.ts`
- Create: `scripts/demo/seed-demo.ts`
- Create: `scripts/demo/wipe.ts`
- Test: `scripts/demo/reset.integration.test.ts`
- Modify: `package.json` (`"demo:reset"`, `"demo:seed"`)

**Interfaces:**
- Consumes: `loadDemoEnv`, `downloadBudget`, `buildDemoDataset`, `applyDataset`.
- Produces:
  - `wipeBudgetContents(api): Promise<void>` — deletes all transactions, rules, categories, groups
    and non-transfer payees of the currently loaded budget (never touches the budget file itself).
  - `seed-demo` CLI: downloads `ACTUAL_SYNC_ID`, applies the dataset (assumes empty budget).
  - `reset-demo` CLI: downloads `ACTUAL_SYNC_ID`, `wipeBudgetContents`, applies the dataset, `sync()`.

- [ ] **Step 1: Write the failing integration test (Sync ID stability)**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as api from '@actual-app/api';
import { wipeBudgetContents } from './wipe.js';
import { applyDataset } from './apply.js';
import { buildDemoDataset } from './dataset.js';

describe('reset keeps Sync ID stable', () => {
  let syncId: string;
  beforeAll(async () => {
    await api.init({ dataDir: '/tmp/demo-reset', serverURL: 'http://localhost:5006', password: 'test-pass' });
    await api.runImport('ResetTest', async () => { await applyDataset(api, buildDemoDataset()); });
    syncId = (await api.getBudgets())[0].cloudFileId;
  }, 90_000);
  afterAll(async () => { await api.shutdown(); });

  it('same Sync ID after wipe + re-apply', async () => {
    await wipeBudgetContents(api);
    await applyDataset(api, buildDemoDataset());
    await api.sync();
    expect((await api.getBudgets())[0].cloudFileId).toBe(syncId);
    expect((await api.getAccounts()).length).toBeGreaterThanOrEqual(3);
  }, 90_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/demo/reset.integration.test.ts`
Expected: FAIL — `wipeBudgetContents` is not defined.

- [ ] **Step 3: Implement `wipe.ts`, `reset-demo.ts`, `seed-demo.ts`**

`wipeBudgetContents`: `getRules`→`deleteRule` each; delete all transactions (query ids →
`deleteTransaction`); `getCategories`→`deleteCategory`; `getCategoryGroups`→`deleteCategoryGroup`;
`getPayees`→`deletePayee` for non-transfer payees. `reset-demo`/`seed-demo`: `loadDemoEnv([...,'ACTUAL_SYNC_ID'])`,
`api.init(...)`, `api.downloadBudget(syncId)`, then (reset) wipe + apply, (seed) apply; `api.sync()`;
`api.shutdown()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/demo/reset.integration.test.ts`
Expected: PASS — Sync ID unchanged, data present.

- [ ] **Step 5: Add npm scripts and commit**

```bash
git add scripts/demo/wipe.ts scripts/demo/reset-demo.ts scripts/demo/seed-demo.ts scripts/demo/reset.integration.test.ts package.json
git commit -m "feat(demo): idempotent reset/seed that preserve the Sync ID"
```

### Task 2.5: gitleaks guard in CI

**Files:**
- Create: `.github/workflows/gitleaks.yml`
- Create: `.gitleaks.toml` (allowlist for the fixture password `test-pass` only)

- [ ] **Step 1: Add the workflow**

```yaml
name: gitleaks
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
```

- [ ] **Step 2: Verify locally**

Run: `docker run --rm -v "$PWD:/x" zricethezav/gitleaks:latest detect --source=/x --no-git`
Expected: `no leaks found` (the only literal secret is the test fixture, allowlisted).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/gitleaks.yml .gitleaks.toml
git commit -m "ci: gitleaks secret scanning on the public repo"
```

---

## Phase 3 — Deployment (private, maintainer-executed runbook)

These artifacts live in `arcane-stacks` (private) and are applied by the maintainer on the demo VM.
They are configuration + verification, not TDD. Reference configs below are complete; adapt
hostnames/domain to the maintainer's Cloudflare zone.

### Task 3.1: Provision the disposable VM

- [ ] **Step 1:** Create an Ubuntu VM in home Proxmox, isolated from LAN devices and all Taiko
  infra (own VLAN/segment; no route to Home Assistant or production).
- [ ] **Step 2:** Install Docker + compose plugin. Join **Tailscale**; disable public SSH (admin
  over Tailscale only). Set UFW default-deny inbound.
- [ ] **Step 3: Verify** — `tailscale status` shows the VM; `ss -tlnp` shows no public SSH; `docker
  version` works.

### Task 3.2: actual-server + cloudflared compose (hardened)

**Files (private repo):** `actual-demo/docker-compose.yml`, `actual-demo/cloudflared/config.yml`,
`actual-demo/.env` (untracked).

- [ ] **Step 1: Write the hardened compose**

```yaml
services:
  actual:
    image: actualbudget/actual-server@sha256:<pin-from-spike>   # digest, not a tag
    restart: unless-stopped
    environment:
      ACTUAL_ALLOWED_LOGIN_METHODS: password
      ACTUAL_TRUSTED_PROXIES: 172.16.0.0/12   # value from spike; cloudflared network
    volumes:
      - actual-data:/data
    networks: [internal]
    read_only: true
    tmpfs: [/tmp]
    security_opt: ["no-new-privileges:true"]
    cap_drop: ["ALL"]
    pids_limit: 200
    mem_limit: 512m
    # no ports: — never published on the host
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}   # from .env, injected; not in git
    networks: [internal]
    depends_on: [actual]
volumes: { actual-data: {} }
networks: { internal: { internal: false } }
```

- [ ] **Step 2:** Create the **dedicated** tunnel in Cloudflare Zero Trust (name `actual-demo`),
  its own credentials — **not** the Home Assistant tunnel. Ingress: `actual-demo.<domain> →
  http://actual:5006`, catch-all `404`. Route DNS: `cloudflared tunnel route dns actual-demo actual-demo.<domain>`.
- [ ] **Step 3:** Put `TUNNEL_TOKEN` and the Actual password in `actual-demo/.env` (untracked;
  `.gitignore` covers it).
- [ ] **Step 4: Bring it up** — `docker compose up -d`.
- [ ] **Step 5: Bootstrap the server password** using the method confirmed in the spike (endpoint
  POST or env preseed).
- [ ] **Step 6: Verify** — `curl -sf https://actual-demo.<domain>/info` returns JSON over HTTPS;
  the port 5006 is **not** reachable on the VM host (`curl http://localhost:5006/info` from the VM
  host fails); Cloudflare rate-limiting rule is active on the hostname.

### Task 3.3: Bootstrap the demo budget and record the Sync ID

- [ ] **Step 1:** From a trusted machine (over Tailscale or via the public URL), run the public
  script against the demo server:
  `ACTUAL_SERVER_URL=https://actual-demo.<domain> ACTUAL_SERVER_PASSWORD=<demo-pass> npm run demo:bootstrap`
- [ ] **Step 2:** Record the printed `SYNC_ID=…` into the private reviewer-credential note in
  `arcane-stacks` (not the public repo).
- [ ] **Step 3: Verify** — the budget appears populated via a read tool or the Actual web UI.

### Task 3.4: Daily reset timer

**Files (private repo):** `actual-demo/reset.service`, `actual-demo/reset.timer`.

- [ ] **Step 1:** Write a systemd service that runs
  `ACTUAL_SERVER_URL=… ACTUAL_SERVER_PASSWORD=… ACTUAL_SYNC_ID=… npm run demo:reset` (env from a
  root-only env file), and a timer firing daily at ~04:00.
- [ ] **Step 2:** `systemctl enable --now actual-demo-reset.timer`.
- [ ] **Step 3: Verify** — `systemctl start actual-demo-reset.service` runs clean; after a manual
  write to the demo, the reset restores the seed and the **Sync ID is unchanged**.

---

## Phase 4 — End-to-end & submission readiness

### Task 4.1: Reviewer end-to-end check

- [ ] **Step 1:** In Claude Desktop (or MCP Inspector), install the `.mcpb` and configure it with
  the three demo credentials, **write enabled**.
- [ ] **Step 2: Verify** — read tools return the seeded data; a representative write tool from each
  phase (e.g. `create_category`, `set_transaction_transfer`, `create_rule`) succeeds against the demo.
- [ ] **Step 3:** Draft the *Test & launch* text (URL, password, Sync ID, "enable write" note) into
  the private submission note.

### Task 4.2: Security acceptance checklist (from the spec)

- [ ] VM isolated; admin over Tailscale; UFW default-deny; only egress is the tunnel.
- [ ] Container: non-root, `cap_drop: ALL`, `no-new-privileges`, read-only rootfs, no `docker.sock`,
  resource limits, volume quota.
- [ ] Cloudflare rate-limiting + WAF active on the hostname; `header` auth disabled.
- [ ] Demo password long/unique/from manager; rotation planned at review end.
- [ ] Image pinned by digest; `npm audit` clean for the scripts.
- [ ] Seed contains no PII; `gitleaks` clean on the public repo.
- [ ] Exposure-window plan: instance up only during review/verification; teardown documented.
- [ ] Run `/security-review` over the scripts and the (private) deployment config before go-live.

---

## Self-Review

**Spec coverage:** VM+Cloudflare Tunnel architecture (3.1–3.2), dedicated tunnel / no-HA / no
port conflict (3.2), seed covering all tools (1.1, 2.1), stable-Sync-ID reset (2.4), daily timer
(3.4), public/private split (Phases 1–2 vs 3), reviewer credentials (3.3, 4.1), threat model &
dev protocols (2.2, 2.5, 4.2), and the five open questions (Phase 0) each map to a task.

**Placeholders:** the `<pin-from-spike>`, `ACTUAL_TRUSTED_PROXIES` value, password-bootstrap
method, and `<domain>` are intentionally resolved by Phase 0 / owned by the maintainer's private
config — not code placeholders. All script tasks carry complete code.

**Type consistency:** `DemoDataset` (1.1) is consumed unchanged by `applyDataset` (2.1),
`bootstrap-demo` (2.3), `seed`/`reset` (2.4); `loadDemoEnv` (2.2) and `wipeBudgetContents` (2.4)
signatures are used consistently by their callers.
