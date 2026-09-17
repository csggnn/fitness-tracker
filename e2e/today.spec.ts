import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('./')
})

test('shows the plan and an empty history on first run', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Arm superset split' })).toBeVisible()
  await expect(page.getByText('Warm-up before you start: Rower, 60 kcal')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeEnabled()
  await expect(page.getByText('No sessions recorded yet.')).toBeVisible()
})

test('selecting a slot length updates the cadence hint', async ({ page }) => {
  const defaultSlot = page.getByRole('button', { name: '1:15' })
  const longSlot = page.getByRole('button', { name: '1:30' })

  await expect(defaultSlot).toHaveClass(/active/)
  await expect(page.getByText('A-to-A cadence is 2:30.')).toBeVisible()

  await longSlot.click()

  await expect(longSlot).toHaveClass(/active/)
  await expect(defaultSlot).not.toHaveClass(/active/)
  await expect(page.getByText('A-to-A cadence is 3:00.')).toBeVisible()
})
