import type { ClusterNode } from '~/types/arcanium'
import { nodeHealth } from '~/utils/cluster'
export function useClusterHealth() {
  const api = useArcaniumApi()
  const nodes = useState<ClusterNode[]>('clusterNodes', () => [])
  const loading = useState('clusterLoading', () => false)
  const error = useState('clusterError', () => '')
  const lastFetch = useState<string | null>('clusterLastFetch', () => null)
  const healthyCount = computed(() => nodes.value.filter(n => nodeHealth(n) === 'healthy').length)
  const status = computed(() => {
    if (error.value) return { healthy: false, degraded: false, unknown: true, summary: 'Cluster status unavailable. Last successful observation may be stale.' }
    if (!lastFetch.value) return null
    const healthy = nodes.value.length > 0 && healthyCount.value === nodes.value.length
    return { healthy, degraded: !healthy && healthyCount.value > 0, unknown: false, summary: `${healthyCount.value}/${nodes.value.length} nodes operational · active and standby nodes included` }
  })
  async function refresh() {
    if (loading.value) return
    loading.value = true
    try {
      const data = await api.cluster()
      if (!Array.isArray(data) || !data.length) throw new Error('Invalid health response')
      nodes.value = data
      lastFetch.value = new Date().toISOString()
      error.value = ''
    } catch { error.value = 'Cluster status unavailable. Retry the health check.' }
    finally { loading.value = false }
  }
  const leader = computed(() => nodes.value.find(n => n.role === 'cluster-member' && nodeHealth(n) === 'healthy' && !n.health?.standby))
  return { nodes, loading, error, lastFetch, refresh, leader, healthyCount, degraded: computed(() => !status.value?.healthy), status }
}
