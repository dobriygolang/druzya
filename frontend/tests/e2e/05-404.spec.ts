import { test, expect } from '@playwright/test'

test.describe('404 page', () => {
  test('renders 404 and "На главную" returns to /sanctum', async ({ page }) => {
    await page.goto('/nonexistent')
    // Лениво загружаемый NotFoundPage сидит за <Suspense> — ждём hydration по testid.
    const homeLink = page.getByTestId('back-home')
    await homeLink.waitFor({ state: 'visible', timeout: 10_000 })
    await expect(page.locator('body')).toContainText('404')
    await homeLink.click()
    await expect(page).toHaveURL(/\/sanctum/)
  })
})
