# External integration surface (Prompt 28)

Every prior integration point assumed a human, browser-based OIDC session.
This prompt added a machine-to-machine identity, an outbound event
mechanism, and a minimal Terraform provider — proving the API surface is
usable by something other than the Arcanium UI, not just designed to be.

## Service accounts — the machine identity

`service_accounts` / `service_account_tokens` (migration
`019_service_accounts.sql`) are a separate identity model from human OIDC
sessions: `roles TEXT[]` and `tenant_scopes TEXT[]` (`NULL` = estate-wide)
set directly at creation time, not derived from LDAP groups. A service
account does **not** use [multitenancy.md](multitenancy.md)'s scoped-grant
mechanism — it sets `scopes: []` explicitly, with a code comment
explaining why: the two models solve the same shape of problem
(narrowing a grant below estate-wide) for two different kinds of caller,
and conflating them would make it unclear which mechanism actually
applied to a given identity.

`POST /api/v1/service-accounts/:id/tokens` generates a 256-bit token
(`randomBytes(32)`), stores only its SHA-256 hash, and returns the
plaintext token **exactly once** — the response body is the only place it
is ever visible again; every later read (`GET /service-accounts/:id`)
returns metadata only (`id`, `description`, `expires_at`, `created_at`,
`last_used_at`, `revoked_at`), never the token or its hash.

## Bearer authentication — the same `authorize()`, a different front door

`requireSession` (`arcanium/api/src/auth/index.js`) checks
`Authorization: Bearer <token>` **before** the cookie path. A presented
token is hashed and looked up (`service_account_tokens JOIN
service_accounts`), then built into the exact same `req.identity` shape
the cookie path builds — `authorize()` has no branch for "this came from
a service account," because it never needs one.

`req.identity.user` is prefixed `service-account:<name>` — never
confusable with a human username, since usernames have never contained a
colon since [personas.md](personas.md)'s own username validation.

Revoking a service account (`revoked_at` set) takes effect immediately:
its tokens stop authenticating on the very next request, verified live —
not inferred from the revocation flag alone.

## Webhooks — outbound events

`webhook_endpoints` / `webhook_deliveries` (migration `020_webhooks.sql`)
let an external system subscribe to `reconciliation.drifted`,
`reconciliation.compliant`, and `key.expiry_approaching`.

**Signing.** The illustrative schema this prompt started from stored only
a `secret_hash` (SHA-256, one-way) — which cannot compute a future
HMAC-SHA256 signature, since HMAC needs the raw key bytes back, not a
hash of them. Fixed by adding `secret_ciphertext`, Vault Transit-encrypted
under a dedicated `arcanium-webhook-signing` key
(`arcanium/api/src/vault.js: ensureWebhookSigningKey()`, created lazily on
first use). `secret_hash` is kept alongside it as a non-secret audit
fingerprint, not the signing source. The plaintext signing secret, like a
service-account token, is returned exactly once, at creation.

**Delivery.** Fire-and-forget: `recordRun()` never awaits it.
`emitEvent()` inserts a `webhook_deliveries` row **before** attempting
delivery, so an attempt is durable even if the process crashes mid-send —
every attempt is recorded, never a silent drop. Three attempts,
exponential backoff (1s/2s/4s), `X-Arcanium-Signature`
(`HMAC-SHA256` over the payload) on every request.

Delivery runs wherever `recordRun()` executes — the worker's periodic
reconciliation sweep in the normal case, or inline in the API process for
an on-demand `POST /reconciliation/run`. This is a deliberate
simplification, not an oversight: Arcanium is a governance layer, not an
API gateway product, and a webhook fired from either process still lands
in the same `webhook_deliveries` audit trail either way.

**A real Vault ACL bug found proving this live.** `arcanium-transit`'s
`transit/keys/*` (read-only) is a *more specific* path match than
`arcanium-admin`'s `transit/*` (full CRUD) — Vault's resultant ACL applies
the narrower rule for anything under `transit/keys/`, regardless of a
broader grant also being attached to the same token. The webhook-signing
key's lazy-create call was silently denied by this precedence rule until
an exact-path exception (`transit/keys/arcanium-webhook-signing`, `create
+ read + update` — `update` because Vault's own key-write path has no
existence check and classifies even a first-ever write as an
`UpdateOperation`, not `CreateOperation`) was added to
`terraform/vault-platform/policies.tf`, scoped to that one key only —
every other Transit key stays read-only for this role.

## Terraform provider skeleton

`terraform/arcanium-provider/` is a minimal, unpublished Terraform
provider (Go, Terraform Plugin Framework): one resource
(`arcanium_application`) and one data source
(`arcanium_application_intent`), authenticating via a service-account
Bearer token — the same M2M identity described above, not a special
provider-only credential.

```hcl
provider "arcanium" {
  endpoint = "http://localhost:3001"
  token    = "<service-account token>"
}

resource "arcanium_application" "payments" {
  name        = "payments-api"
  environment = "production"
}

data "arcanium_application_intent" "payments" {
  application_id = arcanium_application.payments.id
}
```

Not published to the Terraform Registry — `scenarios/17_terraform_provider/
test_terraform_provider.sh` (`make scenario-terraform-provider`) is the
proof instead: it provisions a real, disposable service account, issues a
real token, runs an actual `terraform apply` (via a local `dev_overrides`
CLI config, not a registry install) against the live stack, confirms the
created application is a real row via `GET /applications/:id`, then
`terraform destroy` and confirms the row is genuinely gone (`404`). Eight
assertions, all live.

## Key expiry as a second desired-state requirement

`desired_state.requirement = 'expiry_date'` sits alongside the existing
`rotation_period` requirement (reconciliation semantics predate this
prompt — see [api.md](api.md)) — `desired_value =
{"not_after": "2027-01-01"}` means "this key must not still be active
after this date."

Its reconcile action is fundamentally different from `rotation_period`'s:
reconciling a `DRIFTED` `expiry_date` row does **not** touch Vault
directly. It submits a real `destroy_request` approval through the exact
same four-eyes gate (`requestKeyDestroy()`) every other destruction path
in this system goes through — never a second, lighter destruction
mechanism. The row only reaches `RECONCILED` once a later sweep observes
the key genuinely destroyed, after a human has actually approved it.

## Offboarding

`POST /api/v1/applications/:id/offboard` is a workflow, not a cascade
delete. For every one of the application's `desired_state` rows: an
already-inactive key is archived immediately (tombstoned,
`archived_at` — never a hard delete, since evidence and reconciliation
history must survive the application's own lifecycle); a still-active key
gets a real `destroy_request` approval submitted, the same way
`expiry_date` reconciliation does. The application is **not** marked
offboarded at this point — `applications.offboarded_at` is only set once
every one of those approvals has actually been resolved (approved or
denied), checked idempotently by `sweepOffboarding()` on the worker's
existing periodic tick, so an approval resolved through the ordinary
approve/deny routes days later is still picked up without those routes
needing any offboarding-specific logic.

A real bug was found and fixed proving this live: `checkOffboardingCompletion()`
initially matched pending approvals by `app_id`, but
`provisioner/key.js`'s `requestKeyDestroy()` has a pre-existing quirk
(already documented in `aggregation/intent.js`'s own comments) of
attaching every destroy request's `app_id` to "the first registered
application" — an FK-satisfying placeholder, not the key's real owner.
Matching by `key_name` instead (the same workaround the intent view
already used) fixed it.

## Two new controls

`KML-DESTR-01` (mandatory, Key Lifecycle Hygiene — "active keys must not
exceed their declared expiry date") and `KML-OFFBOARD-01`
(non-mandatory, Governance Adoption — "decommissioned applications must
have all keys destroyed within 30 days") — assessed by
`assessKeyExpiry()`/`assessOffboarding()`
(`arcanium/api/src/maturity/controls.js`), following the same
UNKNOWN-until-real-data discipline every other control in
[maturity-model.md](maturity-model.md) already follows: neither reports
`PASS` until the relevant desired-state type or workflow has actually
been exercised at least once.
