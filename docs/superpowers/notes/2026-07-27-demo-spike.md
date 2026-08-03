# Task 0.1 spike — ephemeral actual-server findings

Date: 2026-07-27/28. Investigation only; no demo scripts written yet. Server run locally in
Docker and torn down (`down -v`) at the end. Files: `test/integration/docker-compose.actual.yml`,
`test/integration/spike.mjs` (throwaway probe, not part of the test suite).

## Pinned image

Docker Hub only lists two semantic-version tags for `actualbudget/actual-server` (the rest are
`nightly`/`edge`/`sha-*`): `26.7.0` and `26.6.0`. Picked **`26.7.0`** because it matches the
installed `@actual-app/api` version (26.7.0) exactly, minimizing client/server protocol drift.

```
$ docker pull actualbudget/actual-server:26.7.0
...
Status: Downloaded newer image for actualbudget/actual-server:26.7.0

$ docker inspect --format '{{index .RepoDigests 0}}' actualbudget/actual-server:26.7.0
actualbudget/actual-server@sha256:e18b7fbfec6157a368fad4146563f397502e9da70a120aeaeac63b4977405d1c
```

Phase 3 deployment should pin by this digest:
`actualbudget/actual-server@sha256:e18b7fbfec6157a368fad4146563f397502e9da70a120aeaeac63b4977405d1c`

## Step 2 — server serves

```
$ docker compose -f test/integration/docker-compose.actual.yml up -d && sleep 5 && curl -sf http://localhost:5006/info
{"build":{"name":"@actual-app/sync-server","description":"actual syncing server","version":"26.7.0"}}
```

## OQ1 — Can `@actual-app/api` create a budget from scratch?

**Yes.** Exact call sequence (see `test/integration/spike.mjs`, `create` mode):

```js
await api.init({ dataDir, serverURL: 'http://localhost:5006', password: 'spike-pass' });
await api.runImport('Demo', async () => {
  await api.createCategoryGroup({ name: 'X', is_income: false });
});
```

`runImport` creates a local budget file AND uploads it to the server automatically — no separate
upload call is needed. Confirmed by `getBudgets()` immediately after returning a second entry with
`"state": "remote"` for the same budget (see OQ2 output below). No manual `sync()` was required to
get it onto the server; `runImport`'s upload is what put it there.

## OQ2 — Which field is the stable Sync ID, and does content-wipe preserve it?

**`groupId` is the Sync ID that `downloadBudget()` accepts and that Settings → Advanced → "Sync ID"
shows in the UI. `cloudFileId` is a different, internal id and is explicitly rejected.**

Evidence, in order:

1. **Source code** (`@actual-app/api` dist, function `handlers["api/download-budget"]`, and the
   equivalent in `@actual-app/core`'s `budgetfiles/app.ts`):
   ```js
   handlers$1["api/download-budget"] = async function({ syncId, password }) {
     ...
     const localBudget = (await handlers$1["get-budgets"]()).find((b) => b.groupId === syncId);
     ...
     const file = files.find((f) => f.groupId === syncId);
     if (!file) throw new Error(`Budget "${syncId}" not found. Check the sync id of your budget in the Advanced section of the settings page.`);
   ```
   The error message text ("Check the sync id of your budget in the Advanced section of the
   settings page") is the same string a user sees in the app, confirming `groupId` maps to the
   UI's "Sync ID" field.

2. **`getBudgets()` output** after `runImport('Demo', ...)` — both entries carry the two distinct
   ids side by side:
   ```json
   [
     { "id": "Demo-5f84446", "cloudFileId": "575da611-b7c4-4860-a53a-da27198cf894",
       "groupId": "3af3bc67-9e9e-4087-9341-4b26d274f4c9", "name": "Demo" },
     { "cloudFileId": "575da611-b7c4-4860-a53a-da27198cf894", "state": "remote",
       "groupId": "3af3bc67-9e9e-4087-9341-4b26d274f4c9", "name": "Demo",
       "encryptKeyId": null, "hasKey": false,
       "owner": "42430ce5-8a8e-4f51-802a-b91140377346", "usersWithAccess": [ ... ] }
   ]
   ```

3. **Empirical confirmation** — a second process (`node test/integration/spike.mjs download <id>`)
   against a clean `dataDir`:
   - `downloadBudget("3af3bc67-9e9e-4087-9341-4b26d274f4c9")` (the `groupId`) →
     `SUCCESS: downloadBudget resolved without throwing.` and the downloaded budget's category
     groups included the `"X"` group created in Step 4, proving it pulled the real budget.
   - `downloadBudget("575da611-b7c4-4860-a53a-da27198cf894")` (the `cloudFileId`) →
     `FAILED: Budget "575da611-b7c4-4860-a53a-da27198cf894" not found. Check the sync id of your
     budget in the Advanced section of the settings page.`

4. **Content-wipe stability** (Step 5) — deleted all categories and non-transfer payees, called
   `api.sync()`, then re-ran `getBudgets()`:
   ```
   cloudFileId before: 575da611-b7c4-4860-a53a-da27198cf894 after: 575da611-b7c4-4860-a53a-da27198cf894 stable: true
   groupId    before: 3af3bc67-9e9e-4087-9341-4b26d274f4c9 after: 3af3bc67-9e9e-4087-9341-4b26d274f4c9 stable: true
   ```
   Both ids were unchanged, but since `groupId` is the one `downloadBudget()`/the UI actually use,
   **`groupId` is the id to hand reviewers, and content-wipe-then-recreate keeps it stable** — the
   core constraint for the whole demo.

## OQ3 — Password bootstrap: HTTP endpoint vs env var

**HTTP endpoint only. There is no env var that preseeds the password.**

```
$ curl -s http://localhost:5006/account/needs-bootstrap
{"status":"ok","data":{"bootstrapped":false,"loginMethod":"password","availableLoginMethods":[],"multiuser":false}}

$ curl -s -X POST http://localhost:5006/account/bootstrap -H 'content-type: application/json' -d '{"password":"spike-pass"}'
{"status":"ok","data":{"token":"<session-token>"}}

$ curl -s -X POST http://localhost:5006/account/bootstrap -H 'content-type: application/json' -d '{"password":"spike-pass-2"}'
{"status":"error","reason":"already-bootstrapped"}

$ curl -s http://localhost:5006/account/needs-bootstrap
{"status":"ok","data":{"bootstrapped":true,"loginMethod":"password","availableLoginMethods":[{"method":"password","active":1,"displayName":"Password"}],"multiuser":false}}
```

To be thorough, the full list of `ACTUAL_*` env vars the server's convict config schema
recognizes was extracted directly from the running container
(`grep -o "ACTUAL_[A-Z_]*" /app/chunks/load-config-*.js | sort -u`):

```
ACTUAL_ALLOWED_LOGIN_METHODS, ACTUAL_CONFIG_PATH, ACTUAL_CORS_PROXY_ENABLED, ACTUAL_DATA_DIR,
ACTUAL_GITHUB_TOKEN, ACTUAL_HOSTNAME, ACTUAL_HTTPS_CERT, ACTUAL_HTTPS_KEY, ACTUAL_LOGIN_METHOD,
ACTUAL_OPENID_AUTHORIZATION_ENDPOINT, ACTUAL_OPENID_AUTH_METHOD, ACTUAL_OPENID_CLIENT_ID,
ACTUAL_OPENID_CLIENT_SECRET, ACTUAL_OPENID_DISCOVERY_URL, ACTUAL_OPENID_ENFORCE,
ACTUAL_OPENID_PROVIDER_NAME, ACTUAL_OPENID_SERVER_HOSTNAME, ACTUAL_OPENID_TOKEN_ENDPOINT,
ACTUAL_OPENID_USERINFO_ENDPOINT, ACTUAL_PORT, ACTUAL_SERVER_FILES, ACTUAL_TOKEN_EXPIRATION,
ACTUAL_TRUSTED_AUTH_PROXIES, ACTUAL_TRUSTED_PROXIES, ACTUAL_UPLOAD_FILE_SIZE_LIMIT_MB,
ACTUAL_UPLOAD_FILE_SYNC_SIZE_LIMIT_MB, ACTUAL_UPLOAD_SYNC_ENCRYPTED_FILE_SYNC_SIZE_LIMIT_MB,
ACTUAL_USER_CREATION_MODE, ACTUAL_USER_FILES, ACTUAL_WEB_ROOT
```

None of these set a password. **Mechanism for the demo:** on first boot, call
`POST /account/bootstrap {password}` once; treat a `"reason":"already-bootstrapped"` response as
success (idempotent-safe for a reset/init script that may run against an already-bootstrapped
server).

## OQ4 — `ACTUAL_TRUSTED_PROXIES`

Extracted from the server's config schema (`/app/chunks/load-config-*.js` inside the container):

```js
trustedProxies: {
  doc: "List of trusted proxies.",
  format: Array,
  default: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7", "::1/128"],
  env: "ACTUAL_TRUSTED_PROXIES"
}
```

It feeds directly into Express: `app.set("trust proxy", configSchema.get("trustedProxies"))`
(`@actual-app/sync-server/build/chunks/app-*.js`). This is the standard Express `trust proxy`
setting, which controls whether/how `req.ip` is derived from `X-Forwarded-For`.

**Format**: convict's built-in `Array` format coerces env-var strings by `v.split(',')`
(confirmed in `node_modules/convict/src/main.js`, the `coerce()` function, case `'array'`). So the
env var is a **comma-separated list** of IPs/CIDRs, e.g.
`ACTUAL_TRUSTED_PROXIES=203.0.113.5,203.0.113.0/24` — not JSON, and not the bare string `"true"`
(Express's array-based trust-proxy compiler expects real IP/CIDR entries, not the boolean keyword,
when given as an array).

**Recommendation for the demo VM**: the default list (`10.0.0.0/8`, `172.16.0.0/12`,
`192.168.0.0/16`, plus loopback/`fc00::/7`) already covers typical Docker Compose bridge networks
— Docker's default bridge (`172.17.0.0/16`) and Compose's usual auto-assigned subnets
(`172.18.0.0/16`–`172.31.0.0/16`) fall inside `172.16.0.0/12`. So if the reverse proxy/tunnel
(e.g. Caddy/Nginx/cloudflared) runs as a **sibling container on the same Compose network**, no
override is needed — Actual will already trust its `X-Forwarded-For` and see the real client IP.
An override is only needed if the proxy reaches actual-server from an address outside those
ranges (e.g. host networking mode, or an external load balancer with a public source IP) — in
that case, set `ACTUAL_TRUSTED_PROXIES` to a comma-separated list naming that specific proxy
IP/CIDR. This was verified against source/docs only; no actual reverse proxy was run in this spike
(out of scope per the brief).

## OQ5 — how should the reset job run on the VM?

**Recommendation: a small dedicated Node container, not a bare host script.**

Reasoning:
- The reset job needs `@actual-app/api` — the same package version this spike just validated
  end-to-end (bootstrap, budget creation, Sync-ID stability). Running it in a container pins that
  exact dependency and Node version, avoiding drift from whatever Node happens to be on the host.
- The rest of the deployment (Phase 3) is already Docker-based (actual-server itself runs in a
  container). Keeping the reset job in Docker too means one deployment paradigm, one place to
  manage secrets (server password as a container env var, not a host dotfile), and one `docker
  compose` surface for the whole stack.
- The job is small and stateless (wipe categories/payees/accounts/transactions, recreate seed
  data, `sync()`) — the isolation cost of a container is low, and the reproducibility/portability
  benefit (works identically on any VM with Docker, matches what was tested here) is high.
- Scheduling: either an in-container cron (e.g. `supercronic`) inside a long-running sidecar, or a
  host `cron` entry that does `docker compose run --rm reset` on a schedule — the latter keeps the
  host crontab as the single source of truth for *when*, while the container remains the single
  source of truth for *how*.

No implementation was written for this — this is a reasoned recommendation only, as scoped by the
brief.

## Step 6 — teardown

```
$ docker compose -f test/integration/docker-compose.actual.yml down -v
 Container integration-actual-1  Stopped
 Container integration-actual-1  Removed
 Network integration_default  Removed
```

Container and its `tmpfs` `/data` are gone; nothing persisted.
