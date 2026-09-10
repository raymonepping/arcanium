// composables/useArcaniumApi.ts
// Central typed API client. All fetches go through /gateway (same-origin proxy).

import type {
  Supplier, Application, TransitKey, ApprovalRecord, ApiHealth, ClusterNode, MaturityReport, ProvisioningJob
} from '~/types/arcanium'

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

    // ── Auth (Prompt 14.5) ────────────────────────────────
    me: () => $get<{ enabled: boolean; user: string; persona: string; namespaces: string[]; demoSwitch?: boolean }>('/api/v1/auth/me'),
    login: (username: string, password: string) => $post<{ user: string; persona: string }>('/api/v1/auth/login', { username, password }),
    logout: () => $post<{ ok: boolean }>('/api/v1/auth/logout'),
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
      return $get<{ rows: any[]; stage_counts: Record<string, number>; total: number }>(`/api/v1/evidence${q ? `?${q}` : ''}`)
    },
    supplierIsolation: () => $get<{ verified: boolean; checked_at: string; tenants: string[]; directions: { from: string; to: string; kind: string; outcome: string; pass: boolean }[]; note: string | null }>('/api/v1/suppliers/isolation'),
    createSupplier: (body: Pick<Supplier, 'name' | 'vault_namespace' | 'sla_tier'>) => $post<Supplier>('/api/v1/suppliers', body),
    updateSupplier: (id: string, body: Partial<Supplier>) => $patch<Supplier>(`/api/v1/suppliers/${encodeURIComponent(id)}`, body),
    deleteSupplier: (id: string) => $delete<void>(`/api/v1/suppliers/${encodeURIComponent(id)}`),
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
    applications: () => $get<Application[]>('/api/v1/applications'),
    application:  (id: string) => $get<Application>(`/api/v1/applications/${id}`),
    createApplication: (body: Partial<Application>) => $post<Application>('/api/v1/applications', body),
    updateApplication: (id: string, body: Partial<Application>) => $patch<Application>(`/api/v1/applications/${id}`, body),
    deleteApplication: (id: string) => $delete<void>(`/api/v1/applications/${id}`),

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
