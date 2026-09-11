<template>
  <div>

    <!-- Tab bar -->
    <div class="tab-bar">
      <button class="tab-btn" :class="{ active: tab === 'pending' }" @click="tab = 'pending'">
        Pending
        <span v-if="pending.length" class="tab-badge">{{ pending.length }}</span>
      </button>
      <button class="tab-btn" :class="{ active: tab === 'approved' }" @click="tab = 'approved'">Approved</button>
      <button class="tab-btn" :class="{ active: tab === 'rejected' }" @click="tab = 'rejected'">Denied</button>
      <button class="tab-btn" :class="{ active: tab === 'all' }" @click="tab = 'all'">
        All records
        <span v-if="all.length" class="tab-badge muted">{{ all.length }}</span>
      </button>
    </div>

    <div v-if="loading" class="state-loading"><div class="spinner" /><span>Loading approvals…</span></div>
    <div v-else-if="error" class="state-error"><div class="error-icon">⚠</div><p>{{ error }}</p></div>
    <div v-else-if="!visibleRows.length" class="state-empty">
      <div class="empty-icon">
        <svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="1.5"/><line x1="24" y1="14" x2="24" y2="26" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="32" r="1.5" fill="currentColor"/></svg>
      </div>
      <p class="empty-title">{{ tab === 'pending' ? 'No pending approvals' : 'No records' }}</p>
      <p class="empty-sub">{{ tab === 'pending' ? 'All caught up — no pending governance requests.' : 'No approval records found.' }}</p>
    </div>

    <div v-else class="table-wrap">
      <table class="arc-table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Key</th>
            <th>Application</th>
            <th>Requester</th>
            <th>Source</th>
            <th>Status</th>
            <th>Created</th>
            <th v-if="tab === 'pending'">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="a in paginated"
            :key="a.id"
            class="data-row"
            :class="{ 'row-pending': a.status === 'pending' }"
            tabindex="0" @keydown.enter.prevent="openDrawer(a)" @keydown.space.prevent="openDrawer(a)" @click="openDrawer(a)"
          >
            <td class="mono">{{ a.action }}</td>
            <td class="mono">{{ a.key_name }}</td>
            <td>
              <NuxtLink :to="`/applications/${a.app_id}`" class="app-link" @click.stop>
                {{ a.app_id.slice(0, 8) }}
              </NuxtLink>
            </td>
            <td>{{ a.requester }}</td>
            <td><span class="source-pill" :class="a.source">{{ a.source }}</span></td>
            <td><span class="status-pill" :class="a.status">{{ a.status }}</span></td>
            <td class="muted">{{ relativeTime(a.created_at) }}</td>
            <td v-if="tab === 'pending'" @click.stop>
              <div v-if="a.status === 'pending'" class="action-btns">
                <button class="action-btn approve" @click="openDrawer(a, 'approve')">Review</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <RecordPagination v-model:page="page" :total="visibleRows.length" />
    </div>

    <!-- ── Approval drawer ──────────────────────────────── -->
    <Transition name="drawer-slide">
      <div v-if="drawer.open" class="drawer-overlay" @click.self="closeDrawer">
        <div class="drawer-panel">
          <div class="drawer-header">
            <h3 class="drawer-title">Approval Record</h3>
            <button class="drawer-close" @click="closeDrawer">✕</button>
          </div>

          <div class="drawer-body" v-if="drawer.record">
            <!-- Record metadata -->
            <div class="drawer-section">
              <div class="dl-grid">
                <div class="dl-row"><span class="dl-l">ID</span><span class="dl-v mono">{{ drawer.record.id }}</span></div>
                <div class="dl-row"><span class="dl-l">Action</span><span class="dl-v mono">{{ drawer.record.action }}</span></div>
                <div class="dl-row"><span class="dl-l">Key</span><span class="dl-v mono">{{ drawer.record.key_name }}</span></div>
                <div class="dl-row"><span class="dl-l">Application</span><span class="dl-v mono">{{ drawer.record.app_id }}</span></div>
                <div class="dl-row"><span class="dl-l">Requester</span><span class="dl-v">{{ drawer.record.requester }}</span></div>
                <div class="dl-row"><span class="dl-l">Source</span><span class="source-pill" :class="drawer.record.source">{{ drawer.record.source }}</span></div>
                <div class="dl-row" v-if="drawer.record.accessor">
                  <span class="dl-l">CG Accessor</span>
                  <span class="dl-v mono accessor">{{ drawer.record.accessor }}</span>
                </div>
                <div class="dl-row" v-if="drawer.record.reason">
                  <span class="dl-l">Reason</span>
                  <span class="dl-v">{{ drawer.record.reason }}</span>
                </div>
                <div class="dl-row"><span class="dl-l">Status</span><span class="status-pill" :class="drawer.record.status">{{ drawer.record.status }}</span></div>
                <div class="dl-row"><span class="dl-l">Created</span><span class="dl-v">{{ formatDate(drawer.record.created_at) }}</span></div>
                <div class="dl-row" v-if="drawer.record.request_id">
                  <span class="dl-l">Request</span>
                  <span class="dl-v mono">{{ drawer.record.request_id }}</span>
                </div>
              </div>
            </div>

            <!-- Only show action form for pending records -->
            <div v-if="drawer.record.status === 'pending'" class="drawer-section action-section">
              <!-- ⚠ Explicit governance limitation notice -->
              <div class="cg-notice">
                <div class="cg-notice-icon">
                  <svg viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2"/>
                    <line x1="8" y1="4.5" x2="8" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                    <circle cx="8" cy="11.5" r="0.8" fill="currentColor"/>
                  </svg>
                </div>
                <div class="cg-notice-body">
                  <div class="cg-notice-title">Important — scope of this action</div>
                  <div class="cg-notice-text">
                    Approving or denying here <strong>records a database decision only</strong>.
                    It does <em>not</em> authorize a Vault Control Group operation or modify any Vault policy.
                    Vault Control Group authorization is a separate step performed via the Vault API using the CG accessor.
                  </div>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Reason / notes</label>
                <textarea
                  v-model="drawer.reason"
                  class="form-textarea"
                  rows="3"
                  placeholder="Enter reason for this decision…"
                />
              </div>

              <!-- Explicit acknowledgement checkbox -->
              <label class="ack-label">
                <input type="checkbox" v-model="drawer.acknowledged" class="ack-checkbox" />
                <span class="ack-text">
                  I understand this records a <strong>database decision only</strong> and does not authorize the Vault Control Group operation.
                </span>
              </label>

              <div v-if="drawer.submitError" class="submit-error">{{ drawer.submitError }}</div>

              <div class="drawer-actions">
                <button
                  class="btn-deny"
                  :disabled="!drawer.acknowledged || drawer.submitting"
                  @click="submitDecision('rejected')"
                >
                  {{ drawer.submitting && drawer.pendingAction === 'rejected' ? 'Denying…' : 'Deny' }}
                </button>
                <button
                  class="btn-approve"
                  :disabled="!drawer.acknowledged || drawer.submitting"
                  @click="submitDecision('approved')"
                >
                  {{ drawer.submitting && drawer.pendingAction === 'approved' ? 'Approving…' : 'Approve' }}
                </button>
              </div>
            </div>

            <!-- Resolved record info -->
            <div v-else class="drawer-section resolved-section">
              <div class="resolved-banner" :class="drawer.record.status">
                {{ drawer.record.status === 'approved' ? '✓ Approved' : '✗ Denied' }}
                <span v-if="drawer.record.approver"> by {{ drawer.record.approver }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, watch } from 'vue'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import type { ApprovalRecord } from '~/types/arcanium'
import { apiErrorMessage } from '~/utils/apiError'

definePageMeta({ layout: 'default' })
useHead({ title: 'Approvals' })

const { approvals: fetchApprovals, approveRecord, denyRecord } = useArcaniumApi()

const loading = ref(true)
const error = ref('')
const all = ref<ApprovalRecord[]>([])
const tab = ref<'pending' | 'approved' | 'rejected' | 'all'>('pending')

const pending = computed(() => all.value.filter(a => a.status === 'pending'))
const page = ref(1)
const visibleRows = computed(() => [...all.value].filter(a => tab.value === 'all' || a.status === tab.value).sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at)))
const paginated = computed(() => visibleRows.value.slice((page.value - 1) * 10, page.value * 10))
watch(tab, () => { page.value = 1 })

// ── Drawer state ───────────────────────────────────────────
const drawer = reactive({
  open: false,
  record: null as ApprovalRecord | null,
  reason: '',
  acknowledged: false,
  submitting: false,
  submitError: '',
  pendingAction: '' as 'approved' | 'rejected' | '',
})

function openDrawer(record: ApprovalRecord, _intent?: string) {
  drawer.record = record
  drawer.reason = ''
  drawer.acknowledged = false
  drawer.submitting = false
  drawer.submitError = ''
  drawer.pendingAction = ''
  drawer.open = true
}
function closeDrawer() {
  if (drawer.submitting) return
  drawer.open = false
}

async function submitDecision(decision: 'approved' | 'rejected') {
  if (!drawer.record || !drawer.acknowledged || drawer.submitting) return
  drawer.submitting = true
  drawer.submitError = ''
  drawer.pendingAction = decision

  try {
    if (decision === 'approved') {
      await approveRecord(drawer.record.id, drawer.reason)
    } else {
      await denyRecord(drawer.record.id, drawer.reason)
    }
    // Update local record status
    const idx = all.value.findIndex(a => a.id === drawer.record!.id)
    if (idx >= 0) {
      all.value[idx] = { ...all.value[idx], status: decision }
    }
    drawer.open = false
  } catch (e: unknown) {
    drawer.submitError = apiErrorMessage(e, 'Request failed. Please try again.')
  } finally {
    drawer.submitting = false
    drawer.pendingAction = ''
  }
}

function relativeTime(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
function formatDate(ts: string) {
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function loadRecords() {
  try {
    const data = await fetchApprovals({ all: true })
    all.value = Array.isArray(data) ? data : []
  } catch (e: unknown) {
    error.value = apiErrorMessage(e, 'Failed to load approvals.')
  } finally {
    loading.value = false
  }
}
onMounted(loadRecords)
usePolling(loadRecords, 10000)
</script>

<style scoped>
/* ── Tabs ─────────────────────────────────────────────────── */
.tab-bar { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--arc-border-subtle); }
.tab-btn {
  display: flex; align-items: center; gap: 8px; padding: 8px 16px;
  background: none; border: none; border-bottom: 2px solid transparent;
  font-size: 13px; color: var(--arc-text-muted); cursor: pointer; font-family: inherit;
  margin-bottom: -1px; transition: color 0.12s;
}
.tab-btn:hover { color: var(--arc-text-secondary); }
.tab-btn.active { color: var(--arc-action-bright); border-bottom-color: var(--arc-action-primary); }
.tab-badge {
  font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 100px;
  background: var(--arc-pending-bg); color: var(--arc-governance);
}
.tab-badge.muted { background: rgba(125,133,151,0.1); color: var(--arc-text-muted); }

/* States */
.state-loading, .state-empty, .state-error {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 20px; gap: 12px; color: var(--arc-text-muted);
}
.spinner { width: 32px; height: 32px; border: 2px solid var(--arc-border-strong); border-top-color: var(--arc-action-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-icon { font-size: 28px; color: var(--arc-critical); }
.empty-icon { width: 56px; height: 56px; color: var(--arc-text-dim); }
.empty-icon svg { width: 100%; height: 100%; }
.empty-title { font-size: 16px; font-weight: 600; color: var(--arc-text-secondary); margin: 0; }
.empty-sub { font-size: 13px; color: var(--arc-text-muted); margin: 0; text-align: center; max-width: 360px; }

/* Table */
.arc-table { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--arc-bg-card); border: 1px solid var(--arc-border-subtle); border-radius: 12px; overflow: hidden; }
.arc-table th { text-align: left; padding: 10px 16px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--arc-text-muted); border-bottom: 1px solid var(--arc-border-subtle); background: var(--arc-bg-shell); }
.arc-table td { padding: 11px 16px; border-bottom: 1px solid var(--arc-border-subtle); color: var(--arc-text-secondary); }
.arc-table tr:last-child td { border-bottom: none; }
.data-row { cursor: pointer; transition: background 0.1s; }
.data-row:hover td { background: rgba(255,255,255,0.02); }
/* Prompt 16.5 — one amber indicator per row (the left edge), not one per cell.
   The amber status pill carries the rest of the "pending" signal. */
.row-pending td:first-child { border-left: 2px solid var(--arc-governance); padding-left: 14px; }
.mono { font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace; font-size: 11px; color: var(--arc-action-bright); }
.muted { color: var(--arc-text-muted) !important; font-size: 11px; }
.app-link { color: var(--arc-action-bright); text-decoration: none; font-family: "JetBrains Mono", "Fira Code", ui-monospace, monospace; font-size: 11px; }
.app-link:hover { text-decoration: underline; }

.status-pill { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 100px; text-transform: capitalize; }
.status-pill.pending { background: var(--arc-pending-bg); color: var(--arc-governance); }
.status-pill.approved { background: var(--arc-healthy-bg); color: var(--arc-healthy); }
.status-pill.rejected { background: var(--arc-critical-bg); color: var(--arc-critical); }

.source-pill { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.06em; }
.source-pill.manual { background: rgba(0,119,182,0.1); color: var(--arc-action-bright); }
.source-pill.local { background: rgba(34,197,94,0.1); color: var(--arc-healthy); }
.source-pill.external { background: rgba(255,170,0,0.1); color: var(--arc-governance); }

.action-btns { display: flex; gap: 6px; }
.action-btn { font-size: 11px; font-weight: 600; padding: 3px 12px; border-radius: 6px; cursor: pointer; font-family: inherit; border: none; transition: background 0.12s; }
.action-btn.approve { background: rgba(0,119,182,0.15); color: var(--arc-action-bright); border: 1px solid rgba(0,119,182,0.3); }
.action-btn.approve:hover { background: rgba(0,119,182,0.25); }

/* ── Drawer ────────────────────────────────────────────────── */
.drawer-overlay {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(0, 8, 24, 0.5); backdrop-filter: blur(3px);
  display: flex; justify-content: flex-end;
}
.drawer-panel {
  width: 480px; max-width: 92vw; height: 100vh; background: var(--arc-bg-shell);
  border-left: 1px solid var(--arc-border-strong); display: flex; flex-direction: column;
  overflow: hidden;
}
.drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 24px; border-bottom: 1px solid var(--arc-border-subtle); flex-shrink: 0;
}
.drawer-title { font-size: 15px; font-weight: 600; color: var(--arc-text-primary); margin: 0; }
.drawer-close { background: none; border: none; color: var(--arc-text-muted); cursor: pointer; font-size: 16px; padding: 4px; }
.drawer-close:hover { color: var(--arc-text-primary); }
.drawer-body { flex: 1; overflow-y: auto; padding: 0; }
.drawer-section { padding: 20px 24px; border-bottom: 1px solid var(--arc-border-subtle); }

.dl-grid { display: flex; flex-direction: column; gap: 10px; }
.dl-row { display: flex; gap: 16px; align-items: baseline; }
.dl-l { font-size: 11px; color: var(--arc-text-muted); text-transform: uppercase; letter-spacing: 0.05em; width: 100px; flex-shrink: 0; }
.dl-v { font-size: 13px; color: var(--arc-text-secondary); word-break: break-all; }
.accessor { font-size: 10px !important; }

/* CG notice */
.cg-notice {
  display: flex; gap: 12px; padding: 14px 16px;
  background: rgba(255,170,0,0.06); border: 1px solid rgba(255,170,0,0.25);
  border-radius: 10px; margin-bottom: 18px;
}
.cg-notice-icon { width: 18px; height: 18px; color: var(--arc-governance); flex-shrink: 0; margin-top: 2px; }
.cg-notice-icon svg { width: 18px; height: 18px; }
.cg-notice-title { font-size: 12px; font-weight: 700; color: var(--arc-governance); margin-bottom: 5px; }
.cg-notice-text { font-size: 12px; color: var(--arc-text-muted); line-height: 1.6; }
.cg-notice-text strong { color: var(--arc-warning); }
.cg-notice-text em { color: var(--arc-text-secondary); font-style: normal; font-weight: 600; }

.form-group { margin-bottom: 14px; }
.form-label { font-size: 12px; color: var(--arc-text-muted); display: block; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
.form-textarea {
  width: 100%; background: var(--arc-bg-surface); border: 1px solid var(--arc-border-subtle);
  border-radius: 8px; padding: 10px 12px; font-size: 13px; color: var(--arc-text-primary);
  font-family: inherit; resize: vertical; outline: none; transition: border-color 0.12s;
}
.form-textarea:focus { border-color: var(--arc-border-bright); }

.ack-label {
  display: flex; align-items: flex-start; gap: 10px; cursor: pointer;
  padding: 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--arc-border-subtle);
  border-radius: 8px; margin-bottom: 16px;
}
.ack-checkbox { width: 15px; height: 15px; flex-shrink: 0; margin-top: 2px; cursor: pointer; accent-color: var(--arc-action-primary); }
.ack-text { font-size: 12px; color: var(--arc-text-secondary); line-height: 1.5; }
.ack-text strong { color: var(--arc-warning); }

.submit-error { font-size: 12px; color: var(--arc-critical); margin-bottom: 12px; padding: 8px 12px; background: var(--arc-critical-bg); border-radius: 6px; }

.drawer-actions { display: flex; gap: 10px; }
.btn-deny {
  flex: 1; padding: 10px 0; border-radius: 8px; font-size: 13px; font-weight: 600;
  font-family: inherit; cursor: pointer; border: 1px solid rgba(220,47,2,0.3);
  background: rgba(220,47,2,0.08); color: var(--arc-critical); transition: background 0.12s;
}
.btn-deny:hover:not(:disabled) { background: rgba(220,47,2,0.16); }
.btn-deny:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-approve {
  flex: 2; padding: 10px 0; border-radius: 8px; font-size: 13px; font-weight: 600;
  font-family: inherit; cursor: pointer; border: 1px solid var(--arc-action-primary);
  background: var(--arc-action-primary); color: #fff; transition: background 0.12s;
}
.btn-approve:hover:not(:disabled) { background: var(--arc-action-hover); }
.btn-approve:disabled { opacity: 0.4; cursor: not-allowed; }

.resolved-section { }
.resolved-banner {
  padding: 14px 18px; border-radius: 10px; font-size: 14px; font-weight: 700; text-align: center;
}
.resolved-banner.approved { background: var(--arc-healthy-bg); color: var(--arc-healthy); border: 1px solid rgba(34,197,94,0.2); }
.resolved-banner.rejected { background: var(--arc-critical-bg); color: var(--arc-critical); border: 1px solid rgba(220,47,2,0.2); }

/* Transition */
.drawer-slide-enter-active, .drawer-slide-leave-active { transition: transform 0.2s ease, opacity 0.2s ease; }
.drawer-slide-enter-from .drawer-panel, .drawer-slide-leave-to .drawer-panel { transform: translateX(40px); }
.drawer-slide-enter-from, .drawer-slide-leave-to { opacity: 0; }
</style>
