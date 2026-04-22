import { test, expect } from '@playwright/test'

test.describe('404 page', () => {
  test('renders 404 and "На главную" returns to /sanctum', async ({ page }) => {
    await page.goto('/nonexistent')
    await expect(page.locator('body')).toContainText('404')

    const homeLink = page.getByRole('link', { name: /на главную/i }).first()
    await homeLink.click()
    await expect(page).toHaveURL(/\/sanctum/)
  })
})
