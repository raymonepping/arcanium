# Correlation IDs

Prompt 24, Deliverable 2. Every inbound request gets a `request_id`: honored if the client already supplied one (`X-Request-Id`), generated (`crypto.randomUUID()`) otherwise. `middleware/requestId.js` is mounted before everything else that logs or persists, so `req.requestId` is available to every downstream router.

```text
request_id → job_id (provisioning_jobs.request_id)
           → approval_id (approval_requests.request_id)
           → evidence_id (evidence.request_id, approval-origin rows only)
```

Migration `015_correlation_ids.sql` — **numbered 015, not the prompt's own illustrative `014_correlation_ids.sql`**: `014` was already taken by `014_scenario_runs.sql` (Prompt 21), found by reading the actual migrations directory rather than assuming the prompt's own numbering matched the repo's current state.

## Where it's threaded, and where it deliberately isn't

- `provisioning_jobs.request_id` — set on every job created via `applications.js`, `keys.js`, `suppliers.js` (both provision and deprovision).
- `approval_requests.request_id` — set on `POST /api/v1/approvals`.
- `evidence.request_id` — nullable, and **only ever populated for `origin='approval'` rows**. `origin='audit-log'` rows are ingested asynchronously from Vault's own audit log, out of band from any Arcanium request — those legitimately have no request_id, and this migration does not backfill one to make the column look fuller than reality.

Every log line (`requestLogger.js`) and every error response (`errorHandler.js`) carries `request_id`, so a single failing flow can be grepped end-to-end:

```
[req] POST   /api/v1/applications/:id/provision 500 812ms request_id=3f2a...
[error] POST /api/v1/applications/:id/provision → request_id=3f2a... Error: ...
```

## `vault_request_id`: verified absent, not built

See `docs/slo.md`'s own note — checked live against the running cluster (`curl -sk -D - https://127.0.0.1:18200/v1/sys/health`), this Vault Enterprise 2.1.0 deployment sends no `X-Vault-Request-Id`-shaped header on any response. `vaultRequest()` (`arcanium/api/src/vault.js`) also currently discards response headers entirely. Not built — extraction code for a header this deployment never sends would be dead code presented as a working feature.

## The gateway's one deliberate exception

`arcanium/ui/server/routes/gateway/[...path].ts`'s own header comment states the design principle plainly: *"error payloads are never forwarded"* — the gateway replaces whatever the API actually returned with a generic, pre-sanitized `{statusCode, statusMessage}` before it ever reaches the browser. `request_id` is the one deliberate exception: an opaque correlation token, never sensitive, forwarded specifically so a UI error toast can point back at the exact server-side log line. Most routes 403/401 directly from scattered `authorize()` checks across every route file rather than routing through `errorHandler.js`'s JSON body — so the gateway reads `request_id` from **either** the error body (when present) **or** the `X-Request-Id` response header (which `middleware/requestId.js` sets unconditionally on every response, success or failure), rather than requiring every one of those call sites to be individually touched.

`utils/apiError.ts`'s `apiErrorMessage()` appends `(request <id>)` to its returned string when one is available; `apiErrorRequestId()` is exposed separately for views that want to render it distinctly (job/approval detail views do, via a `request_id` row/line, not folded into the message text).
