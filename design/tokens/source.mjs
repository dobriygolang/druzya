/**
 * Druz9 design tokens — single source of truth across 3 apps (web frontend, Hone, Cue).
 *
 * Edit values here, run `make tokens`, commit the generated files.
 *
 * What lives here: motion (durations + easing curves), focus-ring, density modes,
 * breakpoints, typography scale. Palette is NOT here — it stays in each app's
 * existing CSS (--ink-*, --hair*, --red, --d9-*). Foundation is additive.
 *
 * See: /Users/sedorofeevd/.claude/plans/accessibility-review-color-design-hando-linked-owl.md
 */

export const tokens = {
  motion: {
    dur: {
      micro: 80,
      small: 160,
      medium: 240,
      large: 360,
      xlarge: 520,
      xxlarge: 720,
      cinematic: 1100,
    },
    ease: {
      standard: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      emphasized: 'cubic-bezier(0.16, 1, 0.3, 1)',
      decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
      accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
    },
  },

  focusRing: '0 0 0 1.5px rgba(255, 255, 255, 0.85), 0 0 0 4px rgba(255, 255, 255, 0.08)',

  density: {
    compact: {
      gapRow: 4,
      gapSection: 12,
      padInline: 8,
      padBlock: 6,
      padContainer: 12,
      radiusInner: 6,
      radiusOuter: 10,
      lineHeightBody: 1.4,
      minRowHeight: 28,
    },
    comfortable: {
      gapRow: 8,
      gapSection: 24,
      padInline: 16,
      padBlock: 12,
      padContainer: 32,
      radiusInner: 10,
      radiusOuter: 14,
      lineHeightBody: 1.55,
      minRowHeight: 36,
    },
    spacious: {
      gapRow: 12,
      gapSection: 40,
      padInline: 24,
      padBlock: 20,
      padContainer: 64,
      radiusInner: 14,
      radiusOuter: 18,
      lineHeightBody: 1.7,
      minRowHeight: 48,
    },
  },

  breakpoints: {
    sm: 640,
    md: 768,
    lg: 1024,
    xl: 1280,
    '2xl': 1536,
    '3xl': 1920,
    '4xl': 2560,
  },

  typography: {
    display: { size: 56, lh: 1.05, ls: '-0.025em', weight: 300 },
    h1: { size: 40, lh: 1.10, ls: '-0.022em', weight: 600 },
    h2: { size: 28, lh: 1.20, ls: '-0.018em', weight: 600 },
    h3: { size: 20, lh: 1.30, ls: '-0.012em', weight: 600 },
    body: { size: 15, lh: 1.55, ls: '-0.005em', weight: 400 },
    caption: { size: 12, lh: 1.40, ls: '0.010em', weight: 500 },
  },
};
