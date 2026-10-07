<script setup lang="ts">
import { MONITOR_DEFAULTS } from '~~/shared/utils/constants'
import type { MonitorInput } from '~~/shared/utils/validation'

const initial: MonitorInput = { ...MONITOR_DEFAULTS, name: '', url: '', contactIds: [] }

async function create(input: MonitorInput) {
  try {
    const { id } = await $fetch<{ id: string }>('/api/monitors', { method: 'POST', body: input })
    await navigateTo(`/monitors/${id}`)
  } catch (e) {
    useToast().add({ title: 'Could not save monitor', description: errorMessage(e), color: 'error' })
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4">
    <h1 class="font-heading text-xl font-extrabold text-highlighted">Add monitor</h1>
    <UCard>
      <MonitorForm :initial="initial" submit-label="Add monitor" is-new :save="create" />
    </UCard>
  </div>
</template>
