<script setup lang="ts">
withDefaults(defineProps<{ label: string; value: string; sub?: string; tone?: 'default' | 'danger' }>(), {
  sub: undefined,
  tone: 'default'
})
</script>

<template>
  <UCard :ui="{ body: 'p-4 sm:p-4' }">
    <div class="text-xs font-medium uppercase tracking-wide text-muted">{{ label }}</div>
    <div class="mt-1 flex items-center gap-2">
      <UIcon v-if="tone === 'danger'" name="i-lucide-triangle-alert" class="size-5 text-red-400" />
      <span
        class="font-heading text-2xl font-extrabold"
        :class="tone === 'danger' ? 'text-red-400' : 'text-highlighted'"
      >
        {{ value }}
      </span>
    </div>
    <div v-if="sub" class="text-xs text-dimmed">{{ sub }}</div>
    <div v-if="$slots.default" class="mt-2"><slot /></div>
  </UCard>
</template>
