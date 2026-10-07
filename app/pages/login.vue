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
  <div class="flex min-h-screen flex-col items-center justify-center bg-default px-4">
    <div class="w-full max-w-sm space-y-6 text-center">
      <div class="font-heading text-xl font-extrabold text-white">Hiyield</div>
      <h1 class="font-heading text-4xl font-extrabold text-electric-500">Uptime</h1>
      <p class="text-sm text-muted">Sign in with your Hiyield Google account.</p>
      <UAlert v-if="error" color="error" variant="subtle" :title="error" />
      <UButton
        block
        size="lg"
        icon="i-lucide-log-in"
        :loading="loading"
        class="rounded-[10px] bg-electric-500 text-forest-900 hover:bg-electric-400"
        @click="signIn"
      >
        Sign in with Google
      </UButton>
    </div>
  </div>
</template>
