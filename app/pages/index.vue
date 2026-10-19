<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { BoardRow, BoardRowWithCharts } from '~~/server/utils/stats'
import type { BoardSummary } from '~~/server/utils/boardCharts'
import { formatDuration, formatInterval } from '~~/shared/utils/format'

const lastUpdated = ref<number | null>(null)
const { data, error, refresh } = await useFetch<{ monitors: BoardRowWithCharts[]; summary: BoardSummary }>(
  '/api/monitors',
  {
    onResponse({ response }) {
      if (response.ok) lastUpdated.value = Date.now()
    }
  }
)
useIntervalFn(() => refresh(), 15_000)
// Keep showing the last good board if a refresh fails (wall board: never flash "no monitors").
const lastGood = ref<BoardRowWithCharts[] | null>(null)
const lastSummary = ref<BoardSummary | null>(null)
watch(
  data,
  (v) => {
    if (v) {
      lastGood.value = v.monitors
      lastSummary.value = v.summary
    }
  },
  { immediate: true }
)
const loaded = computed(() => lastGood.value !== null)
const lastUpdatedLabel = computed(() =>
  lastUpdated.value ? new Date(lastUpdated.value).toLocaleTimeString('en-GB', { hour12: false }) : null
)
// @vueuse/core 15 dropped the `interval` shorthand in favour of a `scheduler`; this ticks `now` every second.
const now = useNow({ scheduler: (cb) => useIntervalFn(cb, 1000) })

type Filter = 'all' | 'down' | 'up' | 'paused'
const search = ref('')
const filter = ref<Filter>('all')
// Tag filter lives in the URL (?tag=kinsta) so a chip or a shared link lands on the filtered board.
const route = useRoute()
const router = useRouter()
const tag = computed({
  get: () => (typeof route.query.tag === 'string' ? route.query.tag : ''),
  set: (v: string) => {
    void router.replace({ query: { ...route.query, tag: v || undefined } })
  }
})
const filterItems: { label: string; value: Filter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Down / suspect', value: 'down' },
  { label: 'Up', value: 'up' },
  { label: 'Paused', value: 'paused' }
]

const monitors = computed(() => lastGood.value ?? [])
const tagItems = computed(() => {
  const counts = new Map<string, number>()
  for (const m of monitors.value) for (const t of m.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  const items = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, n]) => ({ label: `${t} (${n})`, value: t }))
  // Keep a tag from the URL selectable even if no monitor carries it any more.
  if (tag.value && !counts.has(tag.value)) items.push({ label: `${tag.value} (0)`, value: tag.value })
  return [{ label: 'All tags', value: '' }, ...items]
})
const isDown = (m: BoardRow) => m.status === 'down' || m.status === 'suspect'
const isUp = (m: BoardRow) => m.status === 'up' || m.status === 'unknown'

const pct = (v: number | null) => (v == null ? '—' : `${v}%`)
const ms = (v: number | null) => (v == null ? '—' : `${v} ms`)
const incidentDelta = computed(() => {
  const s = lastSummary.value
  if (!s) return undefined
  const d = s.incidents7d - s.incidentsPrev7d
  return d === 0 ? 'same as previous 7 days' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} vs previous 7 days`
})
const counts = computed(() => ({
  down: monitors.value.filter(isDown).length,
  up: monitors.value.filter(isUp).length,
  paused: monitors.value.filter((m) => m.status === 'paused').length
}))

const rows = computed(() =>
  monitors.value.filter((m) => {
    const q = search.value.trim().toLowerCase()
    if (q && !m.name.toLowerCase().includes(q) && !m.url.toLowerCase().includes(q)) return false
    if (tag.value && !m.tags.includes(tag.value)) return false
    if (filter.value === 'down') return isDown(m)
    if (filter.value === 'up') return isUp(m)
    if (filter.value === 'paused') return m.status === 'paused'
    return true
  })
)

const ago = (t: number | null) => (t ? `${formatDuration(now.value.getTime() - t)} ago` : '—')

const columns: TableColumn<BoardRowWithCharts>[] = [
  { id: 'status', header: 'Status' },
  { accessorKey: 'name', header: 'Site' },
  { id: 'last24h', header: 'Last 24h' },
  { id: 'lastCheck', header: 'Last check' },
  { id: 'response', header: 'Response 24h' },
  { id: 'uptime', header: '24h uptime' },
  { id: 'downFor', header: 'Down for' }
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-heading text-xl font-extrabold text-highlighted">Status</h1>
        <p v-if="loaded" class="text-sm text-muted">
          <span :class="counts.down ? 'font-medium text-red-400' : ''">{{ counts.down }} down</span>
          · {{ counts.up }} up · {{ counts.paused }} paused
          <span v-if="lastUpdatedLabel" class="text-dimmed"> · Last updated {{ lastUpdatedLabel }}</span>
        </p>
      </div>
      <div class="flex gap-2">
        <UButton to="/monitors/bulk" variant="outline" icon="i-lucide-list-plus">Bulk add</UButton>
        <UButton
          to="/monitors/new"
          icon="i-lucide-plus"
          class="bg-electric-500 text-forest-900 hover:bg-electric-400"
        >
          Add monitor
        </UButton>
      </div>
    </div>

    <div v-if="lastSummary" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <ChartsStatTile
        label="Down now"
        :value="String(lastSummary.downNow)"
        :tone="lastSummary.downNow > 0 ? 'danger' : 'default'"
        :sub="lastSummary.downNow > 0 ? 'sites currently down' : 'none confirmed down'"
      />
      <ChartsStatTile label="Uptime 24h" :value="pct(lastSummary.uptime24h)">
        <ChartsSparkline
          :values="lastSummary.series.uptime24h"
          :times="lastSummary.series.buckets"
          :format="(v) => `${v}%`"
          label="Fleet uptime per half-hour, last 24 hours"
        />
      </ChartsStatTile>
      <ChartsStatTile label="Uptime 30d" :value="pct(lastSummary.uptime30d)">
        <ChartsSparkline
          :values="lastSummary.series.uptime30d"
          :times="lastSummary.series.days30"
          :format="(v) => `${v}%`"
          label="Fleet uptime per day, last 30 days"
        />
      </ChartsStatTile>
      <ChartsStatTile label="Incidents 7d" :value="String(lastSummary.incidents7d)" :sub="incidentDelta">
        <ChartsSparkline
          kind="bars"
          :values="lastSummary.series.incidents14d"
          :times="lastSummary.series.days14"
          :format="(v) => `${v} incident${v === 1 ? '' : 's'}`"
          label="Incidents per day, last 14 days"
        />
      </ChartsStatTile>
      <ChartsStatTile label="Avg response 24h" :value="ms(lastSummary.avgResponse24h)">
        <ChartsSparkline
          :values="lastSummary.series.response24h"
          :times="lastSummary.series.buckets"
          :format="(v) => `${v} ms`"
          label="Average response time per half-hour, last 24 hours"
        />
      </ChartsStatTile>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Could not load monitors"
      :description="
        loaded
          ? `Showing the last good data${lastUpdatedLabel ? ` from ${lastUpdatedLabel}` : ''}. Retrying every 15 seconds.`
          : 'Retrying every 15 seconds.'
      "
    />

    <div class="flex flex-wrap gap-2">
      <UInput v-model="search" icon="i-lucide-search" placeholder="Search name or URL" class="w-64" />
      <USelect v-model="filter" :items="filterItems" class="w-44" />
      <USelect
        v-if="tagItems.length > 1"
        v-model="tag"
        :items="tagItems"
        icon="i-lucide-tag"
        class="w-48"
        aria-label="Filter by tag"
      />
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="rows" :columns="columns">
        <template #status-cell="{ row }">
          <StatusPill :status="row.original.status" :in-maintenance="row.original.inMaintenance" />
        </template>
        <template #name-cell="{ row }">
          <NuxtLink :to="`/monitors/${row.original.id}`" class="font-medium hover:underline">
            {{ row.original.name }}
          </NuxtLink>
          <div class="font-mono text-xs text-muted">{{ row.original.url }}</div>
          <TagList :tags="row.original.tags" linked class="mt-1" />
        </template>
        <template #last24h-cell="{ row }">
          <ChartsUptimeBar
            :states="row.original.bars"
            :stats="row.original.barStats"
            :starts="lastSummary?.series.buckets ?? []"
          />
        </template>
        <template #lastCheck-cell="{ row }">
          <div>{{ ago(row.original.lastCheckedAt) }}</div>
          <div class="text-xs text-dimmed">every {{ formatInterval(row.original.intervalS) }}</div>
        </template>
        <template #response-cell="{ row }">
          <div class="flex items-center gap-2">
            <ChartsSparkline
              class="w-28"
              :values="row.original.spark"
              :times="lastSummary?.series.buckets ?? []"
              :format="(v) => `${v} ms`"
              :label="`${row.original.name} average response, last 24 hours`"
            />
            <span class="font-mono text-xs">{{
              row.original.lastResponseMs != null ? `${row.original.lastResponseMs} ms` : '—'
            }}</span>
          </div>
        </template>
        <template #uptime-cell="{ row }">
          <span class="font-mono text-electric-500">{{
            row.original.uptime24h != null ? `${row.original.uptime24h}%` : '—'
          }}</span>
        </template>
        <template #downFor-cell="{ row }">
          <span v-if="row.original.downSince" class="font-mono text-red-400">
            {{ formatDuration(now.getTime() - row.original.downSince) }}
          </span>
          <span v-else class="text-dimmed">—</span>
        </template>
        <template #empty>
          <div v-if="!loaded" class="py-10 text-center text-sm text-muted">
            {{ error ? 'Monitors unavailable.' : 'Loading…' }}
          </div>
          <div v-else-if="monitors.length" class="py-10 text-center text-sm text-muted">
            No monitors match.
          </div>
          <div v-else class="py-10 text-center text-sm text-muted">
            No monitors yet.
            <NuxtLink to="/monitors/new" class="underline">Add one</NuxtLink>
            or
            <NuxtLink to="/monitors/bulk" class="underline">bulk add</NuxtLink>.
          </div>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
