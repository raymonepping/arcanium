import type { Application, ApprovalRecord, Supplier, TransitKey } from '~/types/arcanium'
type Dimension = { id: string; name: string; score: number | null; basis: string; scope: string; to: string }
const percent = (n: number, d: number) => d ? Math.round(n / d * 100) : null
// These are transparent API coverage measures, not a certified maturity grade.
export function maturityDimensions(keys: TransitKey[] | null, apps: Application[] | null, approvals: ApprovalRecord[] | null, suppliers: Supplier[] | null): Dimension[] {
  const metadata = keys?.filter(k => typeof k.exportable === 'boolean' && typeof k.auto_rotate_period === 'number') || []
  const protectedKeys = metadata.filter(k => k.exportable === false).length
  const rotated = metadata.filter(k => (k.auto_rotate_period || 0) > 0).length
  const scoped = apps?.filter(a => a.supplier_id && suppliers?.some(s => s.id === a.supplier_id)).length || 0
  const validNamespaces = suppliers?.filter(s => !!s.vault_namespace).length || 0
  const resolved = approvals?.filter(a => a.status !== 'pending').length || 0
  const governedApps = new Set(approvals?.map(a => a.app_id) || []).size
  const complete = approvals?.filter(a => ['manual','local','external'].includes(a.source) && a.requester && a.action && a.app_id && a.created_at).length || 0
  const automated = approvals?.filter(a => ['local','external'].includes(a.source)).length || 0
  const attributed = approvals?.filter(a => ['manual','local','external'].includes(a.source)).length || 0
  return [
    { id: 'lifecycle', name: 'Key Lifecycle Hygiene', score: keys?.length && metadata.length === keys.length ? percent(protectedKeys + rotated, keys.length * 2) : null,
      basis: `${protectedKeys}/${keys?.length ?? '?'} keys confirmed non-exportable; ${rotated}/${keys?.length ?? '?'} with automatic rotation.`, scope: 'Equal weight: non-exportability and automatic rotation. Minimum decryption version is not a rotation policy. Unknown metadata is not a pass.', to: '/keys' },
    { id: 'access', name: 'Access Control Coverage', score: apps && suppliers ? percent(validNamespaces + scoped, suppliers.length + apps.length) : null,
      basis: `${validNamespaces}/${suppliers?.length ?? '?'} supplier namespace references; ${scoped}/${apps?.length ?? '?'} applications assigned to registered suppliers.`, scope: 'Registry scoping coverage only. Unassigned root workloads are visible gaps in tenant assignment, not proof of missing Vault ACLs. Policy verification is not measured.', to: '/suppliers' },
    { id: 'governance', name: 'Governance Adoption', score: approvals?.length ? percent(approvals.filter(a => a.requester && a.action && a.key_name && a.app_id).length, approvals.length) : null,
      basis: `${approvals?.length ?? '?'} requests across ${governedApps} applications; ${resolved} resolved and ${(approvals?.length || 0) - resolved} pending.`, scope: 'Required governance metadata coverage. Pending requests remain governed; queue resolution is reported separately. This does not measure Vault-native enforcement or coverage of all crypto operations.', to: '/approvals' },
    { id: 'audit', name: 'Audit Trail Completeness', score: approvals ? percent(complete, approvals.length) : null,
      basis: `${complete}/${approvals?.length ?? '?'} governance records contain source, actor, action, application and timestamp.`, scope: 'Completeness of available approval records only. Full Vault audit/workload ingestion and tamper-evident retention are not assessed.', to: '/evidence' },
    { id: 'automation', name: 'Automation Depth', score: approvals ? percent(automated, attributed) : null,
      basis: `${automated}/${attributed} attributed requests originate from local or external integrations.`, scope: 'Observed request automation, not full lifecycle automation. Registration alone does not demonstrate automation. Sources are caller-declared; telemetry verification is pending.', to: '/evidence' },
  ]
}
