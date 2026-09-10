<script setup lang="ts">
// Prompt 16.3 — compact cluster topology strip.
// A second view of the SAME live health already in `nodes`; only the seal / raft
// edges are declared architecture (and labelled as such). No graph library.
import type { ClusterNode } from '~/types/arcanium'
import { nodeHealth } from '~/utils/cluster'

const props = defineProps<{ nodes: ClusterNode[] }>()

const by = (name: string) => props.nodes.find(n => n.name === name)
const raft = computed(() => ['vault-1', 'vault-2', 'vault-3'].map(by).filter(Boolean) as ClusterNode[])

function cls(n?: ClusterNode) {
  if (!n) return 'unknown'
  const h = nodeHealth(n)
  if (h !== 'healthy') return h
  if (n.name === 'vault-s' || n.name === 'vault-hsm') return 'provider'
  return n.health?.standby ? 'standby' : 'active'
}
function label(n?: ClusterNode) {
  if (!n) return '—'
  const h = nodeHealth(n)
  if (h === 'sealed') return 'sealed'
  if (h === 'unreachable') return 'unreachable'
  if (n.name === 'vault-s') return 'transit seal'
  if (n.name === 'vault-hsm') return 'PKCS#11 / HSM seal'
  return n.health?.standby ? 'standby' : 'ACTIVE'
}
</script>

<template>
  <div class="topo" role="img" aria-label="Vault cluster topology: vault-s seal provider unseals the vault-1/2/3 raft cluster; vault-hsm is a separate HSM-sealed node">
    <div class="topo-node" :class="cls(by('vault-s'))">
      <span class="tn-name">vault-s</span>
      <span class="tn-role">{{ label(by('vault-s')) }}</span>
    </div>

    <span class="topo-edge"><span class="te-line" /><span class="te-tag">seal</span><span class="te-arrow">▶</span></span>

    <div class="topo-raft">
      <span class="tr-tag">raft cluster</span>
      <div class="tr-nodes">
        <div v-for="n in raft" :key="n.name" class="topo-node sm" :class="cls(n)">
          <span class="tn-name">{{ n.name }}</span>
          <span class="tn-role">{{ label(n) }}</span>
        </div>
      </div>
    </div>

    <span class="topo-edge"><span class="te-line" /><span class="te-tag">seal</span><span class="te-arrow">▶</span></span>

    <div class="topo-node" :class="cls(by('vault-hsm'))">
      <span class="tn-name">vault-hsm</span>
      <span class="tn-role">{{ label(by('vault-hsm')) }}</span>
    </div>
  </div>
</template>

<style scoped>
.topo { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 14px 4px; }
.topo-node { display: flex; flex-direction: column; gap: 3px; padding: 10px 14px; border-radius: 10px; border: 1px solid var(--arc-border-strong); background: var(--arc-bg-card); min-width: 96px; }
.topo-node.sm { min-width: 84px; padding: 8px 11px; }
.topo-node.active { border-color: rgba(34,197,94,0.45); }
.topo-node.standby { border-color: rgba(0,180,216,0.4); }
.topo-node.provider { border-color: var(--arc-border-strong); background: rgba(0,8,24,0.5); }
.topo-node.sealed, .topo-node.unreachable, .topo-node.degraded { border-color: rgba(220,47,2,0.5); background: rgba(220,47,2,0.04); }
.tn-name { font-family: ui-monospace, monospace; font-size: 12px; font-weight: 600; color: var(--arc-text-primary); }
.tn-role { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--arc-text-muted); }
.topo-node.active .tn-role { color: var(--arc-healthy); }
.topo-node.standby .tn-role { color: var(--arc-action-bright); }
.topo-node.sealed .tn-role, .topo-node.unreachable .tn-role, .topo-node.degraded .tn-role { color: var(--arc-critical); }

.topo-edge { display: flex; align-items: center; gap: 3px; padding: 0 2px; }
.te-line { width: 14px; height: 1px; background: var(--arc-border-strong); }
.te-tag { font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-dim); }
.te-arrow { font-size: 8px; color: var(--arc-text-dim); }

.topo-raft { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border: 1px dashed var(--arc-border-strong); border-radius: 12px; }
.tr-tag { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--arc-text-muted); text-align: center; }
.tr-nodes { display: flex; gap: 6px; flex-wrap: wrap; }

@media (max-width: 720px) { .topo { justify-content: center; } .topo-edge { transform: rotate(90deg); } }
</style>
