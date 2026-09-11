# Arcanium state baselines

Reproducible, controllable records of what actually ran and worked at a
point in time — **not a backup**. See "state vs backup" below.

## Why this exists

Prompts 18–22 move Arcanium from capability-building to application
hardening (`input/34`–`37`). The point of a baseline captured now is to be
able to say, later, with evidence rather than assertion:

> "This was the state before Security Foundation. This changed through
> 18–22. This still works."

## Three kinds of state, captured together per baseline

1. **Source state** — exactly which code formed the baseline: git commit,
   branch, tag, dirty/clean, the actual diff, compose/terraform file hashes,
   tool versions. Git is the real source snapshot; `state/` doesn't
   duplicate it, it references it (`source/git.txt`) plus records the diff
   that HEAD alone doesn't show (uncommitted changes at capture time).
2. **Deployment state** — what was actually running: per component,
   image/digest, container status, health, ports, networks, and
   non-secret **configuration mode** (e.g. `ARCANIUM_AUTH_ENABLED`) — never
   configuration *values* that could be credentials.
3. **Observed functional state** — not "container running" but "the thing
   the container is for actually works": supplier isolation verified,
   maturity endpoint responds, (opt-in) scenario results. This is the
   regression baseline — six phases from now, `compare-state.sh` shows what
   changed against it.

## Rules

1. **Never hand-edit a file under `state/baselines/`.** Everything there is
   written by `state/scripts/capture-state.sh`. If a capture looks wrong,
   fix the script and re-capture — a hand-edited baseline can drift from
   reality exactly the way hand-synced lists drift elsewhere in this repo
   (the failure mode Phase 20 exists to eliminate).
2. **One directory per capture, never overwritten in place**:
   `state/baselines/<id>/`. `capture-state.sh` refuses to run if the target
   directory already exists.
3. **Every check has a status** — `CAPTURED` / `PARTIAL` / `UNKNOWN` /
   `FAILED` — recorded per-component in `manifest.yaml`'s `capture.checks`
   block. A check that couldn't run says `UNKNOWN`; it never leaves an empty
   file that later reads as "no problems found". `UNKNOWN` is itself useful
   information, not a gap to paper over.
4. **Zero secrets, by whitelist, not by redaction.** The capture script
   never runs `podman inspect`, `podman compose config`, or dumps a full
   process environment — all of those can casually put credentials into the
   baseline. It only ever captures explicitly whitelisted fields (image,
   digest, status, health, networks, ports — never raw env) and an explicit
   `.env` mode-flag allowlist (booleans/enums only, never anything named
   `*PASSWORD*`/`*SECRET*`/`*TOKEN*`/`*_KEY*`/`*PIN*`/`*LICENSE*`).
   **Run `state/scripts/validate-state.sh <id>` after every capture, before
   committing it** — it independently checks the baseline for both direct
   `.env` value leaks and credential-shaped strings (Vault token prefixes,
   PEM private-key headers, bearer tokens).
5. **Mutating scenario checks are opt-in.** `capture-state.sh` always runs
   the non-mutating supplier-isolation check (mints ephemeral tokens,
   verifies 403 cross-tenant, touches no persistent state). Scenarios that
   create/rotate/destroy real resources (onboarding, Transit, PKI, KMIP,
   Managed Key, Sentinel negative test) are only run with `--with-scenarios`,
   and even then only against a stack you're prepared to have mutated.

## State vs backup — do not conflate these

```text
state/
= evidence of configuration and observed runtime condition
  (text, JSON, YAML — safe to commit, no restore capability)

backup/  (not this directory — wherever the project keeps real backups)
= material needed to actually RESTORE persistent state
  (Vault Raft snapshots, pg_dump output, HSM token backups —
   sensitive, NOT casually committed to Git)
```

A baseline can *record that a backup exists* without holding the backup
itself:

```yaml
backup:
  vault_snapshot:
    available: true
    sha256: <hash>
    stored_at: external-secure-location
  postgres:
    available: true
    sha256: <hash>
```

This distinction matters concretely for Phase 22, which is explicitly about
moving from "a snapshot exists" to "restored, with a measured RTO/RPO" — the
baseline records the claim, the restore drill proves it.

## Usage

```bash
# capture a new baseline
state/scripts/capture-state.sh 2026-09-11_pre-hardening "baseline before Prompt 18"

# with the mutating scenario suite too (touches the running demo estate)
state/scripts/capture-state.sh 2026-09-20_post-18-security "after Phase 18" --with-scenarios

# before committing ANY baseline
state/scripts/validate-state.sh 2026-09-11_pre-hardening

# compare two baselines (or a baseline against whatever came before it)
state/scripts/compare-state.sh 2026-09-11_pre-hardening 2026-09-20_post-18-security
state/scripts/compare-state.sh 2026-09-20_post-18-security

# tag + commit + push a baseline (runs validate-state.sh first as a hard
# gate; refuses to run if anything outside state/ is dirty, since commit_gh
# stages the whole working tree, not just state/)
state/scripts/commit-baseline.sh 2026-09-11_pre-hardening
state/scripts/commit-baseline.sh 2026-09-11_pre-hardening arcanium-pre-hardening \
  "Arcanium baseline before Prompt 18 Security Foundation"
```

`state/CURRENT` holds the path of the most recently captured baseline, e.g.:

```text
state/baselines/2026-09-11_pre-hardening
```

Recommended cadence for the current hardening programme: one baseline before
Phase 18 starts, then one after each of 18/19/20/21/22 closes — not for six
piles of screenshots, but for a real before/after engineering record of
Arcanium moving from a capable lab to a hardened control plane.

## Layout of one baseline

```text
state/baselines/2026-09-11_pre-hardening/
  manifest.yaml           — the centerpiece: git/runtime/components/verification/capture-status
  summary.md               — human-readable characteristics + capture-status table

  source/
    git.txt                 — commit, branch, tag
    git-status.txt           — porcelain status at capture time
    diff.patch                — uncommitted diff, if any
    versions.json              — node/terraform/vault-cli/podman versions
    hashes.sha256                — compose + terraform file hashes (never .env)

  runtime/
    containers.json          — name/image/state/status/ports/networks (whitelisted fields only)
    images.json                — repository/id/digest/size
    networks.json                — podman network list
    volumes.txt                    — volume names only, no content

  arcanium/    health.json, capabilities.json (mode-flag allowlist only), migrations.txt, api-smoke.json
  vault/       cluster.json, mounts.json, auth-methods.json, audit-devices.json, namespaces.json, policies-summary.json
  hsm/         status.json, pkcs11-slots.txt, managed-keys.json
  infra/       postgres.json, schema.txt
  kms/         status.json  (kms-sim / LocalStack — always labeled emulated)
  observability/  status.json, targets.json
  workloads/   status.json, inventory.json
  scenarios/   results.json, summary.md   — the observed-functional-state regression baseline
```

These seven components match the ones named when this convention was set
up: Arcanium, HSM, Infra, KMS, Observability stack, Vault(s), Workloads.
