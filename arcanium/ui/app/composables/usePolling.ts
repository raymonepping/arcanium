export function usePolling(refresh: () => Promise<unknown>, interval: number) {
  let timer: ReturnType<typeof setInterval> | undefined
  let busy = false
  onMounted(() => { timer = setInterval(async () => {
    if (document.hidden || busy) return
    busy = true
    try { await refresh() } finally { busy = false }
  }, interval) })
  onUnmounted(() => clearInterval(timer))
}
