-- 023_approval_execution.sql — Prompt 29, Deliverable 6.
--
-- Found live: approving a destroy_request (routes/approvals.js POST
-- /:id/approve) only ever flipped approval_requests.status to 'approved' —
-- nothing anywhere then performed the actual Vault key deletion. Every
-- expiry_date-drifted key whose destroy request got approved stayed
-- exactly as drifted as before, forever, with no path to RECONCILED.
--
-- executed_at distinguishes "governance approved this" (status) from
-- "this actually happened" (executed_at) — the worker's periodic tick now
-- performs the real Vault deletion for rows where the former is true and
-- the latter is still NULL, then sets it.

ALTER TABLE approval_requests
  ADD COLUMN executed_at TIMESTAMPTZ;

COMMENT ON COLUMN approval_requests.executed_at IS
  'Set once the approved action (currently only action=revoke, i.e. Vault key destruction) has actually been carried out — NULL means approved but not yet executed. Never set for rejected or pending requests.';
