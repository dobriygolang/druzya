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
        glow: '0 6px 24px rgba(88,44,255,0.4)',
        card: '0 1px 3px rgba(0,0,0,0.5)',
        'glow-pink': '0 6px 24px rgba(244,114,182,0.4)',
        'glow-warn': '0 6px 24px rgba(251,191,36,0.4)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        h1: ['48px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '800' }],
        h2: ['32px', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '700' }],
        h3: ['24px', { lineHeight: '1.3', fontWeight: '700' }],
        h4: ['18px', { lineHeight: '1.4', fontWeight: '700' }],
      },
    },
  },
  plugins: [],
} satisfies Config
