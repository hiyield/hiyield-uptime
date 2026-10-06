<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { BoardRow } from '~~/server/utils/stats'
import type { MaintenanceListItem } from '~~/server/utils/maintenance'

const { data, refresh } = await useFetch<{ windows: MaintenanceListItem[] }>('/api/maintenance')
const { data: board } = await useFetch<{ monitors: BoardRow[] }>('/api/monitors')
const toast = useToast()
// @vueuse/core 15 dropped the `interval` shorthand in favour of a `scheduler`.
const now = useNow({ scheduler: (cb) => useIntervalFn(cb, 30_000) })

const ALL = '__all__'
const monitorItems = computed(() => [
  { label: 'All sites', value: ALL },
  ...(board.value?.monitors ?? []).map((m) => ({ label: m.name, value: m.id }))
])

const start = Date.now()
const form = reactive({
  monitorId: ALL,
  startsAt: toLocalInput(start),
  endsAt: toLocalInput(start + 60 * 60_000),
  note: ''
})
const saving = ref(false)

async function create() {
  saving.value = true
  try {
    await $fetch('/api/maintenance', {
      method: 'POST',
      body: {
        monitorId: form.monitorId === ALL ? null : form.monitorId,
        startsAt: fromLocalInput(form.startsAt),
        endsAt: fromLocalInput(form.endsAt),
        note: form.note
      }
    })
    form.note = ''
    await refresh()
    toast.add({ title: 'Maintenance window scheduled', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Could not schedule maintenance', description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function remove(w: MaintenanceListItem) {
  try {
    await $fetch(`/api/maintenance/${w.id}`, { method: 'DELETE' })
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not delete window', description: errorMessage(e), color: 'error' })
  }
}

function phase(w: MaintenanceListItem): { label: string; color: 'info' | 'warning' | 'neutral' } {
  const t = now.value.getTime()
  if (w.endsAt <= t) return { label: 'Ended', color: 'neutral' }
  if (w.startsAt <= t) return { label: 'Active', color: 'warning' }
  return { label: 'Upcoming', color: 'info' }
}

const columns: TableColumn<MaintenanceListItem>[] = [
  { id: 'site', header: 'Site' },
  { id: 'when', header: 'When' },
  { id: 'phase', header: '' },
  { accessorKey: 'note', header: 'Note' },
  { accessorKey: 'createdBy', header: 'By' },
  { id: 'actions', header: '' }
]
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-semibold">Maintenance</h1>
      <p class="text-sm text-slate-500">
        Checks keep running during a window but no alerts are sent and it doesn't count against uptime.
      </p>
    </div>

    <UCard>
      <div class="grid gap-4 sm:grid-cols-4">
        <UFormField label="Site">
          <USelect v-model="form.monitorId" :items="monitorItems" class="w-full" />
        </UFormField>
        <UFormField label="Start">
          <UInput v-model="form.startsAt" type="datetime-local" class="w-full" />
        </UFormField>
        <UFormField label="End">
          <UInput v-model="form.endsAt" type="datetime-local" class="w-full" />
        </UFormField>
        <UFormField label="Note">
          <UInput v-model="form.note" placeholder="WordPress core update" class="w-full" />
        </UFormField>
      </div>
      <div class="mt-4 flex justify-end">
        <UButton icon="i-lucide-calendar-plus" :loading="saving" @click="create">Schedule</UButton>
      </div>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="data?.windows ?? []" :columns="columns">
        <template #site-cell="{ row }">{{ row.original.monitorName ?? 'All sites' }}</template>
        <template #when-cell="{ row }">
          {{ formatDateTime(row.original.startsAt) }} → {{ formatDateTime(row.original.endsAt) }}
        </template>
        <template #phase-cell="{ row }">
          <UBadge :color="phase(row.original).color" variant="subtle">{{ phase(row.original).label }}</UBadge>
        </template>
        <template #actions-cell="{ row }">
          <UButton
            v-if="phase(row.original).label !== 'Ended'"
            size="xs"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            @click="remove(row.original)"
          />
        </template>
        <template #empty
          ><div class="py-8 text-center text-sm text-slate-400">No maintenance windows</div></template
        >
      </UTable>
    </UCard>
  </div>
</template>
