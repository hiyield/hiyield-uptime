<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ContactListItem } from '~~/server/utils/contacts'
import { INTERVALS_S, LAUNCH_WATCH, REMINDER_MINS } from '~~/shared/utils/constants'
import { formatInterval } from '~~/shared/utils/format'
import { monitorInputSchema, type MonitorInput } from '~~/shared/utils/validation'

const props = defineProps<{
  initial: MonitorInput
  submitLabel: string
  isNew?: boolean
  /** Awaited; the submit button stays disabled until it settles, so a double-click can't save twice. */
  save: (input: MonitorInput) => Promise<void>
}>()

const state = reactive<MonitorInput>({ ...props.initial, contactIds: [...props.initial.contactIds] })
const saving = ref(false)

const timeoutS = computed({
  get: () => state.timeoutMs / 1000,
  set: (v: number) => {
    state.timeoutMs = Math.round((v || 10) * 1000)
  }
})

const { data: contactData } = await useFetch<{ contacts: ContactListItem[] }>('/api/contacts')
const contacts = computed(() => contactData.value?.contacts ?? [])
if (props.isNew) {
  watch(
    contacts,
    (list) => {
      if (state.contactIds.length === 0) state.contactIds = list.filter((c) => c.isDefault).map((c) => c.id)
    },
    { immediate: true }
  )
}

const intervalItems = INTERVALS_S.map((v) => ({ label: `Every ${formatInterval(v)}`, value: v }))
const reminderItems = REMINDER_MINS.map((v) => ({ label: v === 0 ? 'Off' : `Every ${v} min`, value: v }))
const thresholdItems = Array.from({ length: 10 }, (_, i) => ({
  label: i === 0 ? '1 confirmed failure (alert immediately)' : `${i + 1} confirmed failures in a row`,
  value: i + 1
}))

function applyLaunchWatch() {
  state.intervalS = LAUNCH_WATCH.intervalS
  state.failThreshold = LAUNCH_WATCH.failThreshold
}

function toggleContact(id: string, on: boolean) {
  state.contactIds = on ? [...new Set([...state.contactIds, id])] : state.contactIds.filter((c) => c !== id)
}

interface TestResult {
  ok: boolean
  statusCode: number | null
  responseMs: number | null
  error: string | null
}
const testing = ref(false)
const testResult = ref<TestResult | null>(null)

async function testUrl() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await $fetch<TestResult>('/api/monitors/test-url', {
      method: 'POST',
      body: { url: state.url, timeoutMs: state.timeoutMs }
    })
  } catch (e) {
    useToast().add({ title: 'Could not test URL', description: errorMessage(e), color: 'error' })
  } finally {
    testing.value = false
  }
}

async function onSubmit(e: FormSubmitEvent<MonitorInput>) {
  if (saving.value) return
  saving.value = true
  try {
    await props.save(e.data)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UForm :schema="monitorInputSchema" :state="state" class="space-y-5" @submit="onSubmit">
    <UFormField label="Name" name="name" required>
      <UInput v-model="state.name" placeholder="Acme Ltd — main site" class="w-full" />
    </UFormField>

    <UFormField label="URL" name="url" required>
      <div class="flex gap-2">
        <UInput v-model="state.url" placeholder="https://www.example.co.uk" class="flex-1 font-mono" />
        <UButton variant="outline" :loading="testing" :disabled="!state.url" @click="testUrl"
          >Test URL</UButton
        >
      </div>
    </UFormField>
    <UAlert
      v-if="testResult"
      :color="testResult.ok ? 'success' : 'error'"
      variant="subtle"
      :title="
        testResult.ok
          ? `Up — HTTP ${testResult.statusCode} in ${testResult.responseMs} ms`
          : `Down — ${testResult.error}`
      "
    />

    <div class="flex items-center justify-between gap-4 rounded-md border border-default bg-elevated p-3">
      <div>
        <div class="text-sm font-medium">Launch watch</div>
        <div class="text-xs text-muted">
          For newly launched sites: check every minute and alert on the first confirmed failure.
        </div>
      </div>
      <UButton variant="soft" icon="i-lucide-rocket" @click="applyLaunchWatch">Apply</UButton>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField label="Check interval" name="intervalS">
        <USelect v-model="state.intervalS" :items="intervalItems" class="w-full" />
      </UFormField>
      <UFormField label="Timeout (seconds)" name="timeoutMs">
        <UInputNumber v-model="timeoutS" :min="1" :max="30" class="w-full" />
      </UFormField>
      <UFormField
        label="Alert after"
        name="failThreshold"
        help="Every failure is re-checked from a second region first."
      >
        <USelect v-model="state.failThreshold" :items="thresholdItems" class="w-full" />
      </UFormField>
      <UFormField label="Reminder while down" name="reminderMins">
        <USelect v-model="state.reminderMins" :items="reminderItems" class="w-full" />
      </UFormField>
    </div>

    <UFormField label="Alert contacts" name="contactIds">
      <div v-if="contacts.length" class="space-y-2">
        <UCheckbox
          v-for="c in contacts"
          :key="c.id"
          :model-value="state.contactIds.includes(c.id)"
          :label="`${c.name} (${c.type === 'slack' ? 'Slack' : 'Email'})`"
          @update:model-value="(v) => toggleContact(c.id, v === true)"
        />
      </div>
      <p v-else class="text-sm text-muted">
        No contacts yet — <NuxtLink to="/contacts" class="underline">add one</NuxtLink> so alerts go
        somewhere.
      </p>
    </UFormField>

    <USwitch v-model="state.paused" label="Paused" />

    <div class="flex justify-end gap-2">
      <UButton variant="ghost" color="neutral" @click="$router.back()">Cancel</UButton>
      <UButton
        type="submit"
        :loading="saving"
        :disabled="saving"
        :class="isNew ? 'bg-electric-500 text-forest-900 hover:bg-electric-400' : ''"
      >
        {{ submitLabel }}
      </UButton>
    </div>
  </UForm>
</template>
