# Demo instance for the Connectors Directory — Design Spec

**Date:** 2026-07-27
**Status:** Approved by the maintainer (design review)
**Language note:** Spec in English (publication-ready), like the other design specs. Contains no
IPs, secrets or internal infrastructure detail — those live in the private infra repo.

## Overview

This server is distributed as a Claude Desktop extension (`.mcpb`). To list it in Anthropic's
Connectors Directory, a reviewer must be able to exercise every tool end to end. The extension
is a *local* MCP server that talks to a self-hosted Actual Budget instance, so the reviewer has
nothing to connect to unless we provide one: an internet-reachable Actual server, pre-populated
with realistic fake data, whose credentials we hand over in the submission.

This spec covers standing up that **demo instance** as an **isolated, disposable container** on a
Linux VM in the maintainer's home lab, exposed through a **Cloudflare Tunnel** — no open ports, no
home IP exposure, and Cloudflare terminates TLS and provides the rate limiting Actual itself lacks. It
also covers a versioned seed that fills a single budget with data exercising all 29 tools, and a
reset that returns it to a clean state daily without changing the budget's Sync ID.

It is a **sibling** of the classification-write-tools spec; the two are developed separately but
the demo is also the empirical-verification target for those tools.

### Why a demo is required

Anthropic's submission guidance asks, in the *Test & launch* step, for "test-account setup and
access instructions detailed enough for a reviewer to access your server end to end: every link,
credential, and step, including credentials for a fully populated account where relevant."
Desktop extensions (MCPB) submit through a separate
[form](https://clau.de/desktop-extention-submission) rather than the remote-server portal, but
the reviewer still needs live credentials to a populated Actual instance to run the tools.

Sources:
- [Submitting to the Connectors Directory — Claude Docs](https://claude.com/docs/connectors/building/submission)
- [Anthropic MCP directory policy](https://support.anthropic.com/en/articles/11697096-anthropic-mcp-directory-policy)
- [Actual Budget — Server configuration](https://actualbudget.org/docs/config/)

### Goals

- A publicly reachable HTTPS Actual server, running as an **isolated disposable container** whose
  network reach is cut off at the host, so a compromise cannot reach any valuable asset (household
  data, client hosting, or the critical infra host).
- A **versioned, reproducible seed** that populates a single budget with realistic fake data
  (English, neutral currency) covering every tool the extension exposes.
- A **daily reset** that wipes and re-seeds the budget's contents while keeping its **Sync ID
  stable**, so the credentials handed to the reviewer never change.
- A clean **public/private split**: seed and reset scripts ship in the public repo; deployment
  detail and secrets stay in the private infra repo.
- Security treated as **acceptance criteria**, not an afterthought (see Threat model).
- Doubles as the **empirical-verification environment** for the classification write tools, so
  verification never touches real household data.

### Non-goals

- **High availability and backups.** The instance is disposable and fully reproducible from the
  seed; no HA, no backup strategy.
- **Multiple budgets.** One demo budget only.
- **OAuth.** Actual authenticates with a server password, already supported by the extension.
  The directory's OAuth requirement applies to authenticated *remote* services; a local
  extension with a user-supplied server password is out of that scope.
- **Co-hosting with any valuable or third-party asset.** Explicitly rejected: not on the shared
  hosting servers (they serve client sites) and not on the critical-infra VPS (monitoring, mesh
  network). A password-shared, publicly-writable service must not share a kernel with those. It
  does share a host with unrelated *personal* services — see "Host" below for why, and for the
  container- and network-level isolation that compensates.

## Architecture

- **Host:** a hardened, disposable **container stack** on a Linux VM in the maintainer's home lab.
  The original design called for a VM dedicated to the demo and nothing else; it was consolidated
  onto an existing personal VM (which also runs an unrelated media stack) rather than maintaining a
  second VM for one container. This is a **deliberate trade-off**: the blast radius of a container
  escape is no longer "an empty disposable VM" but that VM's other services. It is compensated by
  moving the isolation from the VM boundary to the **container and network boundary** (see Threat
  model §1), not by dropping it. The stack stays rebuildable from scratch, and nothing valuable to
  third parties runs on that host.
- **Exposure:** a **dedicated Cloudflare Tunnel** (`cloudflared`, outbound-only) running **in the
  same stack**, with its **own tunnel credentials** — **not** the Home Assistant tunnel. It publishes
  a **new** HTTPS hostname (for example `actual-demo.<maintainer-domain>`), distinct from the
  hostname production already uses. The Cloudflare **zone (domain) is reused**; the tunnel and its
  credentials are not. No inbound ports are opened on the home router and the home IP is never
  exposed. Cloudflare terminates TLS.
- **Edge protection:** Cloudflare provides **rate limiting** and managed WAF/DDoS in front of
  the login — the layer Actual does not have natively. Actual's `ACTUAL_TRUSTED_PROXIES` is set
  so the app sees the real client IP through the tunnel.
- **Container:** `actualbudget/actual-server` pinned **by digest** (not `latest`, not just a
  tag), on its **own Docker network**, not attached to any other stack on the VM. Actual's port
  (5006) is reachable only by the `cloudflared` container, never published on the VM host.
- **Persistence:** a named volume holds Actual's `/data` (budgets and files) so a restart keeps
  the demo budget and its Sync ID. A disk quota bounds it.
- **Auth:** `ACTUAL_ALLOWED_LOGIN_METHODS` restricted to `password`; a demo-only password (see
  Threat model) injected as an environment variable.

### Coexistence with the production Actual instance

A production Actual instance is already exposed through the Home Assistant Cloudflare Tunnel. The
demo does not conflict with it because they are separated on every plane:

- **Separate host.** Production runs on its existing host; the demo runs on a different one. Port
  5006 is per-host, so the two never see each other.
- **Port not published.** Actual's 5006 exists only on the stack's internal Docker network,
  reachable by `cloudflared` alone — never bound on the VM host or the home LAN, so it cannot
  clash with anything.
- **Separate tunnel and hostname.** The demo uses a new tunnel with its own credentials and a new
  hostname; production's tunnel and hostname are untouched. (A hostname belongs to exactly one
  tunnel — using a distinct subdomain is the one manual rule to respect.)
- **Separate server and data.** The demo is an independent Actual instance and budget with its own
  Sync ID; it shares nothing with the production budget.

Were the demo ever forced onto the same host as production (it is not, by design), the fix would be
remapping its published port — unnecessary here because 5006 stays internal to the stack's network.

## Threat model & security (acceptance criteria)

Exposing the server changes everything relative to running it on `localhost`: it will be scanned
continuously, its password is shared with strangers (reviewers), and writes are enabled. Actual's
own security model is a **single shared password with no rate limiting and no hostile-multi-tenant
isolation** — so defense lives in the layers around it. These are acceptance criteria for the
implementation plan, in priority order.

**1. Host & network isolation (highest priority).**
Because the demo shares a VM with unrelated personal services (see "Host"), this is where the
dedicated-VM guarantee is reconstructed. It is the load-bearing control of the whole design.
- The demo container has **no route to the local network**, enforced by explicit `DROP` rules in
  the host's `DOCKER-USER` iptables chain (the extension point Docker honours and does not
  overwrite). Its only permitted egress is the internet, which is all `cloudflared` needs.
- **Verified, not assumed:** before the demo is declared operational, a reachability probe from
  inside the container to a local-network host must **fail**. This is a release gate.
- Its own Docker network, not attached to any other stack on the VM.
- Admin access to the VM over the local network; **no public SSH port**.
- VM firewall default-deny inbound; the only ingress path is the outbound Cloudflare Tunnel.

**2. Container hardening.**
- Non-root user, `cap_drop: ALL`, `no-new-privileges: true`, read-only rootfs with `tmpfs` for
  writable paths, `docker.sock` never mounted, `mem`/`cpu`/`pids` limits, disk quota on the
  volume. Dedicated Docker network with no route to anything else.

**3. Edge (Cloudflare).**
- Rate limiting on the login path; managed WAF/DDoS enabled. HSTS and modern TLS via Cloudflare.

**4. Credentials.**
- Demo-only password: long, unique, from a password manager, **rotated when the review ends**.
  Never a reused password. `header` auth disabled.

**5. Image & dependencies.**
- Image pinned by digest and scanned (Trivy/Grype); patch process follows Actual security
  advisories. `npm audit` + lockfile for the seed/reset scripts.

**6. Data.**
- 100% fictional: no PII, no real names/emails, no patterns that reveal anything about the
  maintainer. If the budget leaked, it would reveal nothing real.

**7. Minimize the exposure window.**
- The instance is up only during the review window and verification runs, then shut down. A
  clean teardown plan exists.

**8. Monitoring & response.**
- Cloudflare analytics for brute-force/anomalous traffic; VM resource alerts; a documented
  response step (rotate password / take the tunnel down).

## Security protocols in development

Institutionalized in the workflow, not left to vigilance:

- **Secrets out of git, enforced by tooling:** the `.env` (Actual password) lives only in the
  private infra repo; strict `.gitignore`; **`gitleaks` as a pre-commit hook and in CI**. (A
  prior leak already forced a `git filter-repo` history rewrite — this makes it fail-closed.)
- Seed/reset scripts read credentials **only from environment variables**, never hardcoded, and
  **fail loudly** if any are missing.
- **Anti-PII review** of the seed content before commit.
- **`npm audit`** on the seed/reset scripts in CI.
- A short **demo security runbook** (rotate password, shut down/tear down, what to watch) in the
  private infra repo.
- Run the **`/security-review`** skill over the scripts and deployment config before deploying.

## Seed

`scripts/seed-demo.ts` in the public repo, using `@actual-app/api`. It populates the demo budget
with realistic, entirely fake data, in **English** and a neutral currency, chosen to exercise
**all 29 tools**:

- On-budget and off-budget accounts (so net-worth and transfer tools have material).
- Category groups and categories, including ones safe to rename, move, hide and delete.
- Payees, including **transfer payees** for the transfer tools.
- Several months of transactions: categorized, uncategorized, split, and at least one pair that
  forms a transfer between two accounts.
- Monthly budget amounts, so budget reads and `set_budget`/`transfer_budget` have context.
- One or two example rules (e.g. `payee contains … → set category`).

The same data set is the known baseline for the write-tools' empirical verification.

## Reset — stable Sync ID is the constraint

`scripts/reset-demo.ts` in the public repo. It **empties and re-populates the contents** of the
existing demo budget and re-runs the seed. It must **not** recreate the budget: the **Sync ID is
handed to the reviewer and recorded in the submission**, so it must stay constant — recreating
the budget would mint a new Sync ID and break the submitted credentials. Idempotent.

A **daily cron/systemd timer** on the VM (defined in the private infra repo) runs the reset in
the early morning, so a reviewer arriving any day sees clean data. The same script runs on demand
before submitting, or to get a known state for verifying the write tools.

## Artifact split (public / private)

| Artifact | Repo | Notes |
|---|---|---|
| `scripts/seed-demo.ts`, `scripts/reset-demo.ts` | `actual-mcp` (public) | Generic, secret-free. |
| This spec | `actual-mcp` (public) | No IPs or secrets. |
| `docker-compose.yml`, `cloudflared` tunnel config, VM provisioning, reset timer | `arcane-stacks` (private) | Deployment detail. |
| `.env` with the demo server password; the reviewer credential note | `arcane-stacks` (private) | Never committed to the public repo. |

## Reviewer credentials (Test & launch)

The submission form's *Test & launch* step receives:

- `ACTUAL_SERVER_URL` — the Cloudflare Tunnel HTTPS hostname.
- `ACTUAL_SERVER_PASSWORD` — the demo-only server password.
- `ACTUAL_SYNC_ID` — the stable demo budget Sync ID.
- Instructions to **enable the write checkbox** when installing the `.mcpb`, so the reviewer can
  exercise the write tools (with write off, only the 11 read tools are visible).

These three values are **not committed to the public repo**; they live in the submission form and
in private notes in `arcane-stacks`.

## Relationship to the classification write-tools spec

This demo is the intended empirical-verification target for the sibling spec's write tools. It
must be operational **before the Phase 1 verification** of that plan. The seed defines the known
state against which transfers and rules are verified; the daily reset cleans up whatever those
tests (and reviewers) leave behind.

## Open questions (resolved during implementation)

1. Can `@actual-app/api` **create** a budget from scratch, or must the budget be created once by
   hand (capturing its Sync ID) and the seed only populate it?
2. Confirm the reset **preserves the Sync ID** (empty contents, never recreate the budget).
3. Can the Actual server **password be preconfigured** via environment variable, or is it set on
   first boot through the UI?
4. `ACTUAL_TRUSTED_PROXIES` value needed so Actual sees the real client IP through Cloudflare +
   the tunnel (for correct rate limiting and logs).
5. How the reset job runs on the VM: a small Node container executing the repo's script, or the
   script deployed to the VM and run by the timer.

## Verification of this spec's outcome

- An external client (MCP Inspector or the extension itself) connects with the three credentials
  and sees populated data across read and write tools.
- After a reset, the Sync ID is unchanged and the data matches the seed baseline.
- The Actual port is not reachable except through the tunnel; the home IP is not exposed; SSH is
  not publicly reachable.
- The demo container cannot reach the local network (probe from inside the container fails).
- `gitleaks` finds no secrets in the public repo; the seed contains no PII.
