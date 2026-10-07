<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ContactListItem } from '~~/server/utils/contacts'

const { data, refresh } = await useFetch<{ contacts: ContactListItem[] }>('/api/contacts')
const contacts = computed(() => data.value?.contacts ?? [])
const toast = useToast()

const open = ref(false)
const editing = ref<ContactListItem | null>(null)
const form = reactive({ type: 'slack' as 'slack' | 'email', name: '', target: '', isDefault: false })
const saving = ref(false)

function startCreate() {
  editing.value = null
  Object.assign(form, { type: 'slack', name: '', target: '', isDefault: true })
  open.value = true
}
function startEdit(c: ContactListItem) {
  editing.value = c
  Object.assign(form, { type: c.type, name: c.name, target: '', isDefault: c.isDefault })
  open.value = true
}

async function save() {
  saving.value = true
  try {
    if (editing.value) {
      await $fetch(`/api/contacts/${editing.value.id}`, {
        method: 'PUT',
        body: { name: form.name, isDefault: form.isDefault, target: form.target || undefined }
      })
    } else {
      await $fetch('/api/contacts', { method: 'POST', body: { ...form } })
    }
    open.value = false
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not save contact', description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function sendTest(c: ContactListItem) {
  try {
    const r = await $fetch<{ ok: boolean; error: string | null }>(`/api/contacts/${c.id}/test`, {
      method: 'POST'
    })
    toast.add(
      r.ok
        ? { title: `Test alert sent to ${c.name}`, color: 'success' }
        : { title: `Test alert to ${c.name} failed`, description: r.error ?? undefined, color: 'error' }
    )
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not send test alert', description: errorMessage(e), color: 'error' })
  }
}

function closeModal() {
  open.value = false
}

const deleting = ref<ContactListItem | null>(null)
function startDelete(c: ContactListItem) {
  deleting.value = c
}
function closeDelete() {
  deleting.value = null
}
async function confirmDelete() {
  if (!deleting.value) return
  try {
    await $fetch(`/api/contacts/${deleting.value.id}`, { method: 'DELETE' })
    deleting.value = null
    await refresh()
  } catch (e) {
    toast.add({ title: 'Could not delete contact', description: errorMessage(e), color: 'error' })
  }
}

const typeItems = [
  { label: 'Slack channel (incoming webhook)', value: 'slack' },
  { label: 'Email', value: 'email' }
]
const columns: TableColumn<ContactListItem>[] = [
  { accessorKey: 'name', header: 'Name' },
  { id: 'target', header: 'Destination' },
  { id: 'usage', header: 'Used by' },
  { id: 'last', header: 'Last delivery' },
  { id: 'actions', header: '' }
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-end justify-between">
      <div>
        <h1 class="font-heading text-xl font-extrabold text-forest-500">Contacts</h1>
        <p class="text-sm text-ink-500">Where alerts go. Default contacts are pre-ticked on new monitors.</p>
      </div>
      <UButton icon="i-lucide-plus" @click="startCreate">Add contact</UButton>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="contacts" :columns="columns">
        <template #name-cell="{ row }">
          <span class="font-medium">{{ row.original.name }}</span>
          <UBadge v-if="row.original.isDefault" variant="subtle" color="neutral" class="ml-2">Default</UBadge>
        </template>
        <template #target-cell="{ row }">
          <UIcon
            :name="row.original.type === 'slack' ? 'i-lucide-hash' : 'i-lucide-mail'"
            class="mr-1 align-middle"
          />
          <span class="font-mono text-xs">{{ row.original.targetMasked }}</span>
        </template>
        <template #usage-cell="{ row }">
          <UTooltip
            v-if="row.original.monitors.length"
            :text="row.original.monitors.map((m) => m.name).join(', ')"
          >
            <span>{{ row.original.monitors.length }} site(s)</span>
          </UTooltip>
          <span v-else class="text-ink-400">No sites</span>
        </template>
        <template #last-cell="{ row }">
          <template v-if="row.original.lastDelivery">
            <UBadge v-if="row.original.lastDelivery.ok" color="success" variant="subtle">Delivered</UBadge>
            <UTooltip v-else :text="row.original.lastDelivery.error ?? ''">
              <UBadge color="error" variant="subtle">Failed</UBadge>
            </UTooltip>
            <span class="ml-1 text-xs text-ink-400">{{ formatDateTime(row.original.lastDelivery.at) }}</span>
          </template>
          <span v-else class="text-ink-400">—</span>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end gap-1">
            <UButton size="xs" variant="ghost" icon="i-lucide-send" @click="sendTest(row.original)"
              >Test</UButton
            >
            <UButton size="xs" variant="ghost" icon="i-lucide-pencil" @click="startEdit(row.original)" />
            <UButton
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              @click="startDelete(row.original)"
            />
          </div>
        </template>
        <template #empty>
          <div class="py-10 text-center text-sm text-ink-500">
            No contacts yet. Add a Slack channel or email.
          </div>
        </template>
      </UTable>
    </UCard>

    <UModal v-model:open="open" :title="editing ? `Edit ${editing.name}` : 'Add contact'">
      <template #body>
        <div class="space-y-4">
          <UFormField v-if="!editing" label="Type">
            <USelect v-model="form.type" :items="typeItems" class="w-full" />
          </UFormField>
          <UFormField label="Name">
            <UInput
              v-model="form.name"
              :placeholder="form.type === 'slack' ? '#dev-alerts' : 'Support inbox'"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="form.type === 'slack' ? 'Webhook URL' : 'Email address'"
            :help="
              form.type === 'slack'
                ? 'Slack → Apps → Incoming Webhooks → Add to channel. Starts with https://hooks.slack.com/'
                : undefined
            "
          >
            <UInput
              v-model="form.target"
              :placeholder="editing ? `Leave blank to keep ${editing.targetMasked}` : ''"
              class="w-full font-mono"
            />
          </UFormField>
          <UCheckbox
            v-model="form.isDefault"
            label="Default — pre-tick on new monitors and bulk-added sites"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="closeModal">Cancel</UButton>
          <UButton :loading="saving" @click="save">Save</UButton>
        </div>
      </template>
    </UModal>

    <UModal :open="!!deleting" title="Delete contact?" @update:open="(v) => !v && closeDelete()">
      <template #body>
        <p class="text-sm">
          {{ deleting?.name }} will stop receiving alerts for {{ deleting?.monitors.length ?? 0 }} site(s).
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="closeDelete">Cancel</UButton>
          <UButton color="error" @click="confirmDelete">Delete</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
