<script setup lang="ts">
import { displayStatus, type MonitorStatus } from '~~/shared/utils/status'

const props = defineProps<{ status: MonitorStatus; inMaintenance?: boolean }>()
const display = computed(() => displayStatus(props.status, props.inMaintenance ?? false))
// Wall-board is always dark: override the "Up" and "Down" chips with explicit brand colours so
// they read as bright mint / vivid red on near-black. Suspect (amber), Maintenance (sky) and
// Paused/Pending (neutral) already look right from Nuxt UI's own dark `subtle` variant.
const isUp = computed(() => display.value.color === 'success')
const isDown = computed(() => display.value.color === 'error')
</script>

<template>
  <UBadge
    :color="display.color"
    variant="subtle"
    :class="[
      'font-medium',
      isUp ? 'bg-electric-500/15 text-electric-400 ring-electric-500/30' : '',
      isDown ? 'bg-red-500/15 text-red-400 ring-red-500/30' : ''
    ]"
  >
    {{ display.label }}
  </UBadge>
</template>
