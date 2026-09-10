<script setup lang="ts">
defineProps<{ open: boolean; title: string; description: string }>()
defineEmits<{ 'update:open': [value: boolean] }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="mgmt-fade">
      <div v-if="open" class="management-overlay" @click.self="$emit('update:open', false)" />
    </Transition>
    <Transition name="mgmt-scale">
      <div v-if="open" class="management-dialog" role="dialog" :aria-modal="true" :aria-labelledby="'mgmt-title'" :aria-describedby="'mgmt-desc'">
        <header>
          <div>
            <h2 id="mgmt-title">{{ title }}</h2>
            <p id="mgmt-desc">{{ description }}</p>
          </div>
          <button class="page-btn" aria-label="Close dialog" @click="$emit('update:open', false)">✕</button>
        </header>
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.management-overlay {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
}
.management-dialog {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: min(540px, 94vw); max-height: 90vh; overflow: auto;
  padding: 28px; z-index: 10001;
  background: var(--arc-bg-card);
  border: 1px solid var(--arc-border-strong);
  border-radius: 18px;
  box-shadow: 0 30px 100px rgba(0, 0, 0, 0.5);
}
.management-dialog header {
  display: flex; gap: 20px; justify-content: space-between; margin-bottom: 24px;
}
.management-dialog h2 { font-size: 23px; margin: 0; color: var(--arc-text-primary); }
.management-dialog p { font-size: 13px; color: var(--arc-text-muted); margin: 8px 0 0; }
.page-btn {
  align-self: flex-start; color: var(--arc-text-secondary);
  background: none; border: 0; padding: 7px; cursor: pointer; font-size: 16px;
}
.page-btn:hover { color: var(--arc-text-primary); }

.mgmt-fade-enter-active, .mgmt-fade-leave-active { transition: opacity 0.2s ease; }
.mgmt-fade-enter-from, .mgmt-fade-leave-to { opacity: 0; }
.mgmt-scale-enter-active, .mgmt-scale-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.mgmt-scale-enter-from, .mgmt-scale-leave-to { opacity: 0; transform: translate(-50%, -48%) scale(0.97); }
</style>
