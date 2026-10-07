<script setup lang="ts">
import type { MonitorRow } from '~~/server/db/schema'
import type { MonitorInput } from '~~/shared/utils/validation'

const route = useRoute()
const id = route.params.id as string
const { data: monitor, error } = await useFetch<MonitorRow & { contactIds: string[] }>(`/api/monitors/${id}`)

const initial = computed<MonitorInput | null>(() =>
  monitor.value
    ? {
        name: monitor.value.name,
        url: monitor.value.url,
        intervalS: monitor.value.intervalS,
        timeoutMs: monitor.value.timeoutMs,
        failThreshold: monitor.value.failThreshold,
        reminderMins: monitor.value.reminderMins,
        paused: monitor.value.paused,
        contactIds: monitor.value.contactIds
      }
    : null
)

async function save(input: MonitorInput) {
  try {
    await $fetch(`/api/monitors/${id}`, { method: 'PUT', body: input })
    await navigateTo(`/monitors/${id}`)
  } catch (e) {
    useToast().add({ title: 'Could not save monitor', description: errorMessage(e), color: 'error' })
  }
}

const confirmDelete = ref(false)
function openDelete() {
  confirmDelete.value = true
}
function closeDelete() {
  confirmDelete.value = false
}
const deleting = ref(false)
async function remove() {
  deleting.value = true
  try {
    await $fetch(`/api/monitors/${id}`, { method: 'DELETE' })
    await navigateTo('/')
  } catch (e) {
    useToast().add({ title: 'Could not delete monitor', description: errorMessage(e), color: 'error' })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4">
    <UAlert v-if="error" color="error" variant="subtle" title="Monitor not found" />
    <template v-else-if="initial">
      <div class="flex items-center justify-between">
        <h1 class="font-heading text-xl font-extrabold text-forest-500">Edit {{ monitor!.name }}</h1>
        <UButton color="error" variant="ghost" icon="i-lucide-trash-2" @click="openDelete">Delete</UButton>
      </div>
      <UCard>
        <MonitorForm :initial="initial" submit-label="Save changes" :save="save" />
      </UCard>
    </template>

    <UModal v-model:open="confirmDelete" title="Delete monitor?">
      <template #body>
        <p class="text-sm">This stops monitoring and permanently deletes its check history and incidents.</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="closeDelete">Cancel</UButton>
          <UButton color="error" :loading="deleting" @click="remove">Delete</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
