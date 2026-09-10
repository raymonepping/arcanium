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
  created_at: string
  updated_at: string
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

export interface MaturityReport {
  overall: number
  level: number
  levelName: string
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
  created_at: string
  updated_at: string
}
