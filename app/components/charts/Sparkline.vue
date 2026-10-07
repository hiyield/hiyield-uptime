<script setup lang="ts">
import { formatBucketTime, NEUTRAL_BAR, SERIES } from '~/utils/chartColors'

const props = withDefaults(
  defineProps<{
    values: (number | null)[]
    times: number[]
    format: (v: number) => string
    kind?: 'line' | 'bars'
    label: string
  }>(),
  { kind: 'line' }
)

const W = 120
const H = 32
const P = 2
const nums = computed(() => props.values.filter((v): v is number => v != null))
const max = computed(() => Math.max(1, ...nums.value))
const min = computed(() => (props.kind === 'bars' || !nums.value.length ? 0 : Math.min(...nums.value)))
const n = computed(() => props.values.length)
const x = (i: number) => P + (n.value <= 1 ? 0 : (i / (n.value - 1)) * (W - 2 * P))
const y = (v: number) => H - P - ((v - min.value) / (max.value - min.value || 1)) * (H - 2 * P)

/** Runs of consecutive non-null points; a null is a gap, never zero. */
const runs = computed(() => {
  const out: { i: number; v: number }[][] = []
  let cur: { i: number; v: number }[] = []
  props.values.forEach((v, i) => {
    if (v == null) {
      if (cur.length) out.push(cur)
      cur = []
    } else cur.push({ i, v })
  })
  if (cur.length) out.push(cur)
  return out
})

const barW = computed(() => Math.max(1, (W - 2 * P) / Math.max(1, n.value) - 1))
const hover = ref<number | null>(null)
const span = computed(() => (props.times.length > 1 ? props.times[1]! - props.times[0]! : 0))

function onMove(e: PointerEvent) {
  const r = (e.currentTarget as Element).getBoundingClientRect()
  const i = Math.round(((e.clientX - r.left) / r.width) * (n.value - 1))
  hover.value = Math.max(0, Math.min(n.value - 1, i))
}

const tip = computed(() => {
  if (hover.value == null) return null
  const v = props.values[hover.value]
  const t = props.times[hover.value]
  return {
    left: `${(x(hover.value) / W) * 100}%`,
    text: `${v == null ? 'No data' : props.format(v)} · ${t != null ? formatBucketTime(t, span.value) : ''}`
  }
})
</script>

<template>
  <div class="relative">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      class="h-8 w-full"
      role="img"
      :aria-label="label"
      @pointermove="onMove"
      @pointerleave="hover = null"
    >
      <template v-if="kind === 'line'">
        <template v-for="(run, ri) in runs" :key="ri">
          <polyline
            v-if="run.length > 1"
            :points="run.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')"
            fill="none"
            :stroke="SERIES"
            stroke-width="1.5"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
          <circle v-else :cx="x(run[0]!.i)" :cy="y(run[0]!.v)" r="1.5" :fill="SERIES" />
        </template>
      </template>
      <template v-else>
        <rect
          v-for="(v, i) in values"
          :key="i"
          :x="P + i * ((W - 2 * P) / n)"
          :y="v ? y(v) : H - P - 1"
          :width="barW"
          :height="v ? H - P - y(v) : 1"
          :fill="v ? SERIES : NEUTRAL_BAR"
          rx="1"
        />
      </template>
      <line
        v-if="hover != null"
        :x1="x(hover)"
        :x2="x(hover)"
        y1="0"
        :y2="H"
        stroke="rgba(255,255,255,0.35)"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <div
      v-if="tip"
      class="pointer-events-none absolute -top-8 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-accented bg-elevated px-2 py-1 font-mono text-xs text-highlighted"
      :style="{ left: tip.left }"
    >
      {{ tip.text }}
    </div>
  </div>
</template>
