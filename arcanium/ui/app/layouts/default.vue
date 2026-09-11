<template>
  <div class="arc-shell">
    <a class="skip-link" href="#main-content">Skip to content</a>
    <!-- ── Sidebar ──────────────────────────────────────── -->
    <aside class="arc-sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-brand">
        <svg class="brand-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="9" stroke="#0096c7" stroke-width="1.2"/>
          <polygon points="12,5 17.5,8.5 17.5,15.5 12,19 6.5,15.5 6.5,8.5" stroke="#00b4d8" stroke-width="1" fill="none"/>
          <circle cx="12" cy="12" r="2" fill="#ffaa00"/>
          <line x1="12" y1="14" x2="12" y2="17.5" stroke="#ffaa00" stroke-width="1.2" stroke-linecap="round"/>
          <line x1="10.8" y1="16" x2="12" y2="16" stroke="#ffaa00" stroke-width="1" stroke-linecap="round"/>
        </svg>
        <span v-if="!sidebarCollapsed" class="brand-name">Arcanium</span>
      </div>

      <nav class="sidebar-nav">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: isActive(item) }"
          :title="sidebarCollapsed ? item.label : undefined"
        >
          <span class="nav-icon" v-html="item.icon" />
          <span v-if="!sidebarCollapsed" class="nav-label">{{ item.label }}</span>
          <span
            v-if="!sidebarCollapsed && item.badge"
            class="nav-badge"
            :class="item.badgeType"
          >{{ item.badge }}</span>
        </NuxtLink>
      </nav>

      <div class="sidebar-footer">
        <button class="sidebar-toggle" @click="sidebarCollapsed = !sidebarCollapsed" :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'">
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path v-if="!sidebarCollapsed" d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path v-else d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </aside>

    <!-- ── Main area ──────────────────────────────────────── -->
    <div class="arc-main" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
      <!-- Topbar -->
      <header class="arc-topbar">
        <div class="topbar-left">
          <h1 class="page-title">{{ currentTitle }}</h1>
        </div>

        <div class="topbar-centre">
          <button class="cmd-trigger" @click="cmdOpen = true">
            <svg viewBox="0 0 16 16" fill="none">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.2"/>
              <line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
            <span>Search…</span>
            <kbd>⌘K</kbd>
          </button>
        </div>

        <div class="topbar-right">
          <span class="env-badge" title="Deployment environment">DEMO</span>

          <div class="cluster-pill" role="status" :class="clusterStatusClass" :title="clusterStatusTitle">
            <span class="cluster-dot" :class="{ live: clusterStatusClass === 'healthy' }" />
            <span class="cluster-label">{{ clusterLabel }}</span>
          </div>

          <button
            class="pending-pill"
            v-if="pendingCount > 0"
            @click="navigateTo('/approvals')"
            :title="`${pendingCount} approval request${pendingCount === 1 ? '' : 's'} awaiting a decision`"
          >
            <svg viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="#ffaa00" stroke-width="1.2"/>
              <line x1="8" y1="4" x2="8" y2="9" stroke="#ffaa00" stroke-width="1.5" stroke-linecap="round"/>
              <circle cx="8" cy="11.5" r="0.8" fill="#ffaa00"/>
            </svg>
            <span>{{ pendingCount }} pending</span>
          </button>

          <a
            class="vault-link"
            :href="vaultUiUrl"
            target="_blank"
            rel="noopener noreferrer"
            title="Open the Vault UI in a new tab — direct Vault administration"
          >
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5 3 3.5v4c0 3 2.1 5.4 5 6.5 2.9-1.1 5-3.5 5-6.5v-4L8 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            </svg>
            <span>Vault UI</span>
          </a>

          <div class="user-menu" ref="userMenuRef">
            <button
              type="button"
              class="persona"
              :title="authEnabled ? 'Signed in — account details' : 'Active viewpoint'"
              @click="userMenuOpen = !userMenuOpen"
            >
              <span class="persona-dot" :class="{ 'persona-dot--auth': authEnabled }" />{{ personaLabel }}
            </button>

            <div v-if="userMenuOpen" class="user-menu-panel" role="menu">
              <template v-if="authEnabled">
                <div class="umf-row umf-user">{{ username || 'signed in' }}</div>
                <div class="umf-row umf-meta">{{ personaLabel }} · signed in via OIDC</div>
                <div v-if="authGroups.length" class="umf-row umf-groups">
                  <span v-for="g in authGroups" :key="g" class="umf-chip">{{ g }}</span>
                </div>
                <div v-if="tenantScopeNs.length" class="umf-row umf-meta">
                  Scoped to {{ tenantScopeNs.join(', ') }}
                </div>
                <button type="button" class="umf-signout" @click="signOut">Sign out</button>
              </template>
              <template v-else>
                <div class="umf-row umf-meta">Authentication is disabled on this deployment.</div>
                <div class="umf-row umf-meta">Viewing as {{ personaLabel }} (demo viewpoint).</div>
              </template>
            </div>
          </div>
        </div>
      </header>

      <!-- Page content -->
      <main id="main-content" class="arc-content" tabindex="-1">
        <div v-if="persona === 'supplier-admin'" class="tenant-banner">
          <span class="tb-dot" />
          Scoped to <strong>{{ tenantScopeNs.join(', ') || 'your tenant' }}</strong>.
          Isolation is enforced by Vault Enterprise namespaces, not by this view.
        </div>
        <slot />
      </main>

      <!-- Footer -->
      <AppFooter />
    </div>

    <!-- ── Command palette ────────────────────────────────── -->
    <Transition name="cmd-fade">
      <div v-if="cmdOpen" class="cmd-overlay" @click.self="cmdOpen = false">
        <div class="cmd-panel">
          <div class="cmd-search-row">
            <svg class="cmd-search-icon" viewBox="0 0 16 16" fill="none">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.2"/>
              <line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
            <input
              ref="cmdInput"
              v-model="cmdQuery"
              class="cmd-input"
              placeholder="Go to page, find key, supplier…"
              @keydown.esc="cmdOpen = false"
              @keydown.enter="runFirstResult"
              @keydown.arrow-up.prevent="cmdCursor = Math.max(0, cmdCursor - 1)"
              @keydown.arrow-down.prevent="cmdCursor = Math.min(cmdResults.length - 1, cmdCursor + 1)"
            />
            <kbd class="cmd-esc">Esc</kbd>
          </div>

          <div v-if="cmdResults.length" class="cmd-results">
            <button
              v-for="(r, i) in cmdResults"
              :key="r.to"
              class="cmd-result"
              :class="{ active: i === cmdCursor }"
              @click="go(r.to)"
              @mouseover="cmdCursor = i"
            >
              <span class="cmd-result-icon" v-html="r.icon" />
              <span class="cmd-result-label">{{ r.label }}</span>
              <span class="cmd-result-category">{{ r.category }}</span>
            </button>
          </div>

          <div v-else-if="cmdQuery" class="cmd-empty">
            No results for <em>{{ cmdQuery }}</em>
          </div>

          <div v-else class="cmd-hint">
            Type to search pages, keys, suppliers, or applications.
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useArcaniumApi } from '~/composables/useArcaniumApi'
import { useClusterHealth } from '~/composables/useClusterHealth'

const route = useRoute()
const router = useRouter()
const { approvals, reconciliationList } = useArcaniumApi()
const { status: clusterStatus, refresh: refreshCluster, error: clusterError, nodes: clusterNodes, healthyCount, loading: clusterLoading } = useClusterHealth()
onMounted(refreshCluster)
usePolling(refreshCluster, 5000)
usePolling(loadPendingCount, 10000)

const config = useRuntimeConfig()
// Vault UI runs independently of Arcanium — link out, never proxy.
const vaultUiUrl = (config.public.vaultUiUrl as string) || 'http://localhost:18200'

// Prompt 14.5 — persona from the session (or "Operator" when auth is disabled).
// Prompt 18 — also surfaces who is actually signed in (username + OIDC groups),
// not just the role label, so "authenticated" is visibly provable in the UI
// itself, not just true in the network tab.
const { me, logout } = useArcaniumApi()
const authEnabled = ref(false)
const persona = ref('operator')
const username = ref('')
const authGroups = ref<string[]>([])
const tenantScopeNs = ref<string[]>([])
const personaLabel = computed(() =>
  persona.value ? persona.value.charAt(0).toUpperCase() + persona.value.slice(1).replace('-', ' ') : 'Operator',
)
onMounted(async () => {
  try {
    const m = await me()
    authEnabled.value = m.enabled !== false
    persona.value = m.persona || 'operator'
    username.value = m.user || ''
    authGroups.value = m.groups || []
    tenantScopeNs.value = m.namespaces || []
  } catch { /* not signed in — global middleware handles the redirect */ }
})
async function signOut() {
  try {
    const { logoutUrl } = await logout()
    // Prompt 18 — complete RP-initiated logout at Keycloak too (not just the
    // Arcanium session) via a real full-page navigation, same reasoning as
    // the sign-in redirect in app/pages/login.vue.
    if (logoutUrl) { window.location.href = logoutUrl; return }
  } catch { /* ignore */ }
  navigateTo('/login')
}

// ── Account details popover ────────────────────────────────
const userMenuOpen = ref(false)
const userMenuRef = ref<HTMLElement | null>(null)
function onClickOutsideUserMenu(e: MouseEvent) {
  if (userMenuOpen.value && userMenuRef.value && !userMenuRef.value.contains(e.target as Node)) {
    userMenuOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onClickOutsideUserMenu))
onUnmounted(() => document.removeEventListener('click', onClickOutsideUserMenu))

// ── Sidebar state ──────────────────────────────────────────
const sidebarCollapsed = ref(false)

// ── Pending approvals count ────────────────────────────────
const pendingCount = ref(0)
async function loadPendingCount() {
  try {
    const data = await approvals()
    pendingCount.value = Array.isArray(data) ? data.filter((a: any) => a.status === 'pending').length : 0
  } catch {}
}
onMounted(() => loadPendingCount())

// ── Drift count (Prompt 20) ─────────────────────────────────
const driftCount = ref(0)
async function loadDriftCount() {
  try {
    const data = await reconciliationList({ status: 'drifted' })
    driftCount.value = Array.isArray(data) ? data.length : 0
  } catch {}
}
onMounted(() => loadDriftCount())

// ── Cluster status ─────────────────────────────────────────
const clusterStatusClass = computed(() => {
  if (!clusterStatus.value || clusterStatus.value.unknown) return 'unknown'
  if (clusterStatus.value.healthy) return 'healthy'
  if (clusterStatus.value.degraded) return 'degraded'
  return 'critical'
})
const clusterStatusTitle = computed(() =>
  clusterStatus.value?.summary ?? 'Polling Vault node health via the Arcanium API'
)
const nodeCounts = computed(() => `${healthyCount.value}/${clusterNodes.value.length}`)
const clusterLabel = computed(() => {
  // First poll in flight — show a determinate label, never a stuck "Connecting…"
  if (!clusterStatus.value) return clusterLoading.value ? 'Checking nodes…' : 'Cluster —'
  if (clusterStatus.value.unknown) return 'Cluster unavailable'
  if (clusterStatus.value.healthy) return `Cluster · ${nodeCounts.value} nodes`
  if (clusterStatus.value.degraded) return `Cluster degraded · ${nodeCounts.value}`
  return 'Cluster critical'
})

// ── Nav items ──────────────────────────────────────────────
const NAV_ICONS = {
  dashboard: `<svg viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>`,
  suppliers: `<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.2"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="13" cy="5" r="2" stroke="currentColor" stroke-width="1" opacity=".5"/></svg>`,
  applications: `<svg viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/><line x1="5" y1="6" x2="11" y2="6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="9" x2="9" y2="9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  keys: `<svg viewBox="0 0 16 16" fill="none"><circle cx="6" cy="8" r="4" stroke="currentColor" stroke-width="1.2"/><line x1="9.5" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="13" y1="8" x2="13" y2="10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="15" y1="8" x2="15" y2="10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  approvals: `<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="4" x2="8" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.8" fill="currentColor"/></svg>`,
  evidence: `<svg viewBox="0 0 16 16" fill="none"><path d="M3 2h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.2"/><line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".6"/><line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".6"/><line x1="5" y1="11" x2="8" y2="11" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".6"/></svg>`,
  cluster: `<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="4" r="2" stroke="currentColor" stroke-width="1.2"/><circle cx="3" cy="12" r="2" stroke="currentColor" stroke-width="1.2"/><circle cx="13" cy="12" r="2" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="6" x2="3.5" y2="10" stroke="currentColor" stroke-width="1" opacity=".6"/><line x1="8" y1="6" x2="12.5" y2="10" stroke="currentColor" stroke-width="1" opacity=".6"/></svg>`,
  jobs: `<svg viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="10" width="12" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="4.5" r="0.6" fill="currentColor"/><circle cx="5" cy="11.5" r="0.6" fill="currentColor"/></svg>`,
  onboard: `<svg viewBox="0 0 16 16" fill="none"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  integrations: `<svg viewBox="0 0 16 16" fill="none"><circle cx="4" cy="8" r="2.5" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="4" r="2" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="12" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M6.2 6.8 10.2 4.8M6.2 9.2l4 2" stroke="currentColor" stroke-width="1.1"/></svg>`,
  maturity: `<svg viewBox="0 0 16 16" fill="none"><polyline points="2,12 6,7 9,10 14,4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  observability: `<svg viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2"/></svg>`,
  reconciliation: `<svg viewBox="0 0 16 16" fill="none"><path d="M13 4a5 5 0 0 0-8.9-1.6M3 12a5 5 0 0 0 8.9 1.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M13 1.5V4h-2.5M3 14.5V12h2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
}

const isSupplierAdmin = computed(() => persona.value === 'supplier-admin')

const navItems = computed(() => {
  const all = [
    { to: '/', label: 'Dashboard', icon: NAV_ICONS.dashboard, exact: true },
    { to: '/suppliers', label: 'Suppliers', icon: NAV_ICONS.suppliers, platform: true },
    { to: '/applications', label: 'Applications', icon: NAV_ICONS.applications },
    { to: '/keys', label: 'Keys', icon: NAV_ICONS.keys },
    { to: '/reconciliation', label: 'Reconciliation', icon: NAV_ICONS.reconciliation, badge: driftCount.value > 0 ? driftCount.value : undefined, badgeType: 'critical' },
    { to: '/onboard', label: 'Onboard', icon: NAV_ICONS.onboard },
    {
      to: '/approvals',
      label: 'Approvals',
      icon: NAV_ICONS.approvals,
      badge: pendingCount.value > 0 ? pendingCount.value : undefined,
      badgeType: 'governance',
    },
    { to: '/evidence', label: 'Evidence', icon: NAV_ICONS.evidence },
    { to: '/integrations', label: 'Integrations', icon: NAV_ICONS.integrations },
    { to: '/jobs', label: 'Jobs', icon: NAV_ICONS.jobs, platform: true },
    { to: '/cluster', label: 'Cluster', icon: NAV_ICONS.cluster, platform: true },
    { to: '/maturity', label: 'Maturity', icon: NAV_ICONS.maturity },
    { to: '/observability', label: 'Observability', icon: NAV_ICONS.observability, platform: true },
  ]
  return isSupplierAdmin.value ? all.filter((i) => !i.platform) : all
})

function isActive(item: { to: string; exact?: boolean }) {
  if (item.exact) return route.path === item.to
  return route.path.startsWith(item.to)
}

// ── Page title ─────────────────────────────────────────────
const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/suppliers': 'Suppliers',
  '/applications': 'Applications',
  '/keys': 'Key Inventory',
  '/reconciliation': 'Reconciliation',
  '/approvals': 'Approvals',
  '/evidence': 'Evidence Trail',
  '/jobs': 'Provisioning Jobs',
  '/onboard': 'Onboard a Workload',
  '/integrations': 'Integration Channels',
  '/cluster': 'Cluster Health',
  '/maturity': 'Maturity',
  '/observability': 'Observability',
}
const currentTitle = computed(() => {
  // Exact match first
  if (PAGE_TITLES[route.path]) return PAGE_TITLES[route.path]
  // Prefix match
  for (const [prefix, title] of Object.entries(PAGE_TITLES)) {
    if (prefix !== '/' && route.path.startsWith(prefix)) return title
  }
  return 'Arcanium'
})

// ── Command palette ────────────────────────────────────────
const cmdOpen = ref(false)
const cmdQuery = ref('')
const cmdCursor = ref(0)
const cmdInput = ref<HTMLInputElement | null>(null)

const ALL_CMDS = [
  { to: '/', label: 'Dashboard', category: 'Page', icon: NAV_ICONS.dashboard },
  { to: '/suppliers', label: 'Suppliers', category: 'Page', icon: NAV_ICONS.suppliers },
  { to: '/applications', label: 'Applications', category: 'Page', icon: NAV_ICONS.applications },
  { to: '/keys', label: 'Key Inventory', category: 'Page', icon: NAV_ICONS.keys },
  { to: '/reconciliation', label: 'Reconciliation', category: 'Page', icon: NAV_ICONS.reconciliation },
  { to: '/approvals', label: 'Approvals', category: 'Page', icon: NAV_ICONS.approvals },
  { to: '/evidence', label: 'Evidence Trail', category: 'Page', icon: NAV_ICONS.evidence },
  { to: '/jobs', label: 'Provisioning Jobs', category: 'Page', icon: NAV_ICONS.jobs },
  { to: '/onboard', label: 'Onboard a Workload', category: 'Page', icon: NAV_ICONS.onboard },
  { to: '/integrations', label: 'Integration Channels', category: 'Page', icon: NAV_ICONS.integrations },
  { to: '/cluster', label: 'Cluster Health', category: 'Page', icon: NAV_ICONS.cluster },
  { to: '/maturity', label: 'Maturity', category: 'Page', icon: NAV_ICONS.maturity },
  { to: '/observability', label: 'Observability', category: 'Page', icon: NAV_ICONS.observability },
]

const cmdResults = computed(() => {
  if (!cmdQuery.value.trim()) return ALL_CMDS.slice(0, 6)
  const q = cmdQuery.value.toLowerCase()
  return ALL_CMDS.filter(c => c.label.toLowerCase().includes(q))
})

watch(cmdOpen, async (open) => {
  if (open) {
    cmdQuery.value = ''
    cmdCursor.value = 0
    await nextTick()
    cmdInput.value?.focus()
  }
})

function go(to: string) {
  cmdOpen.value = false
  router.push(to)
}
function runFirstResult() {
  if (cmdResults.value[cmdCursor.value]) go(cmdResults.value[cmdCursor.value].to)
}

// Global ⌘K handler
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    cmdOpen.value = !cmdOpen.value
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
/* ── Shell grid ─────────────────────────────────────────── */
.arc-shell {
  display: flex;
  min-height: 100vh;
  background: transparent;
}

/* ── Sidebar ─────────────────────────────────────────────── */
.arc-sidebar {
  width: var(--sidebar-w);
  min-height: 100vh;
  background: linear-gradient(180deg, rgba(0, 20, 60, 0.72), rgba(0, 12, 40, 0.72));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-right: 1px solid var(--arc-glass-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: width 0.2s ease;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
}
.arc-sidebar.collapsed { width: 52px; }

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  height: var(--topbar-h);
  border-bottom: 1px solid var(--arc-border-subtle);
  flex-shrink: 0;
}
.brand-icon { width: 22px; height: 22px; flex-shrink: 0; }
.brand-name {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--arc-text-primary);
  white-space: nowrap;
}

.sidebar-nav {
  flex: 1;
  padding: 12px 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  height: 38px;
  font-size: 13px;
  color: var(--arc-text-secondary);
  text-decoration: none;
  border-radius: 0;
  transition: background 0.12s, color 0.12s;
  white-space: nowrap;
  position: relative;
}
.nav-item:hover { background: rgba(255,255,255,0.04); color: var(--arc-text-primary); }
.nav-item.active {
  background: var(--arc-selected);
  color: var(--arc-action-hover);
  border-left: 2px solid var(--arc-action-primary);
  padding-left: 12px;
}
.nav-icon { width: 16px; height: 16px; flex-shrink: 0; display: flex; align-items: center; }
.nav-icon :deep(svg) { width: 16px; height: 16px; }
.nav-label { flex: 1; }
.nav-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  line-height: 1.6;
}
.nav-badge.governance {
  background: var(--arc-pending-bg);
  color: var(--arc-governance);
  border: 1px solid rgba(255,170,0,0.3);
}
.nav-badge.critical {
  background: var(--arc-critical-bg);
  color: var(--arc-critical);
  border: 1px solid rgba(220,47,2,0.3);
}

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--arc-border-subtle);
}
.sidebar-toggle {
  background: none;
  border: 1px solid var(--arc-border-subtle);
  border-radius: 6px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--arc-text-muted);
  transition: background 0.12s, color 0.12s;
}
.sidebar-toggle:hover { background: rgba(255,255,255,0.06); color: var(--arc-text-secondary); }
.sidebar-toggle svg { width: 14px; height: 14px; }

/* ── Main area ───────────────────────────────────────────── */
.arc-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* ── Topbar ──────────────────────────────────────────────── */
.arc-topbar {
  height: var(--topbar-h);
  background: rgba(0, 16, 44, 0.68);
  backdrop-filter: blur(14px) saturate(1.1);
  -webkit-backdrop-filter: blur(14px) saturate(1.1);
  border-bottom: 1px solid var(--arc-glass-border);
  display: flex;
  align-items: center;
  padding: 0 24px;
  gap: 14px;
  position: sticky;
  top: 0;
  z-index: 10;
  flex-shrink: 0;
}
.topbar-left { flex: 0 1 auto; min-width: 0; }
.page-title { font-size: 15px; font-weight: 600; color: var(--arc-text-primary); margin: 0; white-space: nowrap; }
.topbar-centre { flex: 1 1 auto; min-width: 120px; max-width: 360px; }
.topbar-right { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.topbar-right > * { white-space: nowrap; flex-shrink: 0; }

.cmd-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: var(--arc-bg-surface);
  border: 1px solid var(--arc-border-subtle);
  border-radius: 8px;
  padding: 0 12px;
  height: 34px;
  cursor: pointer;
  color: var(--arc-text-muted);
  font-size: 13px;
  transition: border-color 0.12s;
}
.cmd-trigger:hover { border-color: var(--arc-border-strong); color: var(--arc-text-secondary); }
.cmd-trigger svg { width: 14px; height: 14px; flex-shrink: 0; }
.cmd-trigger span { flex: 1; text-align: left; }
.cmd-trigger kbd { font-size: 11px; opacity: 0.5; }

.cluster-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 100px;
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  cursor: default;
}
.cluster-pill.healthy { background: var(--arc-healthy-bg); color: var(--arc-healthy); border: 1px solid rgba(34,197,94,0.2); }
.cluster-pill.degraded { background: rgba(244,140,6,0.1); color: var(--arc-warning); border: 1px solid rgba(244,140,6,0.2); }
.cluster-pill.critical { background: var(--arc-critical-bg); color: var(--arc-critical); border: 1px solid rgba(220,47,2,0.2); }
.cluster-pill.unknown { background: rgba(125,133,151,0.1); color: var(--arc-text-muted); border: 1px solid rgba(125,133,151,0.2); }
.cluster-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.cluster-dot.live { animation: arcPulse 2.4s ease infinite; box-shadow: 0 0 8px currentColor; }

.env-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--arc-text-muted);
  border: 1px solid var(--arc-glass-border);
  border-radius: 5px;
  padding: 3px 8px;
}

.vault-link {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--arc-text-muted);
  padding: 4px 10px;
  border: 1px solid var(--arc-glass-border);
  border-radius: 100px;
  transition: color 0.15s, border-color 0.15s;
}
.vault-link:hover { color: var(--arc-action-bright); border-color: rgba(0, 180, 216, 0.35); }
.vault-link svg { width: 13px; height: 13px; }

.user-menu { position: relative; }

.persona {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--arc-text-secondary);
  padding: 4px 10px 4px 8px;
  border: 1px solid var(--arc-glass-border);
  border-radius: 100px;
  background: none;
  font-family: inherit;
  cursor: pointer;
}
.persona:hover { color: var(--arc-text-primary); border-color: rgba(0, 180, 216, 0.35); }
.persona-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--arc-text-dim); }
.persona-dot--auth { background: var(--arc-action-bright); box-shadow: 0 0 0 2px rgba(0, 180, 216, 0.18); }

.user-menu-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 220px;
  background: var(--arc-glass);
  border: 1px solid var(--arc-glass-border);
  border-radius: 10px;
  box-shadow: var(--arc-shadow-lg);
  backdrop-filter: blur(14px);
  padding: 10px 12px;
  z-index: 40;
}
.umf-row { font-size: 12px; line-height: 1.5; }
.umf-row + .umf-row { margin-top: 4px; }
.umf-user { font-weight: 650; color: var(--arc-text-primary); font-size: 13px; }
.umf-meta { color: var(--arc-text-muted); }
.umf-groups { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.umf-chip {
  font-size: 10.5px;
  color: var(--arc-text-dim);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--arc-glass-border);
  border-radius: 100px;
  padding: 1px 8px;
}
.umf-signout {
  width: 100%;
  margin-top: 10px;
  padding: 6px 10px;
  font-size: 12px;
  font-family: inherit;
  color: var(--arc-text-secondary);
  background: none;
  border: 1px solid var(--arc-glass-border);
  border-radius: 6px;
  cursor: pointer;
}
.umf-signout:hover { color: var(--arc-text-primary); border-color: rgba(220, 90, 90, 0.4); }

@media (max-width: 1180px) {
  .env-badge, .vault-link span, .persona { display: none; }
}

.pending-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 100px;
  font-size: 12px;
  font-family: inherit;
  background: var(--arc-pending-bg);
  color: var(--arc-governance);
  border: 1px solid rgba(255,170,0,0.3);
  cursor: pointer;
  transition: background 0.12s;
}
.pending-pill:hover { background: rgba(255,170,0,0.2); }
.pending-pill svg { width: 14px; height: 14px; }

/* ── Content ─────────────────────────────────────────────── */
.arc-content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}
.tenant-banner {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 18px; padding: 10px 16px; border-radius: 10px;
  font-size: 12px; color: var(--arc-text-secondary);
  background: rgba(0, 119, 182, 0.08); border: 1px solid var(--arc-glass-border);
}
.tenant-banner strong { color: var(--arc-action-bright); font-family: ui-monospace, monospace; }
.tb-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--arc-action-bright); flex-shrink: 0; }

/* ── Command palette ─────────────────────────────────────── */
.cmd-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 8, 24, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 80px;
}
.cmd-panel {
  width: 100%;
  max-width: 560px;
  background: var(--arc-bg-elevated);
  border: 1px solid var(--arc-border-strong);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0,0,0,0.6);
}
.cmd-search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  height: 52px;
  border-bottom: 1px solid var(--arc-border-subtle);
}
.cmd-search-icon { width: 16px; height: 16px; color: var(--arc-text-muted); flex-shrink: 0; }
.cmd-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  font-size: 15px;
  color: var(--arc-text-primary);
  font-family: inherit;
}
.cmd-input::placeholder { color: var(--arc-text-muted); }
.cmd-esc {
  font-size: 11px;
  color: var(--arc-text-muted);
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--arc-border-subtle);
  border-radius: 4px;
  padding: 2px 6px;
}
.cmd-results { padding: 6px 0; max-height: 360px; overflow-y: auto; }
.cmd-result {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 0 16px;
  height: 44px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--arc-text-secondary);
  font-size: 13px;
  font-family: inherit;
  text-align: left;
  transition: background 0.1s;
}
.cmd-result:hover, .cmd-result.active { background: rgba(0,119,182,0.15); color: var(--arc-text-primary); }
.cmd-result-icon { width: 16px; height: 16px; color: var(--arc-action-bright); flex-shrink: 0; }
.cmd-result-icon :deep(svg) { width: 16px; height: 16px; }
.cmd-result-label { flex: 1; }
.cmd-result-category { font-size: 11px; color: var(--arc-text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.cmd-empty, .cmd-hint {
  padding: 20px 16px;
  font-size: 13px;
  color: var(--arc-text-muted);
  text-align: center;
}
.cmd-empty em { color: var(--arc-text-secondary); }

/* ── Transitions ─────────────────────────────────────────── */
.cmd-fade-enter-active, .cmd-fade-leave-active { transition: opacity 0.15s; }
.cmd-fade-enter-from, .cmd-fade-leave-to { opacity: 0; }
</style>
