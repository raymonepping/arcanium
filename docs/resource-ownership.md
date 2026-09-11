# Terraform / Arcanium runtime resource ownership

Pre-24, Deliverable 4. The goal is not necessarily a zero-diff `terraform plan` everywhere — it is **explained ownership and no destructive surprise**. Every module below was run through a real `terraform validate` and (where credentials were available) a real `terraform plan` against the live stack while writing this page; results are reported as found, not assumed.

## Ownership model

```text
Terraform-owned        baseline platform configuration — namespaces, auth
                        methods, policies, mounts, seeded/demo resources.
                        Reconciled by `make tf-*` / `make tf-all`.

Arcanium-runtime-owned  resources Arcanium's own provisioner
                        (arcanium/api/src/provisioner/*.js) creates when an
                        operator uses the running application — a NEW
                        supplier registered through the UI, a NEW
                        application's Transit key/AppRole via
                        POST /applications/:id/provision or POST /keys.

Externally-owned        systems this lab integrates with but does not
                        control the internal state of: LocalStack (KMS
                        sim), and — outside Vault's Terraform entirely —
                        Keycloak/OpenLDAP, whose configuration is owned by
                        compose/identity/keycloak/setup_keycloak.sh and
                        compose/identity/ldap/bootstrap.ldif, not by any
                        Terraform module (see docs/persistence.md).

Ephemeral/test-owned    scenario-run artifacts: individual KMIP demo keys
                        (create/activate/revoke/destroy is the point of the
                        demo), disposable Vault tokens minted during test
                        runs, Postgres sessions.
```

The same *kind* of resource (a supplier namespace, an AppRole, a Transit key) can exist under more than one ownership path — pepsi/cocacola are Terraform-seeded demo tenants; any other supplier is Arcanium-runtime-owned. Terraform must never recreate or delete a resource Arcanium's runtime provisioner owns merely to make a plan look green, and vice versa: Arcanium's runtime provisioner only ever creates *new* namespaces/applications, never mutates the seeded pepsi/cocacola/demo resources Terraform owns.

## Module-by-module

| Module | Owns | `terraform validate` | `terraform plan` (live, this session) |
|---|---|---|---|
| `bootstrap` | documentation only — no resources, records apply order | ✓ valid | n/a (no resources) |
| `vault-platform` | approle/userpass auth backends, arcanium-admin/transit/pki/workload-read-only policies, `arcanium-api`/`workload-generic` AppRole roles, audit device, external-supplier/approver-1/crypto-approvers control-group identities | ✓ valid | **not a no-op — see finding 1 below** |
| `vault-transit` | `transit` mount, demo/workload Transit keys | ✓ valid | No changes |
| `vault-pki` | root/intermediate CA, `arcanium-services` PKI role | ✓ valid | **cosmetic diff — see finding 2 below** |
| `vault-database` | `database` mount, Postgres connection, `arcanium-api-role` dynamic-credential role | ✓ valid | No changes |
| `vault-workloads` | payments/pki/document-signing policies+AppRoles, demo Transit keys | ✓ valid | **contains a vestigial resource — see finding 3 below** |
| `vault-kmip` | KMIP engine mount, `arcanium` scope, `legacy_db` role | ✓ valid | No changes |
| `vault-suppliers` | pepsi/cocacola namespaces, auth backends, Transit mounts+keys, policies, AppRoles, rate-limit quotas (seeded demo tenants only) | ✓ valid | No changes |
| `vault-managed-keys` | SoftHSM `vault_managed_keys` registration, `document-signing` Transit key/policy/AppRole (the one actually used by the live docsign workload), `arcanium-hsm-read` policy/AppRole | **✗ FAILS — see finding 4 below** | not run (validate must pass first) |
| `vault-keymgmt` | Key Management engine mount, distributed key, LocalStack KMS target config | ✓ valid | not run this session (requires `kmse_emulated` var matching live kms-sim state) |
| `vault-sentinel` | EGP policies (`deny_unapproved_key_destroy`, `protect_audit_devices`, `rotation_from_automation`), `automation` policy — License-gated | ✓ valid | No changes |

## Findings

### 1. `vault-platform` plans to create a retired userpass auth backend + 6 demo users

`terraform plan` proposes **7 resources to add**: `vault_auth_backend.userpass` and `vault_generic_endpoint.arcanium_user["architect"|"auditor"|"ciso"|"cocacola-admin"|"operator"|"pepsi-admin"]`. These are absent from the module's current state file (`.secrets/terraform/vault-platform.tfstate`) but still declared in `terraform/vault-platform/*.tf`.

This is the userpass demonstration login Prompt 18 explicitly replaced with OIDC — `docs/api.md` states plainly: *"There is no `POST /api/v1/auth/login` — the userpass path was removed with Phase 18."* Nothing in `scenarios/` or `scripts/` references userpass login any more except `scripts/vault-seed-users.sh` itself (grepped to confirm). A routine `make tf-platform` or `make tf-all` run today would silently **reintroduce a retired authentication mechanism** into what is otherwise an OIDC-only, deny-by-default hardened deployment.

Classification: `DEFERRED_WITH_REASON` — whether to delete these resources from the `.tf` source (retiring userpass from Terraform entirely) or to `terraform state rm`/re-import them as intentionally-kept fallback demo accounts is a design decision outside this prompt's scope (persistence/rehydration, not auth-mechanism retirement). Flagged here and in `docs/local-dependency-audit.md` rather than silently applied either way.

### 2. `vault-pki`'s TTL fields show a cosmetic, non-substantive diff

`arcanium_services`' `max_ttl`/`ttl` are recorded in state as raw-second strings (`"31536000"`, `"2592000"`) while the config expresses them as duration strings (`"8760h"`, `"720h"`) — numerically identical (365 days, 30 days), a known `vault_pki_secret_backend_role` provider quirk where the two representations aren't normalized in the diff. Applying it is harmless (same effective value) but it means this module is not literally a no-op plan today. Classification: `INTENTIONAL_LOCAL_DEPENDENCY` — cosmetic, safe, left as-is; noted so a future `terraform apply` isn't mistaken for real drift.

### 3. `vault-workloads` defines a `document-signing-workload` AppRole/Transit key nothing consumes

`terraform/vault-workloads/approle.tf` creates `document_signing_workload` (AppRole role `document-signing-workload`) and a `document_signing_key` Transit key on the **main** cluster. The actual, live `document-signing` container (`compose/workloads/compose.yaml`) authenticates against **`document-signing`** on **vault-hsm** (`terraform/vault-managed-keys`) instead — confirmed by its compose environment (`VAULT_ADDR: https://vault-hsm:8200`, `VAULT_ROLE_ID: ${DOCSIGN_VAULT_ROLE_ID}`, resolved via `scripts/workload-credentials.sh` to the `vault-managed-keys` role, not this one). The `vault-workloads` copy predates the Managed Key integration and is unused. Classification: `DEFERRED_WITH_REASON` — harmless (nothing points at it) but worth retiring in a future cleanup; not touched here since it isn't a persistence/rehydration concern and removing a Terraform-tracked resource is a deliberate decision, not a side effect of this prompt.

### 4. `vault-managed-keys` fails `terraform validate`

```text
Blocks of type "pkcs11" are not expected here. Did you mean "pkcs"?
```

`terraform/vault-managed-keys/managed_key.tf`'s `vault_managed_keys.docsign` resource uses a `pkcs11 { ... }` nested block; the currently-resolved provider (`hashicorp/vault` v4.8.0, satisfying this module's own `~> 4.4` constraint) expects `pkcs` instead — a real schema drift between this module's source and its own declared provider constraint, not a syntax typo. **The live Vault resource itself is unaffected and working** — verified during this same prompt: the `document-signing` workload container successfully signed a document and correctly rejected a tampered-payload verification against it, using the SoftHSM-backed Managed Key this resource represents.

This means `vault-managed-keys` **cannot currently produce a `terraform plan` at all** — a real, concrete violation of this deliverable's own exit bar ("plans should either be no-op or explain intentional drift"). Classification: `DEFERRED_WITH_REASON`, not fixed in this pass. The fix (renaming the block, confirming the resulting plan is a true no-op against the live resource) touches Terraform's model of a **non-exportable HSM-held key** — `docs/persistence.md` is explicit that this class of resource is never reconstructible from Git, so a config change here gets tested against `terraform plan` (never `apply`) and confirmed as a genuine no-op before ever being applied, and only with explicit go-ahead given what it touches.

## Terraform ownership and Arcanium runtime ownership do not overlap silently

Concretely: Arcanium's provisioner (`arcanium/api/src/provisioner/supplier.js`, `application.js`, `key.js`) creates new Vault resources at runtime using the **same kind of primitives** Terraform creates for the seeded demo tenants (namespace, AppRole, Transit mount/key, policy) — but always for **new** names the runtime itself generates (a newly registered supplier's slug, a newly provisioned application's key name), never by mutating `suppliers/pepsi`, `suppliers/cocacola`, or any other Terraform-tracked resource. `terraform plan` on `vault-suppliers` reporting "No changes" while new tenants exist in the live estate is the expected, correct state — Terraform's state file only ever tracks what it created, and a `plan` never proposes destroying resources it doesn't know about. This is the boundary the article calls out explicitly: *"Two systems changing the same resource without an agreed boundary would create the drift the platform is supposed to explain."* Findings 1 and 3 above are the two places that boundary has actually drifted (config vs. reality), found by literally running the check this deliverable asks for rather than assumed clean.
