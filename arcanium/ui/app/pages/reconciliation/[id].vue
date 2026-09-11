<template>
  <div>
    <div v-if="loading" class="state-loading"><div class="spinner" /><span>Loading reconciliation run…</span></div>
    <div v-else-if="error" class="state-error"><div class="error-icon">⚠</div><p>{{ error }}</p></div>
    <div v-else-if="detail">
      <div class="breadcrumb">
        <NuxtLink to="/reconciliation" class="bc-link">Reconciliation</NuxtLink>
        <span class="bc-sep">›</span>
        <span class="bc-current">{{ detail.application_name }} · {{ detail.key_name }}</span>
      </div>

      <div class="rc-hero">
        <div class="hero-meta">
          <h2 class="hero-name">{{ detail.application_name }}</h2>
          <div class="hero-sub mono">{{ detail.key_name }} · {{ detail.requirement }}</div>
          <div v-if="detail.tenant" class="hero-tenant">{{ detail.tenant }}</div>
        </div>
        <div class="hero-badges">
          <span class="status-pill" :class="detail.observation_status">{{ detail.observation_status }}</span>
          <span class="disposition-pill" :class="detail.disposition">{{ detail.disposition.replace('_', ' ') }}</span>
        </div>
      </div>

      <div class="compare-grid">
        <div class="compare-card">
          <span class="compare-label">Desired</span>
          <span class="compare-value">{{ detail.desired_value?.days }} days</span>
          <span class="compare-meta">v{{ detail.run.desired_state_version }} · set by {{ detail.desired_state_history[0]?.changed_by ?? '—' }}</span>
        </div>
        <div class="compare-arrow">vs</div>
        <div class="compare-card" :class="{ drift: detail.observation_status === 'DRIFTED' }">
          <span class="compare-label">Observed</span>
          <span class="compare-value">{{ detail.run.observed_value?.days ?? '—' }}{{ detail.run.observed_value ? ' days' : '' }}</span>
          <span class="compare-meta">observed {{ rel(detail.run.observed_at) }} · live Vault read</span>
        </div>
      </div>
      <p v-if="detail.run.detail" class="run-detail-note">{{ detail.run.detail }}</p>

      <!-- Actions -->
      <div class="action-bar">
        <button
          class="primary-button" :disabled="acting || detail.observation_status !== 'DRIFTED'"
          @click="doReconcile"
        >
          {{ acting === 'reconcile' ? 'Reconciling…' : 'Reconcile' }}
        </button>
        <button
          class="secondary-button" :disabled="acting || detail.observation_status !== 'DRIFTED'"
          @click="showException = !showException"
        >
          Accept exception
        </button>
        <button class="secondary-button" :disabled="acting" @click="doRerun">
          {{ acting === 'rerun' ? 'Running…' : 'Re-run now' }}
        </button>
      </div>
      <p v-if="detail.observation_status !== 'DRIFTED'" class="hint">
        Reconcile and Accept exception only apply to a DRIFTED run — nothing to correct or except right now.
      </p>
      <p v-if="actionMsg" class="inline-notice" :class="{ error: actionError }">{{ actionMsg }}</p>

      <div v-if="showException" class="exception-form">
        <label class="form-field">Reason<input v-model="exceptionReason" placeholder="Why is this drift acceptable, for now?" /></label>
        <label class="form-field">Expires<input v-model="exceptionExpires" type="date" /></label>
        <div class="form-actions">
          <button class="secondary-button" @click="showException = false">Cancel</button>
          <button class="primary-button" :disabled="acting || !exceptionReason || !exceptionExpires" @click="doAcceptException">
            {{ acting === 'accept-exception' ? 'Saving…' : 'Accept exception' }}
          </button>
        </div>
      </div>

      <!-- Edit desired value -->
      <div class="section-header" style="margin-top: 28px;">
        <h3 class="section-title">Desired-state history</h3>
        <button class="section-link" @click="showEditDesired = !showEditDesired">
          {{ showEditDesired ? 'cancel' : 'change desired value' }}
        </button>
      </div>
      <div v-if="showEditDesired" class="exception-form">
        <label class="form-field">New desired rotation period (days)<input v-model.number="newDays" type="number" min="1" /></label>
        <label class="form-field">Reason<input v-model="editReason" placeholder="Why is the intent changing?" /></label>
        <div class="form-actions">
          <button class="secondary-button" @click="showEditDesired = false">Cancel</button>
          <button class="primary-button" :disabled="acting || !newDays" @click="doEditDesired">
            {{ acting === 'edit-desired' ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
      <table class="arc-table">
        <thead><tr><th>Version</th><th>Value</th><th>Changed by</th><th>Groups</th><th>Reason</th><th>When</th></tr></thead>
        <tbody>
          <tr v-for="h in detail.desired_state_history" :key="h.version">
            <td>v{{ h.version }}<span v-if="h.current" class="current-tag">current</span></td>
            <td>{{ h.desired_value?.days }}d</td>
            <td>{{ h.changed_by }}</td>
            <td><span v-for="g in h.changed_groups" :key="g" class="group-chip">{{ g }}</span></td>
            <td class="muted">{{ h.changed_reason || '—' }}</td>
            <td class="muted">{{ rel(h.changed_at) }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Reconciliation action history -->
      <div class="section-header" style="margin-top: 24px;">
        <h3 class="section-title">Action history</h3>
      </div>
      <div v-if="!detail.actions.length" class="empty-panel">No reconcile/accept-exception actions recorded yet.</div>
      <table v-else class="arc-table">
        <thead><tr><th>Action</th><th>Actor</th><th>Result</th><th>Reason</th><th>Expires</th><th>When</th></tr></thead>
        <tbody>
          <tr v-for="a in detail.actions" :key="a.id">
            <td class="mono">{{ a.action }}</td>
            <td>{{ a.actor }}</td>
            <td><span class="result-pill" :class="a.result">{{ a.result }}</span></td>
            <td class="muted">{{ a.reason || '—' }}</td>
            <td class="muted">{{ a.expires_at ? rel(a.expires_at) : '—' }}</td>
            <td class="muted">{{ rel(a.created_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import type { ReconciliationDetail } from '~/types/arcanium'
import { apiErrorMessage } from '~/utils/apiError'

definePageMeta({ layout: 'default' })

const route = useRoute()
const runId = route.params.id as string
const { reconciliationDetail, reconcileRun, acceptException, setDesiredState, runReconciliation } = useArcaniumApi()

const loading = ref(true)
const error = ref('')
const detail = ref<ReconciliationDetail | null>(null)

const acting = ref<string | false>(false)
const actionMsg = ref('')
const actionError = ref(false)
const showException = ref(false)
const exceptionReason = ref('')
const exceptionExpires = ref('')
const showEditDesired = ref(false)
const newDays = ref<number | null>(null)
const editReason = ref('')

useHead({ title: computed(() => detail.value ? `${detail.value.application_name} · Reconciliation` : 'Reconciliation') })

function rel(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (Math.abs(m) < 1) return 'just now'
  const future = diff < 0
  const am = Math.abs(m)
  const label = am < 60 ? `${am}m` : am < 1440 ? `${Math.floor(am / 60)}h` : `${Math.floor(am / 1440)}d`
  return future ? `in ${label}` : `${label} ago`
}

async function load() {
  try {
    detail.value = await reconciliationDetail(runId)
    error.value = ''
  } catch (e: unknown) {
    error.value = apiErrorMessage(e, 'Reconciliation run not found.')
  } finally {
    loading.value = false
  }
}

async function doReconcile() {
  if (acting.value) return
  acting.value = 'reconcile'; actionMsg.value = ''; actionError.value = false
  try {
    const r = await reconcileRun(runId)
    actionMsg.value = r.action?.result === 'applied'
      ? 'Reconciled — Vault corrected to the desired value.'
      : `Reconcile action recorded as ${r.action?.result}.`
    if (r.confirmation_run?.id && r.confirmation_run.id !== runId) {
      await navigateTo(`/reconciliation/${r.confirmation_run.id}`)
      return
    }
    await load()
  } catch (e: unknown) {
    actionError.value = true
    actionMsg.value = apiErrorMessage(e, 'Reconcile failed.')
  } finally {
    acting.value = false
  }
}

async function doAcceptException() {
  if (acting.value) return
  acting.value = 'accept-exception'; actionMsg.value = ''; actionError.value = false
  try {
    await acceptException(runId, exceptionReason.value, new Date(exceptionExpires.value).toISOString())
    actionMsg.value = 'Exception recorded — Vault was not changed.'
    showException.value = false
    await load()
  } catch (e: unknown) {
    actionError.value = true
    actionMsg.value = apiErrorMessage(e, 'Accept-exception failed.')
  } finally {
    acting.value = false
  }
}

async function doEditDesired() {
  if (acting.value || !detail.value || !newDays.value) return
  acting.value = 'edit-desired'; actionMsg.value = ''; actionError.value = false
  try {
    await setDesiredState(detail.value.desired_state_id, newDays.value, editReason.value)
    actionMsg.value = `Desired rotation period updated to ${newDays.value} days.`
    showEditDesired.value = false
    newDays.value = null
    editReason.value = ''
    await load()
  } catch (e: unknown) {
    actionError.value = true
    actionMsg.value = apiErrorMessage(e, 'Failed to update desired value.')
  } finally {
    acting.value = false
  }
}

async function doRerun() {
  if (acting.value || !detail.value) return
  acting.value = 'rerun'; actionMsg.value = ''; actionError.value = false
  try {
    const results = await runReconciliation()
    actionMsg.value = `Re-ran ${results.length} row(s).`
    await load()
  } catch (e: unknown) {
    actionError.value = true
    actionMsg.value = apiErrorMessage(e, 'Re-run failed.')
  } finally {
    acting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.state-loading, .state-error { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 20px; gap: 12px; color: var(--arc-text-muted); }
.spinner { width: 32px; height: 32px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-icon { font-size: 28px; color: var(--arc-critical); }

.breadcrumb { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 20px; }
.bc-link { color: var(--arc-action-bright); text-decoration: none; }
.bc-link:hover { text-decoration: underline; }
.bc-sep { color: var(--arc-text-dim); }
.bc-current { color: var(--arc-text-secondary); }

.rc-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
.hero-name { font-size: 18px; font-weight: 700; color: var(--arc-text-primary); margin: 0 0 4px; }
.hero-sub { font-size: 12px; color: var(--arc-text-muted); }
.hero-tenant { font-size: 11px; color: var(--arc-text-dim); margin-top: 4px; }
.hero-badges { display: flex; gap: 8px; }

.compare-grid { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; margin-bottom: 8px; }
.compare-card { background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 4px; }
.compare-card.drift { border-color: rgba(220,47,2,0.35); background: var(--arc-critical-bg); }
.compare-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-muted); }
.compare-value { font-size: 22px; font-weight: 800; color: var(--arc-text-primary); }
.compare-meta { font-size: 11px; color: var(--arc-text-dim); }
.compare-arrow { font-size: 11px; color: var(--arc-text-dim); text-transform: uppercase; }
.run-detail-note { font-size: 12px; color: var(--arc-text-muted); margin: 0 0 16px; }

.action-bar { display: flex; gap: 10px; margin: 16px 0 6px; }
.hint { font-size: 11.5px; color: var(--arc-text-dim); margin: 0 0 8px; }
.inline-notice { font-size: 12px; color: var(--arc-action-bright); margin: 8px 0; padding: 8px 12px; background: rgba(0,119,182,0.08); border: 1px solid var(--arc-glass-border); border-radius: 8px; }
.inline-notice.error { background: var(--arc-critical-bg); color: var(--arc-critical); border-color: rgba(220,47,2,0.25); }

.exception-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px; background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle); border-radius: 10px; padding: 14px; margin: 10px 0 18px; }
.exception-form .form-field { margin-bottom: 0; min-width: 180px; }
.exception-form .form-actions { margin: 0; }

.section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.section-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-primary); margin: 0; }
.section-link { margin-left: auto; font-size: 12px; color: var(--arc-action-bright); background: none; border: none; cursor: pointer; text-decoration: underline; }
.empty-panel { background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle); border-radius: 10px; padding: 24px; text-align: center; font-size: 13px; color: var(--arc-text-muted); }

.arc-table { width: 100%; border-collapse: collapse; font-size: 12.5px; background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle); border-radius: 10px; overflow: hidden; margin-bottom: 20px; }
.arc-table th { text-align: left; padding: 9px 14px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-muted); background: var(--arc-bg-shell); border-bottom: 1px solid var(--arc-border-subtle); }
.arc-table td { padding: 9px 14px; border-bottom: 1px solid var(--arc-border-subtle); color: var(--arc-text-secondary); }
.arc-table tr:last-child td { border-bottom: none; }
.mono { font-family: ui-monospace, monospace; font-size: 11.5px; color: var(--arc-action-bright); }
.muted { color: var(--arc-text-muted) !important; font-size: 11px; }
.current-tag { font-size: 9px; margin-left: 6px; padding: 1px 5px; border-radius: 4px; background: rgba(0,119,182,0.12); color: var(--arc-action-bright); text-transform: uppercase; }
.group-chip { display: inline-block; font-size: 9.5px; padding: 1px 6px; margin: 1px 3px 1px 0; border-radius: 4px; background: rgba(124,158,245,0.14); color: #9db6f7; }

.status-pill { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 3px 9px; border-radius: 100px; letter-spacing: 0.03em; }
.status-pill.COMPLIANT { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.status-pill.DRIFTED { background: var(--arc-critical-bg); color: var(--arc-critical); }
.status-pill.UNKNOWN { background: rgba(148,163,184,0.14); color: var(--arc-text-muted); }
.disposition-pill { font-size: 9.5px; font-weight: 700; text-transform: uppercase; padding: 3px 8px; border-radius: 4px; letter-spacing: 0.04em; }
.disposition-pill.OPEN { background: rgba(148,163,184,0.12); color: var(--arc-text-muted); }
.disposition-pill.EXCEPTION_ACCEPTED { background: var(--arc-pending-bg); color: var(--arc-governance); }
.disposition-pill.RECONCILED { background: rgba(72,202,228,0.12); color: var(--arc-info); }
.result-pill { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 7px; border-radius: 100px; }
.result-pill.applied { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.result-pill.failed, .result-pill.denied { background: var(--arc-critical-bg); color: var(--arc-critical); }
</style>
