import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/fitness-tracker/',
  server: {
    host: true,
    port: 5173,
  },
  test: {
    // Browser tests under e2e/ run with Playwright.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
