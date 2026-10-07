<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { BoardRow } from '~~/server/utils/stats'
import { formatDuration, formatInterval } from '~~/shared/utils/format'

const lastUpdated = ref<number | null>(null)
const { data, error, refresh } = await useFetch<{ monitors: BoardRow[] }>('/api/monitors', {
  onResponse({ response }) {
    if (response.ok) lastUpdated.value = Date.now()
  }
})
useIntervalFn(() => refresh(), 15_000)
// Keep showing the last good board if a refresh fails (wall board: never flash "no monitors").
const lastGood = ref<BoardRow[] | null>(null)
watch(
  data,
  (v) => {
    if (v) lastGood.value = v.monitors
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
const filterItems: { label: string; value: Filter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Down / suspect', value: 'down' },
  { label: 'Up', value: 'up' },
  { label: 'Paused', value: 'paused' }
]

const monitors = computed(() => lastGood.value ?? [])
const isDown = (m: BoardRow) => m.status === 'down' || m.status === 'suspect'
const isUp = (m: BoardRow) => m.status === 'up' || m.status === 'unknown'
const counts = computed(() => ({
  down: monitors.value.filter(isDown).length,
  up: monitors.value.filter(isUp).length,
  paused: monitors.value.filter((m) => m.status === 'paused').length
}))

const rows = computed(() =>
  monitors.value.filter((m) => {
    const q = search.value.trim().toLowerCase()
    if (q && !m.name.toLowerCase().includes(q) && !m.url.toLowerCase().includes(q)) return false
    if (filter.value === 'down') return isDown(m)
    if (filter.value === 'up') return isUp(m)
    if (filter.value === 'paused') return m.status === 'paused'
    return true
  })
)

const ago = (t: number | null) => (t ? `${formatDuration(now.value.getTime() - t)} ago` : '—')

const columns: TableColumn<BoardRow>[] = [
  { id: 'status', header: 'Status' },
  { accessorKey: 'name', header: 'Site' },
  { id: 'lastCheck', header: 'Last check' },
  { id: 'response', header: 'Response' },
  { id: 'uptime', header: '24h uptime' },
  { id: 'downFor', header: 'Down for' }
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-heading text-xl font-extrabold text-forest-500">Status</h1>
        <p v-if="loaded" class="text-sm text-ink-500">
          <span :class="counts.down ? 'font-medium text-red-600' : ''">{{ counts.down }} down</span>
          · {{ counts.up }} up · {{ counts.paused }} paused
          <span v-if="lastUpdatedLabel" class="text-ink-400"> · Last updated {{ lastUpdatedLabel }}</span>
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
          <div class="font-mono text-xs text-ink-500">{{ row.original.url }}</div>
        </template>
        <template #lastCheck-cell="{ row }">
          <div>{{ ago(row.original.lastCheckedAt) }}</div>
          <div class="text-xs text-ink-400">every {{ formatInterval(row.original.intervalS) }}</div>
        </template>
        <template #response-cell="{ row }">
          <span class="font-mono">
            {{ row.original.lastResponseMs != null ? `${row.original.lastResponseMs} ms` : '—' }}
          </span>
        </template>
        <template #uptime-cell="{ row }">
          <span class="font-mono">{{
            row.original.uptime24h != null ? `${row.original.uptime24h}%` : '—'
          }}</span>
        </template>
        <template #downFor-cell="{ row }">
          <span v-if="row.original.downSince" class="font-mono text-red-600">
            {{ formatDuration(now.getTime() - row.original.downSince) }}
          </span>
          <span v-else class="text-ink-400">—</span>
        </template>
        <template #empty>
          <div v-if="!loaded" class="py-10 text-center text-sm text-ink-500">
            {{ error ? 'Monitors unavailable.' : 'Loading…' }}
          </div>
          <div v-else-if="monitors.length" class="py-10 text-center text-sm text-ink-500">
            No monitors match.
          </div>
          <div v-else class="py-10 text-center text-sm text-ink-500">
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
