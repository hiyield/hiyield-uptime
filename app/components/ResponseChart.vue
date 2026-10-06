<script setup lang="ts">
// Single-series line chart (dataviz skill: palette.md light-mode tokens — this app is
// light-only, see nuxt.config.ts colorMode). One series needs no legend; the card
// header already names what's plotted. Hover adds a crosshair + tooltip per
// interaction.md, with the same readout reachable on keyboard focus and via the
// sr-only table below for anyone who can't use either.
const props = defineProps<{ points: { t: number; avgMs: number }[]; from: number; to: number }>()

const W = 640
const H = 160
const PAD = { top: 12, right: 12, bottom: 24, left: 48 }

// palette.md — light-mode chart chrome & categorical slot 1 (blue)
const INK_SECONDARY = '#52514e'
const INK_MUTED = '#898781'
const GRIDLINE = '#e1e0d9'
const BASELINE = '#c3c2b7'
const SURFACE = '#fcfcfb'
const SERIES = '#2a78d6'

const maxMs = computed(() => Math.max(100, ...props.points.map((p) => p.avgMs)) * 1.1)
const x = (t: number) => PAD.left + ((t - props.from) / (props.to - props.from)) * (W - PAD.left - PAD.right)
const y = (ms: number) => PAD.top + (1 - ms / maxMs.value) * (H - PAD.top - PAD.bottom)
const path = computed(() =>
  props.points.map((p) => `${x(p.t).toFixed(1)},${y(p.avgMs).toFixed(1)}`).join(' ')
)
const ticks = computed(() => [0, Math.round(maxMs.value / 2), Math.round(maxMs.value)])
const label = (t: number) =>
  new Date(t).toLocaleString(
    'en-GB',
    props.to - props.from > 86_400_000
      ? { weekday: 'short', day: 'numeric' }
      : { hour: '2-digit', minute: '2-digit' }
  )

const last = computed(() => (props.points.length ? props.points[props.points.length - 1] : null))

// Hover crosshair + tooltip (interaction.md): the X is tracked to the nearest point,
// one readout lists value and time, reachable by pointer or by arrow-key focus.
const svgEl = useTemplateRef<SVGSVGElement>('svgEl')
const hoverIndex = ref<number | null>(null)
const hovered = computed(() => (hoverIndex.value != null ? (props.points[hoverIndex.value] ?? null) : null))
const tooltipStyle = computed(() => {
  if (!hovered.value) return {}
  const left = Math.min(94, Math.max(6, (x(hovered.value.t) / W) * 100))
  const top = Math.min(80, Math.max(4, (y(hovered.value.avgMs) / H) * 100))
  return { left: `${left}%`, top: `${top}%` }
})

function nearestIndex(clientX: number): number {
  const rect = svgEl.value!.getBoundingClientRect()
  const localX = ((clientX - rect.left) / rect.width) * W
  let best = 0
  let bestDist = Infinity
  props.points.forEach((p, i) => {
    const d = Math.abs(x(p.t) - localX)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  return best
}

function onPointerMove(e: PointerEvent) {
  hoverIndex.value = nearestIndex(e.clientX)
}
function onPointerLeave() {
  hoverIndex.value = null
}
function onFocus() {
  if (props.points.length) hoverIndex.value = props.points.length - 1
}
function onBlur() {
  hoverIndex.value = null
}
function onKeydown(e: KeyboardEvent) {
  if (!props.points.length) return
  if (e.key === 'ArrowRight') {
    hoverIndex.value = Math.min((hoverIndex.value ?? -1) + 1, props.points.length - 1)
    e.preventDefault()
  } else if (e.key === 'ArrowLeft') {
    hoverIndex.value = Math.max((hoverIndex.value ?? props.points.length) - 1, 0)
    e.preventDefault()
  } else if (e.key === 'Escape') {
    hoverIndex.value = null
  }
}
</script>

<template>
  <div class="relative">
    <svg
      v-if="points.length > 1"
      ref="svgEl"
      :viewBox="`0 0 ${W} ${H}`"
      class="h-40 w-full"
      role="img"
      tabindex="0"
      :aria-label="`Average response time, ${points.length} data points, last ${last ? `${last.avgMs} ms` : 'n/a'}`"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
    >
      <g v-for="tick in ticks" :key="tick">
        <line
          :x1="PAD.left"
          :x2="W - PAD.right"
          :y1="y(tick)"
          :y2="y(tick)"
          :stroke="GRIDLINE"
          stroke-width="1"
        />
        <text
          :x="PAD.left - 6"
          :y="y(tick) + 4"
          text-anchor="end"
          :fill="INK_MUTED"
          class="font-mono text-[10px]"
        >
          {{ tick }}ms
        </text>
      </g>

      <polyline
        :points="path"
        fill="none"
        :stroke="SERIES"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />

      <!-- direct end label (marks-and-anatomy.md: lines label the end, not every point) -->
      <template v-if="last">
        <circle :cx="x(last.t)" :cy="y(last.avgMs)" r="4" :fill="SERIES" :stroke="SURFACE" stroke-width="2" />
        <text
          :x="x(last.t) - 8"
          :y="Math.max(10, y(last.avgMs) - 8)"
          text-anchor="end"
          :fill="INK_SECONDARY"
          class="font-mono text-[10px]"
        >
          {{ last.avgMs }}ms
        </text>
      </template>

      <!-- hover crosshair -->
      <template v-if="hovered">
        <line
          :x1="x(hovered.t)"
          :x2="x(hovered.t)"
          :y1="PAD.top"
          :y2="H - PAD.bottom"
          :stroke="BASELINE"
          stroke-width="1"
        />
        <circle
          :cx="x(hovered.t)"
          :cy="y(hovered.avgMs)"
          r="4"
          :fill="SERIES"
          :stroke="SURFACE"
          stroke-width="2"
        />
      </template>

      <text :x="PAD.left" :y="H - 4" :fill="INK_MUTED" class="text-[10px]">{{ label(from) }}</text>
      <text :x="W - PAD.right" :y="H - 4" text-anchor="end" :fill="INK_MUTED" class="text-[10px]">
        {{ label(to) }}
      </text>
    </svg>
    <div v-else class="flex h-40 items-center justify-center text-sm text-[#898781]">Not enough data yet</div>

    <div
      v-if="hovered"
      class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-black/10 bg-[#fcfcfb] px-2 py-1 text-xs whitespace-nowrap shadow-sm"
      :style="tooltipStyle"
    >
      <div class="flex items-center gap-1.5">
        <span class="inline-block h-0.5 w-2.5 rounded-full" :style="{ backgroundColor: SERIES }" />
        <span class="font-mono font-semibold text-[#0b0b0b]">{{ hovered.avgMs }}ms</span>
      </div>
      <div class="text-[#52514e]">{{ formatDateTime(hovered.t) }}</div>
    </div>

    <table v-if="points.length > 1" class="sr-only">
      <caption>
        Average response time by check
      </caption>
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Response time</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in points" :key="p.t">
          <td>{{ formatDateTime(p.t) }}</td>
          <td>{{ p.avgMs }} ms</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
