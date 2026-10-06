<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { parseBulk, type BulkRow } from '~~/shared/utils/bulk'

const text = ref('')
const rows = computed(() => parseBulk(text.value))
const errors = computed(() => rows.value.filter((r) => r.error).length)
const submitting = ref(false)

const columns: TableColumn<BulkRow>[] = [
  { accessorKey: 'line', header: 'Line' },
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'url', header: 'URL' },
  { id: 'result', header: '' }
]

async function submit() {
  submitting.value = true
  try {
    const { created } = await $fetch<{ created: number }>('/api/monitors/bulk', {
      method: 'POST',
      body: { text: text.value }
    })
    useToast().add({ title: `Added ${created} monitors`, color: 'success' })
    await navigateTo('/')
  } catch (e) {
    useToast().add({ title: 'Could not add monitors', description: errorMessage(e), color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4">
    <div>
      <h1 class="text-xl font-semibold">Bulk add monitors</h1>
      <p class="text-sm text-slate-500">
        One site per line as <code class="font-mono">name, url</code>. Blank lines and lines starting with
        <code class="font-mono">#</code> are ignored. New monitors use the default settings (every 5 min,
        alert after 2 failures) and your default contacts — edit any of them afterwards.
      </p>
    </div>
    <UTextarea
      v-model="text"
      :rows="10"
      class="w-full font-mono"
      placeholder="Acme Ltd, https://www.acme.co.uk&#10;Beta Bakery, https://betabakery.com"
    />
    <UCard v-if="rows.length" :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="rows" :columns="columns">
        <template #url-cell="{ row }">
          <span class="font-mono text-xs">{{ row.original.url }}</span>
        </template>
        <template #result-cell="{ row }">
          <span v-if="row.original.error" class="text-sm text-red-600">{{ row.original.error }}</span>
          <UIcon v-else name="i-lucide-check" class="text-emerald-600" />
        </template>
      </UTable>
    </UCard>
    <div class="flex items-center justify-end gap-3">
      <span v-if="errors" class="text-sm text-red-600">{{ errors }} line(s) need fixing</span>
      <UButton :disabled="!rows.length || errors > 0" :loading="submitting" @click="submit">
        Add {{ rows.length }} monitors
      </UButton>
    </div>
  </div>
</template>
