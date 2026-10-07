// Hiyield brand palette (app/assets/css/main.css defines the forest/electric/ink Tailwind
// colour scales that these names resolve to — Nuxt UI's colour plugin just needs the names to
// match a `--color-{name}-{shade}` theme token, so no extra nuxt.config registration is needed).
// `info` approximates the brand's #00A0E3 with Tailwind's stock `sky` (sky-500 #0ea5e9 is close).
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'forest',
      neutral: 'ink',
      success: 'electric',
      error: 'red',
      warning: 'amber',
      info: 'sky'
    },
    button: { defaultVariants: { size: 'sm' } }
  }
})
