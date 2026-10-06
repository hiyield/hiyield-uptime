<script setup lang="ts">
import { authClient } from '~/utils/auth-client'

definePageMeta({ layout: false })

const route = useRoute()
const loading = ref(false)
const error = computed(() => (route.query.error ? 'Only @hiyield.co.uk Google accounts can sign in.' : null))

async function signIn() {
  loading.value = true
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  await authClient.signIn.social({
    provider: 'google',
    callbackURL: redirect,
    errorCallbackURL: '/login?error=1'
  })
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
    <UCard class="w-full max-w-sm">
      <div class="space-y-4 text-center">
        <h1 class="text-xl font-semibold">Hiyield Uptime</h1>
        <p class="text-sm text-slate-500">Sign in with your Hiyield Google account.</p>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" />
        <UButton block size="lg" icon="i-lucide-log-in" :loading="loading" @click="signIn">
          Sign in with Google
        </UButton>
      </div>
    </UCard>
  </div>
</template>
