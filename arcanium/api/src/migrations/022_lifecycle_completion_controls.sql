-- 022_lifecycle_completion_controls.sql — Prompt 28, Deliverable 7.
-- Seeds the two controls Deliverable 5 (expiry_date) and Deliverable 6
-- (offboarding) exist to actually feed evidence into — same idempotent
-- ON CONFLICT DO NOTHING pattern 013_controls.sql's own seed uses.
INSERT INTO controls (id, requirement, mandatory, dimension) VALUES
  ('KML-DESTR-01', 'Active keys must not exceed their declared expiry date.', true, 'Key Lifecycle Hygiene'),
  ('KML-OFFBOARD-01', 'Decommissioned applications must have all keys destroyed within 30 days.', false, 'Governance Adoption')
ON CONFLICT (id) DO NOTHING;
