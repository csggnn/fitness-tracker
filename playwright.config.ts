import { defineConfig, devices } from '@playwright/test'

/** Port for the Vite server started by the test run. The `dev` service keeps 5173. */
const PORT = 5174
const BASE_URL = `http://localhost:${PORT}/fitness-tracker/`

export default defineConfig({
  testDir: 'e2e',

  // Progress in the terminal, plus an HTML report in playwright-report/.
  reporter: [['list'], ['html', { open: 'never' }]],

  // Started before the first test and stopped after the last one.
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
  },

  use: {
    // `page.goto('./')` resolves against this URL.
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'phone',
      use: { ...devices['Pixel 7'] },
    },
  ],
})
