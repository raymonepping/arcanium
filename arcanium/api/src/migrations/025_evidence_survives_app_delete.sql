-- 025_evidence_survives_app_delete.sql — Prompt 42.
--
-- Found live by an independent review: DELETE /api/v1/applications/:id
-- (routes/applications.js) is a bare `DELETE FROM applications`, no
-- Vault interaction, reachable by ciso/architect/operator/supplier-admin
-- (destroy_request in the MATRIX). approval_requests.app_id was
-- `ON DELETE CASCADE` — reproduced live with a disposable fixture: an
-- approved destroy request, the exact record proving a real Vault
-- Control Group authorization happened (Prompt 39), vanished with the
-- application, no trace. desired_state.application_id had no ON DELETE
-- clause (defaults to RESTRICT), so an application WITH reconciliation
-- history instead failed the delete outright with a confusing 409 —
-- neither behavior matches this project's own stated principle
-- (migrations/021_offboarding.sql's header: "evidence/reconciliation
-- history must survive the application's own lifecycle").
--
-- The fix is not "require offboarding first" — scenarios/17_
-- terraform_provider/test_terraform_provider.sh relies on `terraform
-- destroy` succeeding against a freshly-created application with no
-- history at all, so any new precondition on this route would break a
-- real, already-tested workflow. Both foreign keys become
-- ON DELETE SET NULL instead: a fresh application with no rows deletes
-- exactly as before; an application with real governance/reconciliation
-- history now deletes cleanly too, and every approval_requests/
-- desired_state row survives with every other column intact — only the
-- now-dangling application link is nulled out, the same way
-- approval_requests.supplier_id already behaves (see 002_approvals.sql).
--
-- crypto_profiles' own ON DELETE CASCADE is deliberately left untouched
-- — it holds live configuration for a still-active application, not
-- governance/evidence history, and was already a documented decision.

ALTER TABLE approval_requests ALTER COLUMN app_id DROP NOT NULL;

ALTER TABLE approval_requests
  DROP CONSTRAINT approval_requests_app_id_fkey;
ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_app_id_fkey
    FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE SET NULL;

ALTER TABLE desired_state ALTER COLUMN application_id DROP NOT NULL;

ALTER TABLE desired_state
  DROP CONSTRAINT desired_state_application_id_fkey;
ALTER TABLE desired_state
  ADD CONSTRAINT desired_state_application_id_fkey
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;

COMMENT ON COLUMN approval_requests.app_id IS
  'The application this request was raised against. Nullable: ON DELETE SET NULL — a governance record must outlive the application''s own registry row (Prompt 42, found live: this previously cascade-deleted an approved destroy request, including its real Vault Control Group authorization, with the application).';

COMMENT ON COLUMN desired_state.application_id IS
  'The application this declared policy belongs to. Nullable: ON DELETE SET NULL — reconciliation history must outlive the application''s own registry row (Prompt 42; previously had no ON DELETE clause at all, so deleting an application with any reconciliation history failed outright instead of preserving it).';
