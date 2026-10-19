<script setup lang="ts">
/** Tag chips. With `linked`, each chip filters the status board by that tag. */
defineProps<{ tags: string[]; linked?: boolean; size?: 'xs' | 'sm' }>()
</script>

<template>
  <div v-if="tags.length" class="flex flex-wrap gap-1">
    <template v-for="tag in tags" :key="tag">
      <UBadge
        v-if="linked"
        :to="{ path: '/', query: { tag } }"
        :size="size ?? 'xs'"
        color="neutral"
        variant="subtle"
        class="font-mono hover:ring-electric-500/50"
        :aria-label="`Show sites tagged ${tag}`"
      >
        {{ tag }}
      </UBadge>
      <UBadge v-else :size="size ?? 'xs'" color="neutral" variant="subtle" class="font-mono">{{
        tag
      }}</UBadge>
    </template>
  </div>
</template>
