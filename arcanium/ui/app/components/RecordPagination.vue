<script setup lang="ts">
const props = defineProps<{ total: number; page: number; pageSize?: number }>()
const emit = defineEmits<{ 'update:page': [page: number] }>()
const size = computed(() => props.pageSize || 10)
const pages = computed(() => Math.max(1, Math.ceil(props.total / size.value)))
const count = computed(() => Math.max(0, Math.min(size.value, props.total - (props.page - 1) * size.value)))
watch(pages, n => { if (props.page > n) emit('update:page', n) })
</script>
<template><nav class="record-pagination" aria-label="Record pagination"><span role="status">Showing <strong>{{ count }}</strong> out of <strong>{{ total }}</strong><span v-if="total" class="range"> · {{ (page - 1) * size + 1 }}–{{ Math.min(page * size, total) }}</span></span><div><button class="page-btn" :disabled="page <= 1" aria-label="Previous page" @click="emit('update:page', page - 1)">← Previous</button><span>Page {{ page }} of {{ pages }}</span><button class="page-btn" :disabled="page >= pages" aria-label="Next page" @click="emit('update:page', page + 1)">Next →</button></div></nav></template>
<style scoped>
.record-pagination{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 16px;border-top:1px solid var(--arc-border-subtle);font-size:12px;color:var(--arc-text-muted)}.record-pagination>div{display:flex;align-items:center;gap:16px}.record-pagination strong{color:var(--arc-text-primary)}.page-btn{border:1px solid var(--arc-border-strong);background:transparent;color:var(--arc-text-secondary);padding:7px 12px;border-radius:7px;cursor:pointer}.page-btn:disabled{opacity:.4;cursor:default}@media(max-width:650px){.record-pagination{flex-direction:column}.range{display:none}}
</style>
