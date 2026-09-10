<template>
  <div>

    <div v-if="loading" class="state-loading"><div class="spinner" /><span>Loading cluster…</span></div>
    <div v-else-if="error" class="state-error"><div class="error-icon">⚠</div><p>{{ error }}</p></div>
    <div v-else>
      <!-- Summary banner -->
      <div class="cluster-summary" :class="summaryClass">
        <span class="summary-dot" />
        <span class="summary-label">{{ summaryLabel }}</span>
        <span class="summary-sub">{{ nodes.length }} nodes configured</span>
      </div>

      <!-- Topology strip (Prompt 16.3) — live health, declared seal/raft edges -->
      <div class="topo-wrap">
        <ClusterTopology :nodes="nodes" />
        <p class="topo-note">Seal and raft relationships are the configured architecture; node state is the live health poll, identical to the cards below.</p>
      </div>

      <!-- Node cards -->
      <div class="node-grid">
        <div
          v-for="node in nodes"
          :key="node.name"
          class="node-card"
          :class="nodeClass(node)"
        >
          <div class="node-card-header">
            <div class="node-status-dot" />
            <div class="node-name-block">
              <div class="node-name">{{ node.name }}</div>
              <div class="node-role-label">{{ nodeRole(node) }}</div>
            </div>
            <div class="node-status-badge" :class="nodeClass(node)">{{ nodeClass(node) }}</div>
          </div>

          <div v-if="node.health" class="node-details">
            <div class="node-prop"><span class="np-l">Version</span><span class="np-v mono">{{ node.health.version }}</span></div>
            <div class="node-prop"><span class="np-l">Initialized</span><span class="np-v">{{ node.health.initialized ? 'Yes' : 'No' }}</span></div>
            <div class="node-prop"><span class="np-l">Sealed</span><span class="np-v" :class="{ danger: node.health.sealed }">{{ node.health.sealed ? '⚠ Sealed' : 'No' }}</span></div>
            <div class="node-prop" v-if="node.health.cluster_name">
              <span class="np-l">Cluster</span>
              <span class="np-v mono">{{ node.health.cluster_name }}</span>
            </div>
            <div class="node-prop" v-if="node.health.replication_performance_mode && node.health.replication_performance_mode !== 'disabled'">
              <span class="np-l">Replication</span>
              <span class="np-v">{{ node.health.replication_performance_mode }}</span>
            </div>
            <div class="node-prop" v-if="node.health.ha_enabled !== undefined">
              <span class="np-l">HA</span>
              <span class="np-v">{{ node.health.ha_enabled ? 'Enabled' : 'Disabled' }}</span>
            </div>
          </div>
          <div v-else class="node-unreachable">Node unreachable or health check failed</div>
        </div>
      </div>

      <!-- Replication note -->
      <div class="info-notice">
        <svg viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1"/><line x1="7" y1="4" x2="7" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="7" cy="10" r="0.6" fill="currentColor"/></svg>
        Node health is polled from the Arcanium API server-side; topology reflects configured architecture.
        Raft WAL / replication-lag time-series are collected by Prometheus (see Observability) and not surfaced here yet.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { nodeHealth, nodeRole as healthRole } from '~/utils/cluster'
import { useClusterHealth } from '~/composables/useClusterHealth'

definePageMeta({ layout: 'default' })
useHead({ title: 'Cluster Health' })

const { nodes, loading, error, refresh } = useClusterHealth()

const summaryClass = computed(() => {
  if (!nodes.value.length) return 'unknown'
  const allHealthy = nodes.value.every(n => nodeHealth(n) === 'healthy')
  if (allHealthy) return 'healthy'
  const anySealed = nodes.value.some(n => n.health?.sealed)
  return anySealed ? 'critical' : 'degraded'
})
const summaryLabel = computed(() => ({
  healthy: 'All nodes operational',
  degraded: 'Cluster degraded',
  critical: 'Critical — sealed nodes detected',
  unknown: 'Status unknown',
}[summaryClass.value] ?? 'Status unknown'))

const nodeClass = nodeHealth
const nodeRole = healthRole

// The persistent layout owns shared health polling (5 seconds).
</script>

<style scoped>
.state-loading, .state-error {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 20px; gap: 12px; color: var(--arc-text-muted);
}
.spinner { width: 32px; height: 32px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-icon { font-size: 28px; color: var(--arc-critical); }

.cluster-summary {
  display: flex; align-items: center; gap: 12px; padding: 16px 20px;
  border-radius: 10px; margin-bottom: 20px; font-size: 14px; font-weight: 600;
}
.cluster-summary.healthy { background: var(--arc-healthy-bg); color: var(--arc-healthy); border: 1px solid rgba(34,197,94,0.2); }
.cluster-summary.degraded { background: rgba(244,140,6,0.08); color: var(--arc-warning); border: 1px solid rgba(244,140,6,0.2); }
.cluster-summary.critical { background: var(--arc-critical-bg); color: var(--arc-critical); border: 1px solid rgba(220,47,2,0.2); }
.cluster-summary.unknown { background: rgba(125,133,151,0.08); color: var(--arc-text-muted); border: 1px solid var(--arc-border-subtle); }
.summary-dot { width: 10px; height: 10px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.summary-sub { margin-left: auto; font-size: 12px; opacity: 0.7; }

.topo-wrap { border: 1px solid var(--arc-glass-border); border-radius: 12px; background: rgba(0,8,24,0.35); padding: 6px 14px 12px; margin-bottom: 18px; }
.topo-note { font-size: 11px; color: var(--arc-text-muted); margin: 0; line-height: 1.5; }

.node-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; margin-bottom: 16px; }

.node-card {
  background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle);
  border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 14px;
}
.node-card.healthy { border-color: rgba(34,197,94,0.3); }
.node-card.sealed { border-color: rgba(220,47,2,0.3); background: rgba(220,47,2,0.02); }
.node-card.unreachable { border-color: var(--arc-border-subtle); opacity: 0.6; }

.node-card-header { display: flex; align-items: center; gap: 10px; }
.node-status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.healthy .node-status-dot { background: var(--arc-healthy); }
.standby .node-status-dot, .perf-standby .node-status-dot { background: var(--arc-action-bright); }
.sealed .node-status-dot { background: var(--arc-critical); }
.unreachable .node-status-dot { background: var(--arc-text-dim); }
.node-name-block { flex: 1; }
.node-name { font-size: 14px; font-weight: 600; color: var(--arc-text-primary); }
.node-role-label { font-size: 11px; color: var(--arc-text-muted); }
.node-status-badge {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
  padding: 2px 8px; border-radius: 4px;
}
.node-status-badge.healthy { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.node-status-badge.standby, .node-status-badge.perf-standby { background: rgba(0,119,182,0.1); color: var(--arc-action-bright); }
.node-status-badge.sealed { background: var(--arc-critical-bg); color: var(--arc-critical); }
.node-status-badge.unreachable { background: rgba(125,133,151,0.1); color: var(--arc-text-muted); }

.node-details { display: flex; flex-direction: column; gap: 8px; }
.node-prop { display: flex; gap: 10px; align-items: baseline; }
.np-l { font-size: 11px; color: var(--arc-text-muted); width: 90px; flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.04em; }
.np-v { font-size: 12px; color: var(--arc-text-secondary); }
.np-v.danger { color: var(--arc-critical); font-weight: 600; }
.mono { font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace; color: var(--arc-action-bright); }

.node-unreachable { font-size: 12px; color: var(--arc-text-muted); font-style: italic; }

.info-notice {
  display: flex; align-items: flex-start; gap: 8px; padding: 12px 16px;
  background: rgba(255,255,255,0.02); border: 1px solid var(--arc-border-subtle);
  border-radius: 8px; font-size: 12px; color: var(--arc-text-muted); line-height: 1.6;
}
.info-notice svg { width: 14px; height: 14px; flex-shrink: 0; margin-top: 2px; }
</style>
