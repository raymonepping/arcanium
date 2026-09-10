import type { ClusterNode } from '~/types/arcanium'
export function nodeHealth(node: ClusterNode): string {
  if (!node.reachable || !node.health) return 'unreachable'
  if (!node.health.initialized) return 'uninitialized'
  if (node.health.sealed) return 'sealed'
  if ([474, 530].includes(node.status_code || 0)) return 'degraded'
  return 'healthy'
}
export function nodeRole(node: ClusterNode): string {
  if (!node.health) return 'Role unknown'
  if (node.name === 'vault-s') return 'Seal provider'
  if (node.name === 'vault-hsm') return 'HSM seal provider'
  if (node.health.performance_standby) return 'Performance standby'
  return node.health.standby ? 'Standby · ready' : 'Active leader'
}
