<template>
  <div class="integ">
    <section class="arc-hero integ-hero">
      <div>
        <p class="hero-eyebrow">External koppelingen</p>
        <h2 class="hero-title">Integration channels</h2>
        <p class="hero-sub">
          External parties reach Arcanium through registered channels — each one
          approval-gated or namespace-scoped. An external party never holds a
          broad Vault token.
        </p>
      </div>
      <div class="sum">
        <div><span>{{ data?.summary.total ?? '—' }}</span>channels</div>
        <div><span class="ok">{{ data?.summary.connected ?? 0 }}</span>connected</div>
        <div><span>{{ data?.summary.observed ?? 0 }}</span>observed</div>
      </div>
    </section>

    <div class="legend">
      <span><span class="dot declared" /> <strong>Declared</strong> — a registered contract, no traffic yet</span>
      <span><span class="dot connected" /> <strong>Observed</strong> — heart-beating, real evidence in the trail</span>
    </div>

    <div v-if="loading" class="state"><div class="spinner" /><span>Loading channels…</span></div>
    <div v-else-if="!channels.length" class="state">No integration channels registered.</div>

    <div v-else class="chan-grid">
      <article v-for="c in channels" :key="c.id" class="chan-card" :class="c.status">
        <header class="cc-head">
          <div>
            <h3 class="cc-name">{{ c.name }}</h3>
            <p class="cc-scope">External · tenant {{ c.supplier || '—' }}</p>
          </div>
          <span class="cc-state" :class="c.status">
            <span class="cc-dot" :class="c.status" />
            {{ stateLabel(c) }}
          </span>
        </header>

        <p class="cc-op"><code>{{ c.operation || c.kind }}</code> · {{ c.kind }}</p>

        <dl class="cc-facts">
          <div><dt>Last seen</dt><dd>{{ c.last_seen ? rel(c.last_seen) : 'never' }}</dd></div>
          <div v-if="c.pending"><dt>Pending</dt><dd>{{ c.pending }} approval{{ c.pending === 1 ? '' : 's' }}</dd></div>
          <div><dt>Source</dt><dd>external</dd></div>
          <div><dt>Governed by</dt><dd>{{ c.governed_by }}</dd></div>
          <div v-if="!c.observed"><dt>State</dt><dd>registered · workload scaffolded · awaiting first call</dd></div>
        </dl>
      </article>
    </div>

    <p class="foot">
      <code>external-supplier</code> is a running workload requesting Transit encryption through the
      four-eyes approval flow — being blocked on an approval is a governance state, not a fault, so it
      stays <strong>connected</strong> while it waits. <code>external-partner-pki</code> is a declared
      PKI-issuance channel, its workload scaffolded, awaiting connection. Both attribute their activity
      as <strong>source: external</strong> in the Evidence trail.
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useArcaniumApi } from '~/composables/useArcaniumApi'

definePageMeta({ layout: 'default' })
useHead({ title: 'Integration Channels' })

const { integrations } = useArcaniumApi()
const loading = ref(true)
const data = ref<any>(null)
const channels = computed<any[]>(() => data.value?.channels ?? [])

function rel(ts: string) {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}
function stateLabel(c: any) {
  if (c.status === 'connected') return c.awaiting_approval ? `Connected · awaiting approval (${c.pending})` : 'Connected'
  if (c.status === 'degraded') return 'Degraded'
  if (c.status === 'stale') return 'Stale'
  if (c.status === 'retired') return 'Retired'
  return 'Declared'
}
async function load() {
  try { data.value = await integrations() } catch { /* */ } finally { loading.value = false }
}
onMounted(load)
usePolling(load, 15000)
</script>

<style scoped>
.integ { display: flex; flex-direction: column; gap: 16px; }
.integ-hero { display: flex; gap: 28px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.hero-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--arc-action-bright); margin: 0 0 6px; }
.hero-title { font-size: 22px; font-weight: 750; letter-spacing: -0.02em; color: var(--arc-text-primary); margin: 0 0 8px; }
.hero-sub { font-size: 12.5px; color: var(--arc-text-muted); line-height: 1.6; max-width: 480px; margin: 0; }
.sum { display: flex; gap: 22px; }
.sum div { display: flex; flex-direction: column; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-muted); }
.sum span { font-size: 22px; font-weight: 800; color: var(--arc-text-primary); font-variant-numeric: tabular-nums; }
.sum span.ok { color: var(--arc-healthy); }

.legend { display: flex; gap: 20px; flex-wrap: wrap; font-size: 11px; color: var(--arc-text-muted); }
.legend strong { color: var(--arc-text-secondary); }
.legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; vertical-align: middle; margin-right: 4px; }
.legend .dot.declared { background: var(--arc-text-dim); }
.legend .dot.connected { background: var(--arc-healthy); }

.state { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 60px; color: var(--arc-text-muted); font-size: 13px; }
.spinner { width: 22px; height: 22px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.chan-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.chan-card { border: 1px solid var(--arc-glass-border); border-radius: 14px; background: var(--arc-glass); padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.chan-card.connected { border-color: rgba(34,197,94,0.3); }
.chan-card.degraded, .chan-card.stale { border-color: rgba(244,140,6,0.3); }
.cc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.cc-name { font-size: 13px; font-weight: 700; color: var(--arc-text-primary); margin: 0; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
.cc-scope { font-size: 11px; color: var(--arc-text-muted); margin: 3px 0 0; }
.cc-state { display: inline-flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 3px 8px; border-radius: 100px; white-space: nowrap; background: rgba(125,133,151,0.14); color: var(--arc-text-muted); }
.cc-state.connected { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.cc-state.degraded, .cc-state.stale { background: var(--arc-pending-bg); color: var(--arc-governance); }
.cc-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.cc-op { font-size: 11.5px; color: var(--arc-text-secondary); margin: 0; }
.cc-op code { font-family: ui-monospace, monospace; color: var(--arc-action-bright); }
.cc-facts { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.cc-facts > div { display: flex; justify-content: space-between; gap: 12px; font-size: 11.5px; }
.cc-facts dt { color: var(--arc-text-muted); text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; }
.cc-facts dd { margin: 0; color: var(--arc-text-secondary); text-align: right; }

.foot { font-size: 11px; color: var(--arc-text-muted); line-height: 1.6; max-width: 780px; margin: 0; }
.foot code { color: var(--arc-action-bright); font-family: ui-monospace, monospace; }
</style>
