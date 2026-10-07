<script setup lang="ts">
import { displayStatus, type MonitorStatus } from '~~/shared/utils/status'

const props = defineProps<{ status: MonitorStatus; inMaintenance?: boolean }>()
const display = computed(() => displayStatus(props.status, props.inMaintenance ?? false))
// Nuxt UI's subtle `success` badge puts electric-500 text on a light electric background —
// the brand accent is a bright mint meant for fills/chips, not body text, so it reads poorly.
// Override just the "Up" chip with brand-forest text; every other status keeps its semantic colour.
const isUp = computed(() => display.value.color === 'success')
</script>

<template>
  <UBadge
    :color="display.color"
    variant="subtle"
    :class="['font-medium', isUp ? 'bg-electric-100 text-forest-800 ring-electric-300' : '']"
  >
    {{ display.label }}
  </UBadge>
</template>
