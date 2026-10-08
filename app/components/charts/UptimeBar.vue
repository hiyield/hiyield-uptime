<script setup lang="ts">
import type { BarState, BarStat } from '~~/server/utils/boardCharts'
import { formatBucketTime, STATE_COLOR, STATE_HEIGHT, STATE_LABEL } from '~/utils/chartColors'

const props = defineProps<{ states: BarState[]; stats: BarStat[]; starts: number[] }>()
const SLOT = 1_800_000
const hover = ref<number | null>(null)
const counts = computed(() => {
  const c = { down: 0, blip: 0 }
  for (const s of props.states) if (s === 'down' || s === 'blip') c[s]++
  return c
})
const summary = computed(
  () =>
    `Last 24 hours: ${counts.value.down} half-hours with downtime, ${counts.value.blip} with unconfirmed blips`
)
// Near the first/last ~15% of bars a centred tooltip gets clipped by an ancestor's
// `overflow-hidden` (e.g. UTable). Pin it to that edge instead of centring it there, and render
// it below the bar rather than above — above gets clipped by the table header on the first row.
const EDGE = 0.15
const tip = computed(() => {
  if (hover.value == null) return null
  const i = hover.value
  const s = props.stats[i]!
  const start = props.starts[i]!
  const frac = (i + 0.5) / props.states.length
  const align = frac < EDGE ? 'start' : frac > 1 - EDGE ? 'end' : 'center'
  return {
    align,
    style: align === 'start' ? { left: '0' } : align === 'end' ? { right: '0' } : { left: `${frac * 100}%` },
    lines: [
      `${formatBucketTime(start, 0)}–${formatBucketTime(start + SLOT, 0)} · ${STATE_LABEL[props.states[i]!]}`,
      `${s.checks} checks, ${s.failures} failures${s.avgMs != null ? `, avg ${s.avgMs} ms` : ''}`
    ]
  }
})
</script>

<template>
  <div class="relative w-48">
    <div class="flex h-6 items-end gap-px" role="img" :aria-label="summary" @pointerleave="hover = null">
      <div
        v-for="(state, i) in states"
        :key="i"
        class="flex h-full flex-1 cursor-default flex-col justify-end"
        @pointerenter="hover = i"
      >
        <div
          class="w-full rounded-[1px]"
          :style="{ height: `${STATE_HEIGHT[state]}%`, background: STATE_COLOR[state] }"
        />
      </div>
    </div>
    <div
      v-if="tip"
      class="pointer-events-none absolute top-full z-10 mt-1 whitespace-nowrap rounded-md border border-accented bg-elevated px-2 py-1 text-xs text-highlighted"
      :class="tip.align === 'center' ? '-translate-x-1/2' : ''"
      :style="tip.style"
    >
      <div v-for="l in tip.lines" :key="l">{{ l }}</div>
    </div>
  </div>
</template>
