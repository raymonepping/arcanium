// composables/useArcaniumApi.ts
// Central typed API client. All fetches go through /gateway (same-origin proxy).

import type {
  Supplier, Application, TransitKey, ApprovalRecord, ApiHealth, ClusterNode, MaturityReport, ProvisioningJob,
  ReconciliationRow, ReconciliationDetail, ApplicationIntent, Team
} from '~/types/arcanium'
// Prompt 22, Deliverable 2 — openapi/arcanium.yaml is the one authoritative
// contract; these return types are generated from it (`make openapi-generate`
// / `npm run generate:api-types`), not hand-declared a second time, for
// exactly the shapes that already drifted once before (Prompt 16's evidence
// shape change). Structurally compatible with the hand-declared types above
// (same fields), so existing pages that still import those directly for
// prop typing keep working unchanged.
import type { components } from '~/types/api.generated'
type GenApplication = components['schemas']['Application']
type GenEvidenceResponse = components['schemas']['EvidenceResponse']
type GenReconciliationRow = components['schemas']['ReconciliationRow']

export function useArcaniumApi() {
  const config = useRuntimeConfig()
  const base = config.public.apiBase as string

  function $get<T>(path: string) {
    return $fetch<T>(`${base}${path}`, { timeout: 10000 })
  }

  function $post<T>(path: string, body?: unknown) {
    return $fetch<T>(`${base}${path}`, { method: 'POST', body })
  }

  function $patch<T>(path: string, body?: unknown) {
    return $fetch<T>(`${base}${path}`, { method: 'PATCH', body })
  }

  function $delete<T>(path: string) {
    return $fetch<T>(`${base}${path}`, { method: 'DELETE' })
  }

  const api = {
    cluster: () => $get<ClusterNode[]>('/api/v1/cluster'),
    maturity: () => $get<MaturityReport>('/api/v1/maturity'),

    // ── Provisioning jobs (Prompt 14.2) ────────────────────
    jobs: (opts?: { status?: string }) =>
      $get<ProvisioningJob[]>(`/api/v1/jobs${opts?.status ? `?status=${opts.status}` : ''}`),
    job: (id: string) => $get<ProvisioningJob>(`/api/v1/jobs/${id}`),
    provisionApplication: (id: string, body: { custody?: string; key_type?: string; capabilities?: string[]; rotation_days?: number; tls?: boolean }) =>
      $post<{ provisioning_job: ProvisioningJob }>(`/api/v1/applications/${encodeURIComponent(id)}/provision`, body),
    rotateKey: (name: string) =>
      $post<{ provisioning_job: ProvisioningJob }>(`/api/v1/keys/${encodeURIComponent(name)}/rotate`),
    rewrapKey: (name: string, ciphertext: string) =>
      $post<{ ciphertext: string }>(`/api/v1/keys/${encodeURIComponent(name)}/rewrap`, { ciphertext }),
    destroyKey: (name: string) =>
      $post<{ approval: ApprovalRecord; message: string }>(`/api/v1/keys/${encodeURIComponent(name)}/destroy`),

    // ── Auth (Prompt 18 — OIDC) ────────────────────────────
    // Sign-in is a full-page navigation to /gateway/api/v1/auth/login, not a
    // fetch call — see app/pages/login.vue. There is no username/password
    // API call any more; Express is the OIDC client end-to-end.
    me: () => $get<{ enabled: boolean; user: string; persona: string; namespaces: string[]; groups?: string[]; scopes?: import('~/types/arcanium').IdentityScope[]; demoSwitch?: boolean }>('/api/v1/auth/me'),
    logout: () => $post<{ ok: boolean; logoutUrl: string | null }>('/api/v1/auth/logout'),
    setDemoPersona: (persona: string) => $post<{ persona: string }>('/api/v1/auth/demo-persona', { persona }),

    // ── Platform / distribution (Prompt 14.3–14.4) ────────
    entitlements: () => $get<{ features: string[]; capabilities: Record<string, boolean>; source: string }>('/api/v1/platform/entitlements'),
    keymgmt: () => $get<{ available: boolean; reason?: string; engine?: string; keys?: any[]; providers?: any[]; emulated?: boolean; note?: string | null; hint?: string }>('/api/v1/keymgmt'),
    keymgmtRotate: (name: string) =>
      $post<{ key: string; latest_version: number | null }>(`/api/v1/keymgmt/${encodeURIComponent(name)}/rotate`),
    keymgmtSync: (name: string, provider: string) =>
      $post<{ key: string; provider: string; distributed: boolean; versions: number }>(`/api/v1/keymgmt/${encodeURIComponent(name)}/sync`, { provider }),

    // ── External integration channels (Prompt 15.4) ───────
    integrations: () => $get<{ channels: any[]; summary: { total: number; connected: number; observed: number } }>('/api/v1/integrations'),
    // ── Evidence trail (Prompt 15.3 · 16.6) ──────────────
    evidenceTrail: (opts?: { source?: string; operation?: string; outcome?: string; origin?: string; stage?: string }) => {
      const q = new URLSearchParams(Object.entries(opts ?? {}).filter(([, v]) => v) as [string, string][]).toString()
      return $get<GenEvidenceResponse>(`/api/v1/evidence${q ? `?${q}` : ''}`)
    },
    supplierIsolation: () => $get<{ verified: boolean; checked_at: string; tenants: string[]; directions: { from: string; to: string; kind: string; outcome: string; pass: boolean }[]; note: string | null }>('/api/v1/suppliers/isolation'),
    createSupplier: (body: Pick<Supplier, 'name' | 'vault_namespace' | 'sla_tier'>) => $post<Supplier>('/api/v1/suppliers', body),
    updateSupplier: (id: string, body: Partial<Supplier>) => $patch<Supplier>(`/api/v1/suppliers/${encodeURIComponent(id)}`, body),
    deleteSupplier: (id: string) => $delete<void>(`/api/v1/suppliers/${encodeURIComponent(id)}`),

    // ── Teams (Prompt 27) ──────────────────────────────────
    teams: () => $get<Team[]>('/api/v1/teams'),
    team: (id: string) => $get<Team>(`/api/v1/teams/${encodeURIComponent(id)}`),
    createTeam: (body: Pick<Team, 'name'> & Partial<Team>) => $post<Team>('/api/v1/teams', body),
    updateTeam: (id: string, body: Partial<Team>) => $patch<Team>(`/api/v1/teams/${encodeURIComponent(id)}`, body),
    deleteTeam: (id: string) => $delete<void>(`/api/v1/teams/${encodeURIComponent(id)}`),
    // ── Reconciliation (Prompt 20) ────────────────────────
    reconciliationList: (opts?: { status?: string; disposition?: string }) => {
      const q = new URLSearchParams(Object.entries(opts ?? {}).filter(([, v]) => v) as [string, string][]).toString()
      return $get<GenReconciliationRow[]>(`/api/v1/reconciliation${q ? `?${q}` : ''}`)
    },
    reconciliationDetail: (runId: string) => $get<ReconciliationDetail>(`/api/v1/reconciliation/${encodeURIComponent(runId)}`),
    // ── Controls / Evidence v2 (Prompt 21) ─────────────────
    controls: () => $get<any[]>('/api/v1/controls'),
    control: (id: string) => $get<any>(`/api/v1/controls/${encodeURIComponent(id)}`),
    runReconciliation: (desiredStateId?: string) =>
      $post<any[]>('/api/v1/reconciliation/run', desiredStateId ? { desired_state_id: desiredStateId } : {}),
    reconcileRun: (runId: string) => $post<{ action: any; confirmation_run: any }>(`/api/v1/reconciliation/${encodeURIComponent(runId)}/reconcile`),
    acceptException: (runId: string, reason: string, expiresAt: string) =>
      $post<any>(`/api/v1/reconciliation/${encodeURIComponent(runId)}/accept-exception`, { reason, expires_at: expiresAt }),
    setDesiredState: (desiredStateId: string, days: number, reason?: string) =>
      $patch<any>(`/api/v1/reconciliation/desired-state/${encodeURIComponent(desiredStateId)}`, { desired_value: { days }, reason }),

    // ── Health ─────────────────────────────────────────────
    health: () => $get<ApiHealth>('/health'),
    /** @deprecated use health() */
    getHealth: () => $get<ApiHealth>('/health'),

    // ── Suppliers ──────────────────────────────────────────
    suppliers: () => $get<Supplier[]>('/api/v1/suppliers'),
    supplier:  (id: string) => $get<Supplier>(`/api/v1/suppliers/${id}`),
    supplierApplications: (id: string) => $get<Application[]>(`/api/v1/suppliers/${id}/applications`),
    supplierKeys: (id: string) => $get<TransitKey[] | string[]>(`/api/v1/suppliers/${id}/keys`),

    // ── Applications ───────────────────────────────────────
    applications: () => $get<GenApplication[]>('/api/v1/applications'),
    application:  (id: string) => $get<GenApplication>(`/api/v1/applications/${id}`),
    createApplication: (body: Partial<Application>) => $post<Application>('/api/v1/applications', body),
    updateApplication: (id: string, body: Partial<Application>) => $patch<Application>(`/api/v1/applications/${id}`, body),
    deleteApplication: (id: string) => $delete<void>(`/api/v1/applications/${id}`),
    // ── Unified Intent View (Prompt 25) ────────────────────
    applicationIntent: (id: string) => $get<ApplicationIntent>(`/api/v1/applications/${encodeURIComponent(id)}/intent`),

    // ── Keys ───────────────────────────────────────────────
    keys: () => $get<TransitKey[]>('/api/v1/keys'),
    key:  (name: string) => $get<TransitKey>(`/api/v1/keys/${name}`),
    createKey: (body: Partial<TransitKey>) => $post<TransitKey>('/api/v1/keys', body),

    // ── PKI ────────────────────────────────────────────────
    pkiCaChain: () => $get<string>('/api/v1/pki/ca-chain'),
    pkiRoles:   () => $get<string[]>('/api/v1/pki/roles'),

    // ── Approvals ──────────────────────────────────────────
    /**
     * Fetch approvals. Pass { all: true } to include resolved records.
     * Returns only pending records by default (matches API behaviour).
     */
    approvals: (opts?: { all?: boolean }) =>
      $get<ApprovalRecord[]>(`/api/v1/approvals${opts?.all ? '?all=true' : ''}`),

    createApproval: (body: {
      app_id: string
      key_name: string
      action: string
      requester: string
      reason?: string
      supplier_id?: string
    }) => $post<ApprovalRecord>('/api/v1/approvals', body),

    approveRecord: (id: string, reason?: string) =>
      $post<ApprovalRecord>(`/api/v1/approvals/${id}/approve`, reason ? { reason } : undefined),

    denyRecord: (id: string, reason?: string) =>
      $post<ApprovalRecord>(`/api/v1/approvals/${id}/deny`, reason ? { reason } : undefined),

    authorizeAccessor: (accessor: string) =>
      $post<{ success: boolean }>(`/api/v1/approvals/${accessor}/authorize`),
  }

  return api
}
