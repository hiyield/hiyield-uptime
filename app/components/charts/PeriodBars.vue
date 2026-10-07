<script setup lang="ts">
import { AXIS_TEXT, GRID, formatBucketTime } from '~/utils/chartColors'

const props = withDefaults(
  defineProps<{
    periods: { start: number; end: number; value: number }[]
    color: string
    height?: number
    format: (v: number) => string
    tooltip: (i: number) => string[]
    label: string
  }>(),
  { height: 160 }
)
const max = computed(() => Math.max(0, ...props.periods.map((p) => p.value)))
const hover = ref<number | null>(null)
// Range changes (e.g. 53 periods -> 7) can leave a stale hovered index pointing past the new
// array end; clear it so the tooltip never reads an out-of-range period.
watch(
  () => props.periods.length,
  () => {
    hover.value = null
  }
)
const firstLabel = computed(() =>
  props.periods[0] ? formatBucketTime(props.periods[0].start, 86_400_000) : ''
)
const lastLabel = computed(() => {
  const p = props.periods[props.periods.length - 1]
  return p ? formatBucketTime(p.start, 86_400_000) : ''
})
</script>

<template>
  <div class="relative">
    <div class="mb-1 flex justify-between font-mono text-[10px]" :style="{ color: AXIS_TEXT }">
      <span>{{ max > 0 ? format(max) : '' }}</span>
    </div>
    <div
      class="relative flex items-end gap-0.5 border-b"
      :style="{ height: `${height}px`, borderColor: GRID }"
      role="img"
      :aria-label="label"
      @pointerleave="hover = null"
    >
      <div
        class="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed"
        :style="{ borderColor: GRID }"
      />
      <div
        v-for="(p, i) in periods"
        :key="p.start"
        class="flex h-full flex-1 flex-col justify-end"
        @pointerenter="hover = i"
      >
        <div
          v-if="p.value > 0"
          class="w-full rounded-t-[3px]"
          :style="{
            height: `${(p.value / (max || 1)) * 100}%`,
            minHeight: '2px',
            background: color,
            opacity: hover === null || hover === i ? 1 : 0.6
          }"
        />
      </div>
    </div>
    <div class="mt-1 flex justify-between text-[10px]" :style="{ color: AXIS_TEXT }">
      <span>{{ firstLabel }}</span>
      <span>{{ lastLabel }}</span>
    </div>
    <div
      v-if="hover != null && hover < periods.length"
      class="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-accented bg-elevated px-2 py-1 text-xs text-highlighted"
      :style="{ left: `${((hover + 0.5) / periods.length) * 100}%` }"
    >
      <div v-for="l in tooltip(hover)" :key="l">{{ l }}</div>
    </div>
  </div>
</template>
