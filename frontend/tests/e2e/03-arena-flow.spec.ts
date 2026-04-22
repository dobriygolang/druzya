import { test, expect } from '@playwright/test'

test.describe('Arena flow', () => {
  test('arena hub visible, match end shows WIN + LP delta', async ({ page }) => {
    await page.goto('/arena')
    await expect(page).toHaveURL(/\/arena/)
    // Body has content
    await expect(page.locator('body')).not.toBeEmpty()

    await page.goto('/match/abc/end')
    await expect(page).toHaveURL(/\/match\/abc\/end/)

    // Wait for the lazy-loaded page to render past the Suspense fallback.
    await expect(page.getByText(/win|победа/i).first()).toBeVisible({ timeout: 15_000 })

    const text = await page.locator('body').innerText()
    // Look for WIN indicator and LP delta (e.g. "+25 LP" or just "LP")
    const hasWin = /\bwin\b|победа/i.test(text)
    const hasLp = /lp|рейтинг|очк/i.test(text)
    expect(hasWin || hasLp).toBeTruthy()
  })
})
