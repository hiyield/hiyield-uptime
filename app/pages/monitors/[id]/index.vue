<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { CheckRow, IncidentRow, MaintenanceRow, MonitorRow } from '~~/server/db/schema'
import { formatDuration, formatInterval } from '~~/shared/utils/format'

interface DeliveryItem {
  id: string
  kind: string
  attempt: number
  ok: boolean
  error: string | null
  sentAt: number
  contactName: string
}
interface History {
  monitor: MonitorRow & { contactIds: string[] }
  uptime: { h24: number | null; d7: number | null; d30: number | null }
  series: { h24: { t: number; avgMs: number }[]; d7: { t: number; avgMs: number }[] }
  incidents: IncidentRow[]
  checks: CheckRow[]
  deliveries: DeliveryItem[]
  maintenance: MaintenanceRow[]
}

const route = useRoute()
const id = route.params.id as string
const { data, error, refresh } = await useFetch<History>(`/api/monitors/${id}/history`)
useIntervalFn(() => refresh(), 30_000)
// @vueuse/core 15 dropped the `interval` shorthand in favour of a `scheduler`; this ticks `now` every second.
const now = useNow({ scheduler: (cb) => useIntervalFn(cb, 1000) })

const m = computed(() => data.value?.monitor)
const inMaintenance = computed(() =>
  (data.value?.maintenance ?? []).some(
    (w) => w.startsAt <= now.value.getTime() && w.endsAt > now.value.getTime()
  )
)
const range = ref<'h24' | 'd7'>('h24')
const rangeItems = [
  { label: '24 hours', value: 'h24' },
  { label: '7 days', value: 'd7' }
]
const chartTo = computed(() => now.value.getTime())
const chartFrom = computed(() => chartTo.value - (range.value === 'h24' ? 86_400_000 : 7 * 86_400_000))

const busy = ref(false)
async function act(path: 'check' | 'pause' | 'resume', done: string) {
  busy.value = true
  try {
    await $fetch(`/api/monitors/${id}/${path}`, { method: 'POST' })
    useToast().add({ title: done, color: 'success' })
    setTimeout(() => refresh(), path === 'check' ? 4000 : 0)
  } catch (e) {
    useToast().add({ title: 'Action failed', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = false
  }
}
// Nuxt UI 4.8 UButton's `@click` must not resolve to a value — named void wrappers,
// not inline calls, keep the template handlers typed as `() => void`.
function checkNow() {
  void act('check', 'Check queued')
}
function pauseMonitor() {
  void act('pause', 'Monitoring paused')
}
function resumeMonitor() {
  void act('resume', 'Monitoring resumed')
}

const pct = (v: number | null) => (v == null ? '—' : `${v}%`)

const incidentColumns: TableColumn<IncidentRow>[] = [
  { id: 'started', header: 'Started' },
  { id: 'resolved', header: 'Resolved' },
  { id: 'duration', header: 'Duration' },
  { accessorKey: 'cause', header: 'Cause' }
]
const checkColumns: TableColumn<CheckRow>[] = [
  { id: 'time', header: 'Time' },
  { id: 'result', header: 'Result' },
  { accessorKey: 'region', header: 'Region' },
  { id: 'response', header: 'Response' },
  { id: 'detail', header: 'Detail' }
]
const deliveryColumns: TableColumn<DeliveryItem>[] = [
  { id: 'time', header: 'Time' },
  { accessorKey: 'contactName', header: 'Contact' },
  { accessorKey: 'kind', header: 'Alert' },
  { id: 'result', header: 'Result' }
]
</script>

<template>
  <div class="space-y-6">
    <UAlert v-if="error" color="error" variant="subtle" title="Monitor not found" />
    <template v-else-if="data && m">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="space-y-1">
          <div class="flex items-center gap-3">
            <h1 class="font-heading text-xl font-extrabold text-highlighted">{{ m.name }}</h1>
            <StatusPill :status="m.status" :in-maintenance="inMaintenance" />
          </div>
          <a
            :href="m.url"
            target="_blank"
            rel="noopener"
            class="font-mono text-sm text-muted hover:underline"
          >
            {{ m.url }}
          </a>
          <p class="text-xs text-dimmed">
            Every {{ formatInterval(m.intervalS) }} · alert after {{ m.failThreshold }} confirmed failure(s) ·
            reminders {{ m.reminderMins ? `every ${m.reminderMins} min` : 'off' }}
          </p>
        </div>
        <div class="flex gap-2">
          <UButton
            variant="outline"
            icon="i-lucide-refresh-cw"
            :disabled="m.paused"
            :loading="busy"
            @click="checkNow"
          >
            Check now
          </UButton>
          <UButton
            v-if="m.paused"
            variant="outline"
            icon="i-lucide-play"
            :loading="busy"
            @click="resumeMonitor"
          >
            Resume
          </UButton>
          <UButton v-else variant="outline" icon="i-lucide-pause" :loading="busy" @click="pauseMonitor">
            Pause
          </UButton>
          <UButton :to="`/monitors/${id}/edit`" icon="i-lucide-pencil">Edit</UButton>
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        <UCard
          v-for="(label, key) in { h24: 'Last 24 hours', d7: 'Last 7 days', d30: 'Last 30 days' }"
          :key="key"
        >
          <div class="text-xs text-muted">{{ label }}</div>
          <div class="font-heading text-2xl font-extrabold text-electric-500">
            {{ pct(data.uptime[key]) }}
          </div>
          <div class="text-xs text-dimmed">uptime</div>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-medium">Response time</span>
            <USelect v-model="range" :items="rangeItems" class="w-32" />
          </div>
        </template>
        <ResponseChart :points="data.series[range]" :from="chartFrom" :to="chartTo" />
      </UCard>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header><span class="font-medium">Incidents</span></template>
        <UTable :data="data.incidents" :columns="incidentColumns">
          <template #started-cell="{ row }">{{ formatDateTime(row.original.startedAt) }}</template>
          <template #resolved-cell="{ row }">
            <span v-if="row.original.resolvedAt">{{ formatDateTime(row.original.resolvedAt) }}</span>
            <UBadge v-else color="error" variant="subtle">Ongoing</UBadge>
          </template>
          <template #duration-cell="{ row }">
            <span class="font-mono">
              {{ formatDuration((row.original.resolvedAt ?? now.getTime()) - row.original.startedAt) }}
            </span>
          </template>
          <template #empty><div class="py-6 text-center text-sm text-dimmed">No incidents</div></template>
        </UTable>
      </UCard>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header><span class="font-medium">Recent checks</span></template>
        <UTable :data="data.checks" :columns="checkColumns">
          <template #time-cell="{ row }">{{ formatDateTime(row.original.checkedAt) }}</template>
          <template #result-cell="{ row }">
            <UBadge
              :color="row.original.ok ? 'success' : row.original.confirmed ? 'error' : 'warning'"
              variant="subtle"
            >
              {{ row.original.ok ? 'Up' : row.original.confirmed ? 'Down' : 'Blip' }}
            </UBadge>
            <span v-if="row.original.maintenance" class="ml-1 text-xs text-dimmed">maintenance</span>
          </template>
          <template #response-cell="{ row }">
            <span class="font-mono">{{
              row.original.responseMs != null ? `${row.original.responseMs} ms` : '—'
            }}</span>
          </template>
          <template #detail-cell="{ row }">
            <span class="font-mono text-xs">{{
              row.original.error ?? `HTTP ${row.original.statusCode}`
            }}</span>
          </template>
          <template #empty><div class="py-6 text-center text-sm text-dimmed">No checks yet</div></template>
        </UTable>
      </UCard>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header><span class="font-medium">Alert deliveries</span></template>
        <UTable :data="data.deliveries" :columns="deliveryColumns">
          <template #time-cell="{ row }">{{ formatDateTime(row.original.sentAt) }}</template>
          <template #result-cell="{ row }">
            <UBadge v-if="row.original.ok" color="success" variant="subtle">Sent</UBadge>
            <span v-else class="text-sm text-red-400">
              Attempt {{ row.original.attempt }} failed: {{ row.original.error }}
            </span>
          </template>
          <template #empty><div class="py-6 text-center text-sm text-dimmed">No alerts sent</div></template>
        </UTable>
      </UCard>

      <UCard v-if="data.maintenance.length">
        <template #header><span class="font-medium">Maintenance windows</span></template>
        <ul class="space-y-1 text-sm">
          <li v-for="w in data.maintenance" :key="w.id">
            {{ formatDateTime(w.startsAt) }} → {{ formatDateTime(w.endsAt) }}
            <span v-if="!w.monitorId" class="text-xs text-dimmed">(all sites)</span>
            <span v-if="w.note" class="text-muted">— {{ w.note }}</span>
          </li>
        </ul>
      </UCard>
    </template>
  </div>
</template>
