export type MonitorStatus = 'unknown' | 'up' | 'suspect' | 'down' | 'paused'

export interface StatusDisplay {
  label: 'Up' | 'Down' | 'Suspect' | 'Pending' | 'Paused' | 'Maintenance'
  color: 'success' | 'error' | 'warning' | 'neutral' | 'info'
}

/** "Maintenance" is derived from an active window, never stored in monitors.status. */
export function displayStatus(status: MonitorStatus, inMaintenance: boolean): StatusDisplay {
  if (status === 'paused') return { label: 'Paused', color: 'neutral' }
  if (inMaintenance) return { label: 'Maintenance', color: 'info' }
  switch (status) {
    case 'up':
      return { label: 'Up', color: 'success' }
    case 'down':
      return { label: 'Down', color: 'error' }
    case 'suspect':
      return { label: 'Suspect', color: 'warning' }
    default:
      return { label: 'Pending', color: 'neutral' }
  }
}

export const STATUS_SORT: Record<MonitorStatus, number> = {
  down: 0,
  suspect: 1,
  unknown: 2,
  up: 3,
  paused: 4
}
