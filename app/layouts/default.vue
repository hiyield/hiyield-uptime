<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

const { user } = useSessionUser()
const route = useRoute()
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
  <div class="min-h-screen bg-white">
    <header class="bg-forest-500">
      <div class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <NuxtLink to="/" class="font-heading text-lg font-extrabold text-white">
          Hiyield<span class="text-electric-500"> Uptime</span>
        </NuxtLink>
        <nav class="flex flex-1 items-center gap-6">
          <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="relative flex items-center gap-1.5 py-1.5 text-sm font-medium transition-colors"
            :class="
              route.path === link.to
                ? 'text-white after:absolute after:inset-x-0 after:-bottom-2 after:h-0.5 after:rounded-full after:bg-electric-500'
                : 'text-white/80 hover:text-white'
            "
          >
            <UIcon :name="link.icon" class="size-4" />
            {{ link.label }}
          </NuxtLink>
        </nav>
        <span v-if="user" class="hidden text-sm text-white/60 sm:inline">{{ user.email }}</span>
        <UButton
          variant="ghost"
          color="neutral"
          icon="i-lucide-log-out"
          class="text-white/80 hover:bg-white/10 hover:text-white"
          @click="signOut"
        >
          Sign out
        </UButton>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>
