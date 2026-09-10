-- 004_control_group_accessor.sql
-- Adds Vault Control Group accessor to approval_requests.
-- Broadens action CHECK to include 'encrypt' for the Control Group demo.
-- Append-only migration — no renames, no drops.

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS accessor TEXT UNIQUE;

-- Broaden the action constraint (add 'encrypt')
ALTER TABLE approval_requests
  DROP CONSTRAINT IF EXISTS approval_requests_action_check;

ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_action_check
    CHECK (action IN ('rotate','revoke','export','encrypt'));
