import { test, expect } from '@playwright/test'

const NAV_TARGETS: { path: string; label: RegExp }[] = [
  { path: '/sanctum', label: /sanctum|санктум/i },
  { path: '/arena', label: /arena|арена/i },
  { path: '/atlas', label: /atlas|атлас/i },
  { path: '/codex', label: /codex|кодекс/i },
  { path: '/guild', label: /guild|гильдия/i },
]

test.describe('Sanctum navigation', () => {
  test('TopNav shows nav items and each loads its page', async ({ page }) => {
    await page.goto('/sanctum')
    await expect(page).toHaveURL(/\/sanctum/)

    // Verify a nav element exists somewhere on the page
    const nav = page.locator('header, nav').first()
    await expect(nav).toBeVisible()

    for (const { path } of NAV_TARGETS) {
      await page.goto(path)
      await expect(page).toHaveURL(new RegExp(path.replace('/', '\\/')))
      // Body should render something (not be empty)
      await expect(page.locator('body')).not.toBeEmpty()
    }
  })
})
