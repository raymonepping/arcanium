# scenarios/07_failure — Failure & Resilience Scenarios

Demonstrates that cryptographic operations continue while the cluster is deliberately degraded.
Each script is self-contained, auto-restores the cluster, and is safe to run against the local
Arcanium demo environment.

## Prerequisites

- All stacks running (`make vault-up infra-up hsm-up arcanium-up workloads-up`)
- Vault CLI on `PATH`
- `.secrets/vault/` populated (by `make vault-bootstrap`)

## Scenarios

### `01_node_failure.sh` — Single node failure

| | |
|---|---|
| **What happens** | `vault-2` is stopped; Raft retains quorum (vault-1 + vault-3) |
| **Expected** | Zero service interruption — evidence keeps accumulating |
| **Demonstrates** | Cluster shows **degraded** state while **availability is maintained** |
| **Auto-restores** | Yes — vault-2 restarted, rejoins Raft |

```bash
make scenario-failure-node
```

Watch Grafana → **Vault Cluster** dashboard. The graph shows vault-2 disappearing
from Raft peers then reappearing after recovery.

---

### `02_leader_failover.sh` — Active leader failover

| | |
|---|---|
| **What happens** | The current active Raft leader is stopped |
| **Expected** | < 10 s election pause, new leader elected, operations resume |
| **Demonstrates** | Leader election; original leader rejoins as a follower |
| **Auto-restores** | Yes — original leader restarted |

```bash
make scenario-failure-leader
```

Watch Grafana → **Vault Cluster** dashboard. Look for the leader-change event
annotation and the brief spike in Vault RPC latency during election.

---

### `03_quorum_loss.sh` — Loss of quorum (educational, interactive)

| | |
|---|---|
| **What happens** | vault-2 AND vault-3 stopped (only 1 of 3 nodes remain) |
| **Expected** | Vault goes unavailable; API returns errors |
| **Demonstrates** | Why a minimum of 3 nodes (quorum = 2) is non-negotiable |
| **Interactive** | Requires typing `YES` at the prompt to prevent accidents |
| **Auto-restores** | Yes — both nodes restarted after 30 s |

```bash
make scenario-quorum-loss
```

> **CISO talking point:** This is the difference between _degraded_ (01) and _down_ (03).
> The design goal is never reaching scenario 03 in production.

---

### `04_seal_unseal.sh` — Seal vault-s / unseal with Shamir key

| | |
|---|---|
| **What happens** | vault-s (transit auto-unseal provider) is sealed |
| **Expected** | vault-1/2/3 are unaffected (already unsealed in memory) |
| **Demonstrates** | Seal as an incident-response action; Shamir key unsealing |
| **Auto-restores** | Yes — vault-s unsealed with key from `.secrets/vault/vault-s-init.json` |

```bash
make scenario-seal-unseal
```

> **CISO talking point:** Sealing vault-s is an incident-response lever. The
> cluster nodes do not re-seal automatically; an operator must seal them individually.
> The Shamir key is split — no single person can unseal unilaterally.

---

## Interpreting Grafana during failure scenarios

| Metric | What to watch |
|--------|---------------|
| `vault_core_active` | Drops to 0 on the stopped node |
| `vault_raft_leader_*` | Leader-change events |
| `vault_route_write_*` | Latency spike during leader election |
| `vault_token_creation_count` | Continues on surviving nodes → proof of resilience |

Annotations are added automatically by the scenario scripts via the
Grafana annotations API when `GRAFANA_URL` is set in the environment.

---

## Make targets

```
make scenario-failure-node     # 01 — single node failure
make scenario-failure-leader   # 02 — leader failover
make scenario-quorum-loss      # 03 — quorum loss (educational, interactive)
make scenario-seal-unseal      # 04 — seal / unseal vault-s
```
