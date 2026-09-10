// server/api/cluster-health.ts
// Fetches real per-node Vault health from the Arcanium API /api/v1/cluster route.
// Called by the browser via /api/cluster-health (same-origin Nitro endpoint).
// The browser never speaks to Vault or to the internal API directly.

export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const apiBase = config.arcaniumApiInternal as string

  try {
    const data = await $fetch(`${apiBase}/api/v1/cluster`, {
      timeout: 8000,
    })
    return data
  } catch {
    // Return a degraded placeholder so the UI can show a meaningful state
    // rather than a hard error when the API is temporarily unreachable.
    return [
      { name: 'vault-s',   role: 'replication-primary',   reachable: false, health: null },
      { name: 'vault-1',   role: 'cluster-member',         reachable: false, health: null },
      { name: 'vault-2',   role: 'cluster-member',         reachable: false, health: null },
      { name: 'vault-3',   role: 'cluster-member',         reachable: false, health: null },
      { name: 'vault-hsm', role: 'autounseal-provider',    reachable: false, health: null },
    ]
  }
})
