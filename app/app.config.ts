// Primary is slate so that colour is reserved for status (green up, red down, amber suspect).
export default defineAppConfig({
  ui: {
    colors: { primary: 'slate', neutral: 'slate' },
    button: { defaultVariants: { size: 'sm' } }
  }
})
