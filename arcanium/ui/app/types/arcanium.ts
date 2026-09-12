// types/arcanium.ts
// Canonical TypeScript types for the Arcanium API contract.

export interface Supplier {
  id: string
  name: string
  vault_namespace: string
  sla_tier: 'standard' | 'premium'
  created_at: string
}

export interface Application {
  id: string
  name: string
  description?: string | null
  supplier_id?: string | null
  category?: 'platform' | 'tenant' | 'unscoped'
  registered_at: string
  crypto_profiles?: CryptoProfile[]
}

export interface CryptoProfile {
  id: string
  application_id: string
  type: 'transit' | 'pki' | 'kmip' | 'managed_key'
  vault_path: string
  created_at: string
}

export interface TransitKey {
  name: string
  type: string
  deletion_allowed: boolean
  exportable: boolean
  min_decryption_version: number
  min_encryption_version: number
  supports_encryption: boolean
  supports_decryption: boolean
  supports_derivation: boolean
  supports_signing: boolean
  versions?: Record<string, { creation_time: string }>
  latest_version?: number
  auto_rotate_period?: number
  /** API-derived custody label (never inferred from the key name). */
  custody?: string
  hsm_backed?: boolean
  managed_key_name?: string | null
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type ApprovalSource = 'manual' | 'local' | 'external'

export interface ApprovalRecord {
  id: string
  app_id: string
  key_name: string
  action: string
  status: ApprovalStatus
  requester: string
  approver?: string | null
  reason?: string | null
  accessor?: string | null
  source: ApprovalSource
  supplier_id?: string | null
  request_id?: string | null
  created_at: string
  updated_at: string
}

// ── Reconciliation (Prompt 20) ────────────────────────────────
// Two independent axes (input/36) — never merged into one combined value.
export type ObservationStatus = 'COMPLIANT' | 'DRIFTED' | 'UNKNOWN'
export type Disposition = 'OPEN' | 'EXCEPTION_ACCEPTED' | 'RECONCILED'

export interface ReconciliationRunSummary {
  id: string
  observed_value: { days: number } | null
  status: ObservationStatus
  observed_at: string
  detail?: string | null
}

export interface ReconciliationRow {
  desired_state_id: string
  application_id: string
  application_name: string
  tenant: string | null
  key_name: string
  requirement: string
  desired_value: { days: number }
  version: number
  source: string
  changed_by: string
  changed_reason?: string | null
  updated_at: string
  latest_run: ReconciliationRunSummary | null
  observation_status: ObservationStatus
  disposition: Disposition
}

export interface DesiredStateHistoryEntry {
  version: number
  desired_value: { days: number }
  changed_by: string
  changed_groups: string[]
  changed_reason?: string | null
  changed_at: string
  current?: boolean
}

export interface ReconciliationAction {
  id: string
  run_id: string
  action: 'reconcile' | 'accept_exception'
  actor: string
  actor_groups: string[]
  result: 'applied' | 'failed' | 'denied'
  reason?: string | null
  expires_at?: string | null
  created_at: string
}

export interface ReconciliationDetail {
  run: {
    id: string
    desired_state_version: number
    observed_value: { days: number } | null
    status: ObservationStatus
    observed_at: string
    detail?: string | null
  }
  desired_state_id: string
  application_id: string
  application_name: string
  tenant: string | null
  key_name: string
  requirement: string
  desired_value: { days: number }
  observation_status: ObservationStatus
  disposition: Disposition
  desired_state_history: DesiredStateHistoryEntry[]
  actions: ReconciliationAction[]
}

export interface VaultNodeHealth {
  initialized: boolean
  sealed: boolean
  standby: boolean
  performance_standby?: boolean
  replication_performance_mode?: string
  replication_dr_mode?: string
  server_time_utc?: number
  version: string
  cluster_name?: string
  cluster_id?: string
  last_wal?: number
  ha_enabled?: boolean
}

export interface ClusterNode {
  name: string
  port?: number
  role: string
  health: VaultNodeHealth | null
  reachable: boolean
  status_code?: number
}

export interface ApiHealth {
  status: 'ok' | 'degraded'
  version: string
  vault: {
    authenticated: boolean
    reachable: boolean
    tokenExpiry?: string
  }
  database: {
    reachable: boolean
    latencyMs?: number
  }
}

export type LifecycleStage =
  | 'generate'
  | 'distribute'
  | 'store'
  | 'use'
  | 'rotate'
  | 'destroy'

export interface LifecycleStageInfo {
  stage: LifecycleStage
  label: string
  demonstrated: boolean
  component?: string
  detail?: string
}

export interface MaturityDimension {
  id: string
  name: string
  score: number
  cls: 'none' | 'low' | 'mid' | 'high'
  basis: string
  nextStep: string | null
}

export interface MaturityCheck {
  id: string
  name: string
  level: number
  passed: boolean
  evidence: string
}

// ── Evidence v2 (Prompt 21) ────────────────────────────────────
export type ControlStatus = 'PASS' | 'FAIL' | 'UNKNOWN' | 'N/A'
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW'

export interface ControlSummary {
  id: string
  requirement: string
  mandatory: boolean
  dimension: string
  status: ControlStatus
}

export interface ControlAssessment {
  id: string
  control_id: string
  scope: string
  status: ControlStatus
  desired_value: Record<string, unknown> | null
  observed_value: Record<string, unknown> | null
  evidence_refs: Record<string, unknown>
  freshness_seconds: number | null
  confidence: ConfidenceLevel
  assessed_at: string
  requirement?: string
  mandatory?: boolean
  dimension?: string
}

// ── Teams (Prompt 27 — control-plane multi-tenancy) ───────────────────────
export interface Team {
  id: string
  name: string
  description?: string | null
  /** null = every supplier (an estate-wide-by-team audit grant) */
  supplier_ids: string[] | null
  environments: string[] | null
  created_by: string
  created_at: string
}

export interface IdentityScope {
  role: string
  envScopes: string[]
  teamScopes: string[]
}

// ── Unified Cryptographic Service Intent View (Phase 25) ──────────────────
// A read-model over Phases 18-21's existing tables/live reads — no new
// domain data. `custody` and `assessment.reconciliation` are arrays, not
// single objects, because a real application can have more than one crypto
// profile (this project's own demo data does — ticket-service, pki-client
// both have two) — see arcanium/api/src/aggregation/intent.js's own header.
export interface IntentCustodyEntry {
  profile_id: string
  key_name: string
  vault_path: string
  type: 'transit' | 'pki' | 'kmip' | 'managed_key'
  custody: string
  /** null = not live-confirmable right now (Vault unreachable), never guessed as false. */
  hsm_backed: boolean | null
  rotation_days: number | null
}

export interface IntentRotationPolicy {
  desired_state_id: string
  key_name: string
  desired_days: number | null
  source: string
  changed_by: string
  changed_reason?: string | null
  updated_at: string
}

export interface IntentReconciliationEntry {
  desired_state_id: string
  key_name: string
  requirement: string
  observation_status: ObservationStatus
  disposition: Disposition
  observed_at: string | null
}

export interface IntentEvidenceEntry {
  kind: 'lifecycle_event' | 'evidence'
  [key: string]: unknown
}

export interface IntentEntryStory {
  labels: ('Lifecycle view' | 'Governance view' | 'Tenant isolation view')[]
  summary: string
}

export interface ApplicationIntent {
  application_id: string
  application: string
  tenant: string
  /** Always null today — Arcanium has no per-application environment concept in the data model yet. */
  environment: string | null
  requirements: { encryption: boolean, signing: boolean, kmip: boolean, tls: boolean }
  custody: IntentCustodyEntry[]
  governance: {
    rotation_policies: IntentRotationPolicy[]
    /** A code invariant, not per-application data — true for every application today. */
    destruction_requires_approval: boolean
    approvals: ApprovalRecord[]
  }
  desired_state: Record<string, unknown>[]
  observed_state: Record<string, unknown>[]
  assessment: {
    reconciliation: IntentReconciliationEntry[]
    controls: ControlAssessment[]
  }
  evidence: IntentEvidenceEntry[]
  entry_story: IntentEntryStory
}

export interface MaturityReport {
  // Prompt 21 — gated, not averaged.
  maturity: number
  level: number           // alias of maturity, backward-compat
  levelName: string
  levelCapReason: string | null
  coverage: number        // 0-100
  confidence: ConfidenceLevel
  controls: ControlSummary[]
  // Prompt 17 — kept as supplementary, non-gating context (Non-goals).
  overall?: number
  dimensions: MaturityDimension[]
  checks: MaturityCheck[]
  generatedAt: string
}

export interface ProvisioningStep {
  step: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  detail?: string | Record<string, unknown> | null
  at?: string
}

export interface ProvisioningJob {
  id: string
  target_type: 'supplier' | 'application' | 'key'
  target_id: string
  target_name: string | null
  action: 'provision' | 'deprovision' | 'rotate' | 'rewrap' | 'destroy'
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'rolled_back'
  steps: ProvisioningStep[]
  error: string | null
  requested_by: string
  request_id?: string | null
  stuck_age_seconds?: number
  created_at: string
  updated_at: string
}
