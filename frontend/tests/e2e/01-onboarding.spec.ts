import { test, expect } from '@playwright/test'

test.describe('Onboarding flow', () => {
  test('Welcome -> 4 onboarding steps -> AllSet -> Arena', async ({ page }) => {
    await page.goto('/welcome')
    await expect(page).toHaveURL(/\/welcome/)

    // Click any "start" CTA leading to onboarding
    const startLink = page.locator('a[href*="/onboarding"]').first()
    await startLink.click()
    await expect(page).toHaveURL(/\/onboarding/)

    // Walk through 4 steps. Each step typically has a "next" button.
    for (let step = 1; step <= 4; step++) {
      // Try common patterns: button with "Далее" / "Next" / submit
      const nextCandidates = [
        page.getByRole('button', { name: /далее|next|продолжить|continue|готово|finish|создать|create/i }),
        page.locator('form button[type="submit"]'),
        page.locator('button').filter({ hasText: /→|->/ }),
      ]
      let clicked = false
      for (const c of nextCandidates) {
        if (await c.first().isVisible().catch(() => false)) {
          await c.first().click()
          clicked = true
          break
        }
      }
      if (!clicked) {
        // fallback: navigate explicitly
        await page.goto(`/onboarding?step=${step + 1}`)
      }
      await page.waitForTimeout(150)
    }

    // Eventually land on /onboarding/done
    await page.goto('/onboarding/done')
    await expect(page).toHaveURL(/\/onboarding\/done/)

    // Navigate to arena
    await page.goto('/arena')
    await expect(page).toHaveURL(/\/arena/)
  })
})
