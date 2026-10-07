<script setup lang="ts">
const props = defineProps<{
  rows: { id: string; name: string; value: number; marker?: number; meta?: string }[]
  color: string
  format: (v: number) => string
  empty: string
}>()
const max = computed(() => Math.max(1, ...props.rows.map((r) => Math.max(r.value, r.marker ?? 0))))
</script>

<template>
  <ol v-if="rows.length" class="space-y-2">
    <li
      v-for="r in rows"
      :key="r.id"
      class="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm"
    >
      <NuxtLink :to="`/monitors/${r.id}`" class="truncate font-medium hover:underline">{{ r.name }}</NuxtLink>
      <div class="relative h-2 rounded-full bg-accented/40">
        <div class="h-2 rounded-full" :style="{ width: `${(r.value / max) * 100}%`, background: color }" />
        <div
          v-if="r.marker != null"
          class="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-white/70"
          :style="{ left: `${(r.marker / max) * 100}%` }"
          :title="`Worst: ${format(r.marker)}`"
        />
      </div>
      <span class="whitespace-nowrap font-mono text-xs text-muted">
        {{ format(r.value) }}<template v-if="r.marker != null"> ({{ format(r.marker) }})</template>
        <template v-if="r.meta"> · {{ r.meta }}</template>
      </span>
    </li>
  </ol>
  <p v-else class="py-6 text-center text-sm text-dimmed">{{ empty }}</p>
</template>
