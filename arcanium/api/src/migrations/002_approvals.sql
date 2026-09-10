-- 002_approvals.sql
-- Base approval_requests table. Columns source + supplier_id are added
-- by 003_supplier_isolation.sql to keep migrations append-only.

CREATE TABLE IF NOT EXISTS approval_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id       UUID        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  key_name     TEXT        NOT NULL,
  action       TEXT        NOT NULL CHECK (action IN ('rotate','revoke','export')),
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','approved','rejected')),
  requester    TEXT        NOT NULL,
  approver     TEXT,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_app_id
  ON approval_requests(app_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_status
  ON approval_requests(status);
