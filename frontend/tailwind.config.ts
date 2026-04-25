import type { Config } from 'tailwindcss'

/**
 * druz9 frontend Tailwind config — modern design (Pencil v2).
 * Colors are now CSS-variable driven for dark/light theming.
 * Variables are defined in src/styles/main.css under :root, .dark, .light.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        surface: {
          1: 'rgb(var(--color-surface-1) / <alpha-value>)',
          2: 'rgb(var(--color-surface-2) / <alpha-value>)',
          3: 'rgb(var(--color-surface-3) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
          strong: 'rgb(var(--color-border-strong) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--color-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-hover) / <alpha-value>)',
        },
        success: 'rgb(var(--color-success) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
        warn: 'rgb(var(--color-warn) / <alpha-value>)',
        cyan: 'rgb(var(--color-cyan) / <alpha-value>)',
        pink: 'rgb(var(--color-pink) / <alpha-value>)',
      },
      borderRadius: { sm: '6px', md: '8px', lg: '12px', xl: '16px', '2xl': '20px' },
      boxShadow: {
        // Phase-1 unification: violet/pink/warn glows collapsed to neutral
        // dark shadow. Only `glow-red` keeps a colored halo, reserved for
        // critical/live signals (recording dots, danger CTAs).
        glow: '0 6px 24px rgba(0,0,0,0.6)',
        card: '0 1px 3px rgba(0,0,0,0.5)',
        'glow-pink': '0 6px 24px rgba(0,0,0,0.6)',
        'glow-warn': '0 6px 24px rgba(0,0,0,0.6)',
        'glow-red': '0 6px 24px rgba(255,59,48,0.4)',
      },
      fontFamily: {
        // Phase-1 unification: collapse to the Hone duo (Inter + JetBrains Mono).
        // Geist is dropped — having two display families makes web look like
        // a different product than the desktop app.
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        h1: ['48px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '800' }],
        h2: ['32px', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '700' }],
        h3: ['24px', { lineHeight: '1.3', fontWeight: '700' }],
        h4: ['18px', { lineHeight: '1.4', fontWeight: '700' }],
      },
      // Wave-10 — shimmer keyframe for <EmptySkeleton /> loading states.
      // The bg-position trick paints a gradient under a fixed-width
      // background-size so the gradient slides through the element.
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
