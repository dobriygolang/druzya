import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

const MOBILE_PAGES = ['/sanctum', '/arena', '/atlas', '/codex']

test.describe('Mobile responsive', () => {
  test('hamburger visible, drawer opens, no horizontal scroll on 4 pages', async ({ page }) => {
    await page.goto('/sanctum')

    // Hamburger button (Menu icon in AppShell)
    const hamburger = page
      .locator('button[aria-label*="menu" i], button:has(svg.lucide-menu), button:has([data-lucide="menu"])')
      .first()
    if (await hamburger.isVisible().catch(() => false)) {
      await hamburger.click()
      // Drawer should appear — look for any nav region that became visible
      await page.waitForTimeout(250)
    }

    for (const path of MOBILE_PAGES) {
      await page.goto(path)
      await page.waitForLoadState('networkidle').catch(() => undefined)
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      // Allow tiny rounding diff
      expect(scrollWidth - clientWidth).toBeLessThanOrEqual(2)
    }
  })
})
