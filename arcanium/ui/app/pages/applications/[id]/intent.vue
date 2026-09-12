<template>
  <div>
    <div v-if="loading" class="state-loading"><div class="spinner" /><span>Loading intent view…</span></div>
    <div v-else-if="error" class="state-error"><div class="error-icon">⚠</div><p>{{ error }}</p></div>
    <div v-else-if="intent">
      <div class="breadcrumb">
        <NuxtLink to="/applications" class="bc-link">Applications</NuxtLink>
        <span class="bc-sep">›</span>
        <NuxtLink :to="`/applications/${intent.application_id}`" class="bc-link">{{ intent.application }}</NuxtLink>
        <span class="bc-sep">›</span>
        <span class="bc-current">Intent</span>
      </div>

      <h2 class="page-title">{{ intent.application }} — Unified Intent</h2>

      <!-- Entry-story framing (Deliverable 3) — computed, never hardcoded -->
      <div class="story-banner" :class="{ empty: !intent.entry_story.labels.length }">
        <span v-for="l in intent.entry_story.labels" :key="l" class="story-chip">{{ l }}</span>
        <span class="story-summary">{{ intent.entry_story.summary }}</span>
      </div>

      <!-- Requirements -->
      <div class="section-header"><h3 class="section-title">Requirements</h3></div>
      <div class="req-grid">
        <div v-for="k in (['encryption', 'signing', 'kmip', 'tls'] as const)" :key="k" class="req-card" :class="{ on: intent.requirements[k] }">
          <span class="req-dot" />
          <span class="req-label">{{ k }}</span>
        </div>
      </div>

      <!-- Custody -->
      <div class="section-header">
        <h3 class="section-title">Custody</h3>
        <span class="count-badge">{{ intent.custody.length }}</span>
      </div>
      <div v-if="!intent.custody.length" class="empty-panel">No crypto profiles — nothing provisioned yet.</div>
      <table v-else class="arc-table">
        <thead><tr><th>Key</th><th>Type</th><th>Custody</th><th>HSM-backed</th><th>Rotation</th></tr></thead>
        <tbody>
          <tr v-for="c in intent.custody" :key="c.profile_id">
            <td class="mono">{{ c.key_name }}</td>
            <td>{{ c.type }}</td>
            <td>{{ c.custody }}</td>
            <td>{{ c.hsm_backed === null ? 'unknown' : (c.hsm_backed ? 'yes' : 'no') }}</td>
            <td>{{ c.rotation_days ? `${c.rotation_days}d` : '—' }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Governance -->
      <div class="section-header" style="margin-top: 24px;">
        <h3 class="section-title">Governance</h3>
      </div>
      <p class="governance-note">
        Destruction requires approval: <strong>{{ intent.governance.destruction_requires_approval ? 'yes' : 'no' }}</strong>
      </p>
      <div v-if="!intent.governance.rotation_policies.length" class="empty-panel">No rotation policy set yet.</div>
      <table v-else class="arc-table">
        <thead><tr><th>Key</th><th>Desired rotation</th><th>Source</th><th>Changed by</th><th>Updated</th></tr></thead>
        <tbody>
          <tr v-for="p in intent.governance.rotation_policies" :key="p.desired_state_id">
            <td class="mono">{{ p.key_name }}</td>
            <td>{{ p.desired_days ? `${p.desired_days}d` : '—' }}</td>
            <td>{{ p.source }}</td>
            <td>{{ p.changed_by }}</td>
            <td class="muted">{{ formatDate(p.updated_at) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="intent.governance.approvals.length" class="section-header" style="margin-top: 12px;">
        <h3 class="section-title">Approvals</h3>
        <span class="count-badge">{{ intent.governance.approvals.length }}</span>
      </div>
      <table v-if="intent.governance.approvals.length" class="arc-table">
        <thead><tr><th>Action</th><th>Key</th><th>Status</th><th>Requester</th><th>Time</th></tr></thead>
        <tbody>
          <tr v-for="a in intent.governance.approvals" :key="a.id">
            <td class="mono">{{ a.action }}</td>
            <td class="mono">{{ a.key_name }}</td>
            <td><span class="status-pill" :class="a.status">{{ a.status }}</span></td>
            <td>{{ a.requester }}</td>
            <td class="muted">{{ formatDate(a.created_at) }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Assessment: lifecycle reconciliation -->
      <div class="section-header" style="margin-top: 24px;">
        <h3 class="section-title">Lifecycle (Desired vs. Observed)</h3>
      </div>
      <div v-if="!intent.assessment.reconciliation.length" class="empty-panel">
        No reconciliation history for this application yet.
      </div>
      <table v-else class="arc-table">
        <thead><tr><th>Key</th><th>Requirement</th><th>Status</th><th>Disposition</th><th>Observed</th></tr></thead>
        <tbody>
          <tr v-for="r in intent.assessment.reconciliation" :key="r.desired_state_id">
            <td class="mono">{{ r.key_name }}</td>
            <td>{{ r.requirement }}</td>
            <td><span class="status-pill" :class="r.observation_status">{{ r.observation_status }}</span></td>
            <td><span class="disposition-pill" :class="r.disposition">{{ r.disposition.replace('_', ' ') }}</span></td>
            <td class="muted">{{ r.observed_at ? formatDate(r.observed_at) : '—' }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Assessment: controls -->
      <div class="section-header" style="margin-top: 24px;">
        <h3 class="section-title">Controls</h3>
        <span class="count-badge">{{ intent.assessment.controls.length }}</span>
      </div>
      <div v-if="!intent.assessment.controls.length" class="empty-panel">
        No control assessments in scope for this application yet.
      </div>
      <table v-else class="arc-table">
        <thead><tr><th>Control</th><th>Requirement</th><th>Status</th><th>Confidence</th><th>Assessed</th></tr></thead>
        <tbody>
          <tr v-for="c in intent.assessment.controls" :key="c.id">
            <td class="mono">{{ c.control_id }}</td>
            <td>{{ c.requirement }}</td>
            <td><span class="status-pill" :class="pillClass(c.status)">{{ c.status }}</span></td>
            <td>{{ c.confidence }}</td>
            <td class="muted">{{ formatDate(c.assessed_at) }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Evidence -->
      <div class="section-header" style="margin-top: 24px;">
        <h3 class="section-title">Recent Evidence</h3>
        <span class="count-badge">{{ intent.evidence.length }}</span>
      </div>
      <div v-if="!intent.evidence.length" class="empty-panel">No evidence recorded for this application yet.</div>
      <table v-else class="arc-table">
        <thead><tr><th>Time</th><th>Kind</th><th>Operation</th><th>Resource</th><th>Outcome</th></tr></thead>
        <tbody>
          <tr v-for="e in intent.evidence" :key="`${e.kind}-${e.id}`">
            <td class="muted">{{ formatDate(e.ts as string) }}</td>
            <td>{{ e.kind === 'lifecycle_event' ? 'lifecycle' : 'evidence' }}</td>
            <td class="mono">{{ e.operation }}</td>
            <td class="mono">{{ e.resource_id }}</td>
            <td>{{ e.outcome ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import type { ApplicationIntent } from '~/types/arcanium'
import { apiErrorMessage } from '~/utils/apiError'

definePageMeta({ layout: 'default' })

const route = useRoute()
const id = route.params.id as string
const { applicationIntent } = useArcaniumApi()

const loading = ref(true)
const error = ref('')
const intent = ref<ApplicationIntent | null>(null)

useHead({ title: 'Intent' })

function formatDate(ts: string) {
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function pillClass(status: string) {
  return status.replace('/', '-')
}

onMounted(async () => {
  try {
    intent.value = await applicationIntent(id)
  } catch (e: unknown) {
    error.value = apiErrorMessage(e, 'Could not load the intent view for this application.')
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.state-loading, .state-error {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 20px; gap: 12px; color: var(--arc-text-muted);
}
.spinner { width: 32px; height: 32px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-icon { font-size: 28px; color: var(--arc-critical); }
.breadcrumb { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 12px; }
.bc-link { color: var(--arc-action-bright); text-decoration: none; }
.bc-link:hover { text-decoration: underline; }
.bc-sep { color: var(--arc-text-dim); }
.bc-current { color: var(--arc-text-secondary); }

.page-title { font-size: 18px; font-weight: 700; color: var(--arc-text-primary); margin: 0 0 16px; }

.story-banner {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
  background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle);
  border-radius: 10px; padding: 14px 16px; margin-bottom: 24px;
}
.story-banner.empty { border-style: dashed; }
.story-chip {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
  padding: 3px 9px; border-radius: 100px; background: rgba(0,119,182,0.1); color: var(--arc-action-bright);
}
.story-summary { font-size: 12px; color: var(--arc-text-secondary); }

.section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.section-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-primary); margin: 0; }
.count-badge { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 100px; background: rgba(0,119,182,0.1); color: var(--arc-action-bright); }
.empty-panel { background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle); border-radius: 10px; padding: 20px; text-align: center; font-size: 13px; color: var(--arc-text-muted); margin-bottom: 16px; }

.req-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: 24px; }
.req-card {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle); border-radius: 8px;
}
.req-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--arc-text-dim); flex-shrink: 0; }
.req-card.on .req-dot { background: var(--arc-healthy); }
.req-label { font-size: 12px; text-transform: capitalize; color: var(--arc-text-secondary); }
.req-card.on .req-label { color: var(--arc-text-primary); font-weight: 600; }

.governance-note { font-size: 12px; color: var(--arc-text-secondary); margin: 0 0 12px; }

.mono { font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace; font-size: 11px; color: var(--arc-action-bright); }
.muted { color: var(--arc-text-muted) !important; font-size: 12px; }

.arc-table { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle); border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
.arc-table th { text-align: left; padding: 10px 16px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-muted); border-bottom: 1px solid var(--arc-border-subtle); background: var(--arc-bg-shell); }
.arc-table td { padding: 10px 16px; border-bottom: 1px solid var(--arc-border-subtle); color: var(--arc-text-secondary); }
.arc-table tr:last-child td { border-bottom: none; }

.status-pill { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 8px; border-radius: 100px; letter-spacing: 0.03em; }
.status-pill.COMPLIANT, .status-pill.PASS, .status-pill.approved { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.status-pill.DRIFTED, .status-pill.FAIL, .status-pill.rejected { background: var(--arc-critical-bg); color: var(--arc-critical); }
.status-pill.UNKNOWN, .status-pill.pending { background: var(--arc-pending-bg); color: var(--arc-governance); }
.status-pill.N-A { background: rgba(148,163,184,0.14); color: var(--arc-text-dim); }

.disposition-pill { font-size: 9.5px; font-weight: 700; text-transform: uppercase; padding: 3px 8px; border-radius: 4px; letter-spacing: 0.04em; }
.disposition-pill.OPEN { background: rgba(148,163,184,0.12); color: var(--arc-text-muted); }
.disposition-pill.EXCEPTION_ACCEPTED { background: var(--arc-pending-bg); color: var(--arc-governance); }
.disposition-pill.RECONCILED { background: rgba(72,202,228,0.12); color: var(--arc-info); }
</style>
