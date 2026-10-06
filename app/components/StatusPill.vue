<script setup lang="ts">
import { displayStatus, type MonitorStatus } from '~~/shared/utils/status'

const props = defineProps<{ status: MonitorStatus; inMaintenance?: boolean }>()
const display = computed(() => displayStatus(props.status, props.inMaintenance ?? false))
</script>

<template>
  <UBadge :color="display.color" variant="subtle" class="font-medium">{{ display.label }}</UBadge>
</template>
