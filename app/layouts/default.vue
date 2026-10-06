<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

const { user } = useSessionUser()
const links = [
  { label: 'Status', to: '/', icon: 'i-lucide-activity' },
  { label: 'Contacts', to: '/contacts', icon: 'i-lucide-bell' },
  { label: 'Maintenance', to: '/maintenance', icon: 'i-lucide-wrench' }
]

async function signOut() {
  await authClient.signOut()
  window.location.href = '/login'
}
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <NuxtLink to="/" class="font-semibold">Hiyield Uptime</NuxtLink>
        <UNavigationMenu :items="links" class="flex-1" />
        <span v-if="user" class="hidden text-sm text-slate-500 sm:inline">{{ user.email }}</span>
        <UButton variant="ghost" color="neutral" icon="i-lucide-log-out" @click="signOut">Sign out</UButton>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>
