# Policy-as-code — Sentinel (Prompt 14.4)

`input/02` §15: with Sentinel, Vault becomes not just a crypto engine but a
**policy enforcement point for the key lifecycle**.

## Licence

Requires the **Sentinel** feature (present in the 2.1-ent licence —
`./scripts/vault-check-entitlement.sh "Sentinel"`). If unlicensed, `make
tf-sentinel` skips cleanly and the destroy flow falls back to approval + Control
Group only.

## The policies (`terraform/vault-sentinel/`)

| Policy | Paths | Enforcement | Rule in plain language |
|---|---|---|---|
| `deny-unapproved-key-destroy` | `transit/keys/*` | hard-mandatory | A `DELETE` on a Transit key is denied unless the token carries `crypto-approver-policy`. Normal tokens — including the Arcanium API's — must route destruction through the approval + Control Group flow (`POST /api/v1/keys/:name/destroy`). |
| `protect-audit-devices` | `sys/audit/*` | hard-mandatory | The audit trail cannot be disabled through the platform. |
| `rotation-from-automation` | `transit/keys/*` | hard-mandatory | A `.../rotate` update is denied unless the token carries the `automation` marker policy. Workload and platform AppRoles carry it; a human token does not. |

Root tokens are exempt from EGPs (Vault behaviour) — the break-glass path. The
`automation` policy grants no capabilities; its presence is the whole signal.
Workload and platform AppRoles receive it (`terraform/vault-workloads/approle.tf`,
`terraform/vault-platform/auth.tf`), and `provisioner/application.js` adds it to
every workload role it creates.

## Proof

```bash
./scenarios/09_sentinel/test_sentinel_block.sh
# ▸ test 1 — delete with the non-approver token   ✓ PASS — Sentinel denied
# ▸ test 2 — delete with the approver token        ✓ PASS — allowed
```

The denial message is explicit:

```
* egp standard policy "root/deny-unapproved-key-destroy" evaluation resulted in denial.
```

## How this maps to the KML

- **Vernietiging / Destroy** — governed. Arcanium records an approval; Sentinel
  makes sure nobody bypasses that with a direct API call.
- **Aantoonbaarheid / auditability** — `protect-audit-devices` keeps the evidence
  trail intact.

The source now also includes `rotation-from-automation` and an `automation` policy. Use `make scenario-automation-depth` to exercise the intended restriction after provisioning. Policy presence alone does not prove enforcement; inspect the actual target paths, identity and observed result. Other proposed namespace/identity-group restrictions remain separate work.
