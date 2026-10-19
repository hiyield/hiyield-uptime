<script setup lang="ts">
import type { TagCount } from '~~/server/utils/monitors'
import { TAGS_PER_MONITOR_MAX } from '~~/shared/utils/constants'
import { normaliseTag } from '~~/shared/utils/validation'

/** Tag editor: type and press Enter/comma, or click an existing tag to add it. Values are normalised as typed. */
const model = defineModel<string[]>({ required: true })

const { data } = await useFetch<{ tags: TagCount[] }>('/api/tags')
const suggestions = computed(() =>
  (data.value?.tags ?? []).filter((t) => !model.value.includes(t.tag)).slice(0, 12)
)

function add(tag: string) {
  const t = normaliseTag(tag)
  if (t && !model.value.includes(t) && model.value.length < TAGS_PER_MONITOR_MAX)
    model.value = [...model.value, t]
}
function onUpdate(list: string[]) {
  const out: string[] = []
  for (const raw of list) {
    const t = normaliseTag(raw) ?? raw.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  model.value = out
}
</script>

<template>
  <div class="space-y-2">
    <UInputTags
      :model-value="model"
      :max="TAGS_PER_MONITOR_MAX"
      :delimiter="/[,\s]+/"
      add-on-blur
      placeholder="kinsta, wordpress, retainer…"
      class="w-full font-mono"
      @update:model-value="onUpdate"
    />
    <div v-if="suggestions.length" class="flex flex-wrap items-center gap-1">
      <span class="text-xs text-dimmed">Existing:</span>
      <UButton
        v-for="s in suggestions"
        :key="s.tag"
        size="xs"
        color="neutral"
        variant="subtle"
        class="font-mono"
        :aria-label="`Add tag ${s.tag}`"
        @click="add(s.tag)"
      >
        {{ s.tag }} <span class="text-dimmed">{{ s.count }}</span>
      </UButton>
    </div>
  </div>
</template>
