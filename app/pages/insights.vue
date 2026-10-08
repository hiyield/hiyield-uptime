<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Insights, InsightsPeriod, RangeKey } from '~~/server/utils/insights'
import { formatDuration } from '~~/shared/utils/format'
import { NEUTRAL_BAR, SERIES, STATE_COLOR } from '~/utils/chartColors'

const route = useRoute()
const router = useRouter()
const ranges: { label: string; value: RangeKey }[] = [
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: '1y', value: '1y' }
]
const range = computed<RangeKey>({
  get: () => (ranges.some((r) => r.value === route.query.range) ? (route.query.range as RangeKey) : '30d'),
  set: (v) => router.replace({ query: { ...route.query, range: v } })
})
function setRange(v: RangeKey) {
  range.value = v
}
const { data, error, status } = await useFetch<Insights>('/api/insights', { query: { range } })

const hasData = computed(
  () =>
    !!data.value &&
    (data.value.tiles.uptime !== null || data.value.tiles.incidents > 0 || data.value.slowest.length > 0)
)
const dur = (ms: number) => (ms > 0 ? formatDuration(ms) : '0m')
const pct = (v: number | null) => (v == null ? '—' : `${v}%`)
const fmtDate = (p: InsightsPeriod) =>
  data.value?.range === '1y'
    ? `${new Date(p.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}–${new Date(p.end - 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
    : new Date(p.start).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

const downtimeBars = computed(() =>
  (data.value?.periods ?? []).map((p) => ({ start: p.start, end: p.end, value: p.downtimeMs }))
)
const incidentBars = computed(() =>
  (data.value?.periods ?? []).map((p) => ({ start: p.start, end: p.end, value: p.incidents }))
)
const formatCount = (v: number) => String(v)
const downtimeTip = (i: number) => {
  const p = data.value?.periods[i]
  if (!p) return []
  return [
    fmtDate(p),
    `Downtime ${dur(p.downtimeMs)} · ${p.incidents} incident${p.incidents === 1 ? '' : 's'}`,
    ...(p.sites.length ? [`Sites: ${p.sites.map((s) => s.name).join(', ')}`] : [])
  ]
}
const incidentTip = (i: number) => {
  const p = data.value?.periods[i]
  if (!p) return []
  return [fmtDate(p), `${p.incidents} incident${p.incidents === 1 ? '' : 's'} started`]
}

const worstRows = computed(() =>
  (data.value?.worst ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    value: w.downtimeMs,
    meta: `${w.incidents} incident${w.incidents === 1 ? '' : 's'} · ${pct(w.uptime)}`
  }))
)
const slowRows = computed(() =>
  (data.value?.slowest ?? []).map((s) => ({ id: s.id, name: s.name, value: s.avgMs, marker: s.maxMs }))
)
const formatMs = (v: number) => `${v} ms`

const showTable = reactive({ downtime: false, incidents: false, worst: false, slowest: false })
function toggleTable(key: keyof typeof showTable) {
  showTable[key] = !showTable[key]
}

const periodColumns: TableColumn<InsightsPeriod>[] = [
  { id: 'date', header: 'Period' },
  { id: 'downtime', header: 'Downtime' },
  { accessorKey: 'incidents', header: 'Incidents' },
  { id: 'sites', header: 'Sites affected' }
]
const incidentColumns: TableColumn<InsightsPeriod>[] = [
  { id: 'date', header: 'Period' },
  { id: 'incidents', header: 'Incidents' }
]
type WorstRow = Insights['worst'][number]
const worstColumns: TableColumn<WorstRow>[] = [
  { accessorKey: 'name', header: 'Site' },
  { id: 'dt', header: 'Downtime' },
  { accessorKey: 'incidents', header: 'Incidents' },
  { id: 'up', header: 'Uptime' }
]
type SlowRow = Insights['slowest'][number]
const slowColumns: TableColumn<SlowRow>[] = [
  { accessorKey: 'name', header: 'Site' },
  { accessorKey: 'avgMs', header: 'Average (ms)' },
  { accessorKey: 'maxMs', header: 'Worst (ms)' }
]
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-heading text-xl font-extrabold text-highlighted">Insights</h1>
        <p class="text-sm text-muted">
          Reliability and performance across all monitored sites (days are UTC).
        </p>
      </div>
      <UFieldGroup>
        <UButton
          v-for="r in ranges"
          :key="r.value"
          :variant="range === r.value ? 'solid' : 'outline'"
          color="neutral"
          :aria-pressed="range === r.value"
          @click="setRange(r.value)"
        >
          {{ r.label }}
        </UButton>
      </UFieldGroup>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load insights"
      :description="errorMessage(error)"
    />

    <template v-else-if="data">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ChartsStatTile label="Uptime" :value="pct(data.tiles.uptime)" />
        <ChartsStatTile label="Incidents" :value="String(data.tiles.incidents)" />
        <ChartsStatTile label="Total downtime" :value="dur(data.tiles.downtimeMs)" />
        <ChartsStatTile
          label="Avg time to recovery"
          :value="data.tiles.mttrMs == null ? '—' : formatDuration(data.tiles.mttrMs)"
        />
      </div>

      <UAlert
        v-if="!hasData && status !== 'pending'"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        title="No history yet"
        description="Data appears as checks run. To include past checks, run the rollup backfill (see README)."
      />

      <template v-if="hasData">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-medium">Downtime {{ data.range === '1y' ? 'per week' : 'per day' }}</span>
              <UButton variant="link" color="neutral" size="xs" @click="toggleTable('downtime')">
                {{ showTable.downtime ? 'View as chart' : 'View as table' }}
              </UButton>
            </div>
          </template>
          <ChartsPeriodBars
            v-if="!showTable.downtime"
            :periods="downtimeBars"
            :color="STATE_COLOR.down"
            :format="dur"
            :tooltip="downtimeTip"
            label="Downtime per period"
          />
          <UTable v-else :data="data.periods" :columns="periodColumns">
            <template #date-cell="{ row }">{{ fmtDate(row.original) }}</template>
            <template #downtime-cell="{ row }">{{ dur(row.original.downtimeMs) }}</template>
            <template #sites-cell="{ row }">{{
              row.original.sites.map((s) => s.name).join(', ') || '—'
            }}</template>
          </UTable>
          <div class="mt-6">
            <div class="mb-2 flex items-center justify-between text-sm">
              <span class="font-medium">Incidents {{ data.range === '1y' ? 'per week' : 'per day' }}</span>
              <UButton variant="link" color="neutral" size="xs" @click="toggleTable('incidents')">
                {{ showTable.incidents ? 'View as chart' : 'View as table' }}
              </UButton>
            </div>
            <ChartsPeriodBars
              v-if="!showTable.incidents"
              :periods="incidentBars"
              :color="NEUTRAL_BAR"
              :height="64"
              :format="formatCount"
              :tooltip="incidentTip"
              label="Incidents started per period"
            />
            <UTable v-else :data="data.periods" :columns="incidentColumns">
              <template #date-cell="{ row }">{{ fmtDate(row.original) }}</template>
              <template #incidents-cell="{ row }">{{ row.original.incidents }}</template>
            </UTable>
          </div>
        </UCard>

        <div class="grid gap-4 lg:grid-cols-2">
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <span class="font-medium">Most downtime</span>
                <UButton variant="link" color="neutral" size="xs" @click="toggleTable('worst')">
                  {{ showTable.worst ? 'View as chart' : 'View as table' }}
                </UButton>
              </div>
            </template>
            <ChartsRankList
              v-if="!showTable.worst"
              :rows="worstRows"
              :color="STATE_COLOR.down"
              :format="dur"
              empty="No downtime in this period."
            />
            <UTable v-else :data="data.worst" :columns="worstColumns">
              <template #name-cell="{ row }">
                <NuxtLink :to="`/monitors/${row.original.id}`" class="font-medium hover:underline">{{
                  row.original.name
                }}</NuxtLink>
              </template>
              <template #dt-cell="{ row }">{{ dur(row.original.downtimeMs) }}</template>
              <template #up-cell="{ row }">{{ pct(row.original.uptime) }}</template>
            </UTable>
          </UCard>
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <span class="font-medium"
                  >Slowest response <span class="text-xs text-dimmed">average (worst)</span></span
                >
                <UButton variant="link" color="neutral" size="xs" @click="toggleTable('slowest')">
                  {{ showTable.slowest ? 'View as chart' : 'View as table' }}
                </UButton>
              </div>
            </template>
            <ChartsRankList
              v-if="!showTable.slowest"
              :rows="slowRows"
              :color="SERIES"
              :format="formatMs"
              empty="No response data in this period."
            />
            <UTable v-else :data="data.slowest" :columns="slowColumns">
              <template #name-cell="{ row }">
                <NuxtLink :to="`/monitors/${row.original.id}`" class="font-medium hover:underline">{{
                  row.original.name
                }}</NuxtLink>
              </template>
            </UTable>
          </UCard>
        </div>
      </template>
    </template>
  </div>
</template>
