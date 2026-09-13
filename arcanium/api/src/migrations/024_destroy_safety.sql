-- 024_destroy_safety.sql — Prompt 36, Deliverable 5.
--
-- Found live (full six-stage lifecycle audit): nothing pins what a destroy
-- approval was actually raised against. An approval names only a bare
-- key_name, so execution (approval-execution.js) acts on whatever that
-- name resolves to AT EXECUTION TIME, not what a human actually reviewed —
-- including a key rotated (or destroyed and recreated under the same
-- name) any time between request and execution, a window that can span
-- days.
--
-- pinned_key_version is captured once, at request time
-- (provisioner/key.js's requestKeyDestroy()), from the key's own live
-- Vault metadata (latest_version) — not asserted, read. Immediately before
-- the real delete (approval-execution.js), the key's live version is
-- re-read and compared; a mismatch means the key has changed since the
-- request was raised, and execution refuses rather than destroying a key
-- that is no longer the one reviewed. NULL is a legitimate value (the
-- version could not be captured at request time, e.g. the key had already
-- been destroyed by the time the request was recorded) and is never
-- treated as "matches everything" — a NULL pin never authorizes a delete;
-- see approval-execution.js's own use of this column.

ALTER TABLE approval_requests
  ADD COLUMN pinned_key_version INTEGER;

COMMENT ON COLUMN approval_requests.pinned_key_version IS
  'The key''s live Vault latest_version at the moment this destroy request was raised (action=revoke only). Re-checked immediately before actual deletion; a mismatch refuses execution rather than destroying a key that has changed since the request was reviewed. NULL means it could not be captured and never authorizes a delete on its own.';
