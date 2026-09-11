# Upgrade and rollback

Scripted by `scripts/arcanium-upgrade.sh` (one subcommand per procedure
step, so any step can be run and re-run independently). This document is
the procedure; the execution log at the bottom is a real run of it, not a
description of one — Prompt 24's "prove it, don't assert it" standard
applies to upgrades exactly as it applies to restore drills.

## Compatibility matrix

`scripts/arcanium-upgrade.sh preflight` prints this live from the repo's
own source of truth (compose files, Containerfiles, `package.json`,
`arcanium/api/src/migrations/`) rather than a hand-maintained table that
drifts:

```text
Arcanium         <VERSION file>
Vault            <compose/vault/compose.yaml image tag>
Postgres         <compose/infra/compose.yaml image tag>
Node             <arcanium/api/Containerfile base image tag>
Nuxt             <arcanium/ui/package.json dependency>
Schema (latest)  <highest-numbered file in arcanium/api/src/migrations/>
```

Known-supported ranges for this repo, as of Prompt 24:

| Component | Supported |
| --- | --- |
| Vault | `2.1.0-ent` (the exact Enterprise build this stack is pinned to — Raft + Transit auto-unseal + the DR/PR replication used elsewhere in this repo are all version-sensitive) |
| Postgres | `16-alpine` |
| Node | `24` (both `node:24-alpine` for the API and `node:24-slim` for the UI) |
| Nuxt | `^4.5.0` |

`VERSION` at the repo root is the single canonical "Arcanium version"
marker. `arcanium-upgrade.sh deploy`/`rollback` keep it and both
`package.json` `version` fields in lockstep — the API's is the one `GET
/health` actually reports, which is what makes the `health` step below
able to verify a deploy actually took effect (not just "the container
restarted").

## Procedure

```text
preflight  → scripts/arcanium-upgrade.sh preflight
             confirms the compatibility matrix, takes a Vault snapshot
             as a safety net (reuses scripts/vault-backup.sh — the same
             step scripts/vault-restore-drill.sh takes as its own step 1)

backup     → scripts/arcanium-upgrade.sh backup
             Vault snapshot + pg_dump — the full pre-upgrade backup,
             taken as part of the timed procedure, not assumed to
             already exist

migrate    → scripts/arcanium-upgrade.sh migrate
             reports current vs. latest schema_migrations state.
             Migrations themselves are NOT applied by this step — they
             apply automatically the next time arcanium-api starts
             (arcanium/api/src/migrations.js), which happens during
             `deploy` below. This step exists so an operator sees, before
             deploying, whether new migrations are about to run.

deploy     → scripts/arcanium-upgrade.sh deploy <version>
             bumps VERSION + both package.json version fields, rebuilds
             arcanium-api/ui images tagged with <version>, recreates the
             containers (arcanium-api, arcanium-worker, arcanium-ui —
             arcanium-ui must stop/be removed before arcanium-api, or
             podman refuses to remove arcanium-api: "has dependent
             containers which must be removed before it" — found live
             while building this)

health     → scripts/arcanium-upgrade.sh health <version>
             container health status (podman inspect) + /health/live +
             /health/ready + GET /health's reported version, compared
             against the version just deployed. This is this drill's
             "make check equivalent" — `make check` itself only verifies
             the Podman machine/Compose provider, not application health,
             so it is not literally reused here.

smoke test → scripts/arcanium-upgrade.sh smoke <user> <password>
             runs scripts/verify-stack.sh, NOT scenarios/01_onboarding.
             scenarios/01_onboarding predates Prompt 18's auth hardening
             (its curl calls carry no session/auth at all) and applies
             Terraform + mints real AppRole secret IDs — a heavier,
             partially-mutating flow that is a poor fit for "run this
             after every deploy." scripts/verify-stack.sh is already
             auth-aware (Deliverable 8 of Prompt 18) and exercises the
             same real endpoints read-mostly, which is what "a lighter
             smoke subset" (this prompt's own words) calls for.

rollback   → scripts/arcanium-upgrade.sh rollback <version>
             redeploys an ALREADY-BUILT prior image tag — no rebuild —
             and re-verifies health. This only works if the prior
             version's images are still tagged locally (arcanium-upgrade.sh
             deploy tags every build with its version, not only :local,
             specifically so rollback has something to redeploy).
```

If `health` or `smoke` fails after `deploy`, the documented reverse path
is: `rollback <previous-version>`, then re-run `health` to confirm the
rollback itself is healthy. Restoring the `backup` step's pg_dump/Vault
snapshot is only needed if the failed deploy already wrote incompatible
data — a plain image rollback is the first, cheaper thing to try.

## Execution log

One real upgrade+rollback cycle, performed against the actual running
stack on 2026-09-11 to prove this procedure rather than assert it (the
same standard Deliverable 3 held itself to for the Vault restore drill):

```text
$ ./scripts/arcanium-upgrade.sh preflight
  Arcanium         1.0.0
  Vault            2.1.0-ent
  Postgres         16-alpine
  Node             24-alpine
  Nuxt             ^4.5.0
  Schema (latest)  016_restore_drills.sql
  Snapshots saved and inspected in backups/vault-20260911T204729Z.3m7qHh

$ ./scripts/arcanium-upgrade.sh backup
  Vault snapshot: backups/vault-20260911T204734Z.dRxn3B/{vault-s,cluster}.snap
  pg_dump saved: backups/pg-upgrade-20260911T204735Z.sql (2013169 bytes)

$ ./scripts/arcanium-upgrade.sh migrate
  latest migration file:            016_restore_drills.sql
  latest applied (schema_migrations): 016_restore_drills.sql
  schema is up to date

$ ./scripts/arcanium-upgrade.sh deploy 1.0.1
  version marker bumped 1.0.0 -> 1.0.1
  arcanium-api:1.0.1 / arcanium-ui:1.0.1 built and recreated

$ ./scripts/arcanium-upgrade.sh health 1.0.1
  arcanium-api: healthy | arcanium-ui: healthy | arcanium-worker: healthy
  /health/live: ok | /health/ready: ok
  reported API version: 1.0.1  (matches — deploy verified)

$ ./scripts/arcanium-upgrade.sh smoke demo-operator ***
  52 pass, 1 warn, 0 fail (of 53) — the one warn is document-signing's
  port not being published, an already-documented non-issue, not a
  regression from this deploy

  Deliberately rolling back (this was a drill, not a failed deploy):

$ ./scripts/arcanium-upgrade.sh rollback 1.0.0
  arcanium-api:1.0.0 or arcanium-ui:1.0.0 not found locally — cannot roll
  back to an image that was never built here.
```

**Real finding, not smoothed over**: the first rollback attempt failed
exactly as designed — `arcanium-upgrade.sh` did not yet exist before this
drill, so the running 1.0.0 images had only ever been tagged `:local`,
never `:1.0.0`. `rollback` correctly refused to guess at an image that
was never actually built under that version tag rather than silently
redeploying whatever `:local` happened to point at. Since `git diff`
confirmed the *only* difference between 1.0.0 and 1.0.1 was the three
version-marker files (`VERSION` + both `package.json`s — no functional
code changed), the fix was to rebuild the true 1.0.0 source (`git stash`
the version bump, rebuild+tag `:1.0.0`, `git stash pop` to restore
1.0.1) and re-run rollback. From here on, every `deploy` tags its build
with its version number specifically so this gap doesn't recur — the
first upgrade after adopting this tool is the only one that can hit it.

```text
$ ./scripts/arcanium-upgrade.sh rollback 1.0.0   # after tagging the real 1.0.0 images
  arcanium-api:1.0.0 / arcanium-ui:1.0.0 retagged :local and recreated
  version marker restored 1.0.1 -> 1.0.0

$ ./scripts/arcanium-upgrade.sh health 1.0.0
  arcanium-api: healthy | arcanium-ui: healthy | arcanium-worker: healthy
  reported API version: 1.0.0  (matches — rollback verified)

$ git status --short
  ?? docs/upgrade.md
  ?? scripts/arcanium-upgrade.sh
  # VERSION and both package.json files are back to their committed
  # 1.0.0 values — confirmed byte-identical to before the drill.
```

Result: **upgrade and rollback both verified healthy**, with the deployed
version confirmed by `GET /health` at each step (never assumed from a
clean exit code), and one real procedural gap (untagged prior images)
surfaced and closed by the tool itself refusing to guess.
