/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    // PWA: SW + offline vocab review для /lingua.
    // Только vocab работает offline — Reading/Writing/Listening/Speaking
    // требуют LLM/Whisper backend (online-only). SW даёт:
    //   1. precache app-shell для standalone install + first-paint speed;
    //   2. runtime cache для ListVocabDue / ListReadingMaterials /
    //      ListListeningMaterials (warm cache при offline open lingua);
    //   3. registerType: autoUpdate — новые версии тихо устанавливаются на
    //      следующий visit'е, без модального диалога.
    //
    // manifest здесь mirror public/manifest.webmanifest — vite-plugin-pwa
    // переопределит generation, поэтому держим в sync вручную. Если manifest
    // меняется — обновить и здесь, и в public/manifest.webmanifest.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // регистрируем sами в main.tsx через virtual:pwa-register
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'icons/lingua-192.png',
        'icons/lingua-512.png',
        'robots.txt',
      ],
      manifest: {
        name: 'druz9',
        short_name: 'druz9',
        description:
          'Lingua + AI-coach: senior IT engineering prep (Go · ML · English) + offline vocab review',
        start_url: '/lingua',
        scope: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        orientation: 'any',
        lang: 'ru',
        categories: ['education', 'productivity'],
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/lingua-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icons/lingua-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        shortcuts: [
          { name: 'Lingua', url: '/lingua' },
          { name: 'AI coach', url: '/coach' },
          { name: 'Atlas', url: '/atlas' },
        ],
      },
      workbox: {
        // Precache JS/CSS/HTML/SVG/fonts. Изображения (apple-touch / icons)
        // подхватятся через includeAssets — Workbox добавит их в precache.
        globPatterns: ['**/*.{js,css,html,svg,woff2,png}'],
        // Bump для больших monaco/excalidraw chunks (~5MB+ uncompressed).
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // SPA fallback: navigations не на /api → index.html (precached).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//, /^\/mockServiceWorker\.js$/],
        runtimeCaching: [
          {
            // Vocab due list: hot path, кэшируем агрессивно (cacheFirst, 1d TTL).
            // Online flush из useQuery всё равно дёргает новую копию.
            urlPattern: /\/api\/v1\/hone\.v1\.HoneService\/ListVocabDue$/,
            handler: 'CacheFirst',
            method: 'POST',
            options: {
              cacheName: 'lingua-vocab-due-v1',
              expiration: { maxAgeSeconds: 60 * 60 * 24, maxEntries: 10 },
              matchOptions: { ignoreSearch: false },
              // Connect-RPC использует POST даже для чтения — нужно явно опт-ин.
              plugins: [
                {
                  cacheKeyWillBeUsed: async ({ request }) => {
                    // Тело запроса (limit) включаем в cache key чтобы лимиты не
                    // мешали друг другу.
                    try {
                      const body = await request.clone().text()
                      return `${request.url}?body=${body}`
                    } catch {
                      return request.url
                    }
                  },
                },
              ],
            },
          },
          {
            urlPattern: /\/api\/v1\/hone\.v1\.HoneService\/ListReadingMaterials$/,
            handler: 'StaleWhileRevalidate',
            method: 'POST',
            options: {
              cacheName: 'lingua-reading-list-v1',
              expiration: { maxAgeSeconds: 60 * 60 * 24, maxEntries: 20 },
              plugins: [
                {
                  cacheKeyWillBeUsed: async ({ request }) => {
                    try {
                      const body = await request.clone().text()
                      return `${request.url}?body=${body}`
                    } catch {
                      return request.url
                    }
                  },
                },
              ],
            },
          },
          {
            urlPattern: /\/api\/v1\/hone\.v1\.HoneService\/ListListeningMaterials$/,
            handler: 'StaleWhileRevalidate',
            method: 'POST',
            options: {
              cacheName: 'lingua-listening-list-v1',
              expiration: { maxAgeSeconds: 60 * 60 * 24, maxEntries: 20 },
              plugins: [
                {
                  cacheKeyWillBeUsed: async ({ request }) => {
                    try {
                      const body = await request.clone().text()
                      return `${request.url}?body=${body}`
                    } catch {
                      return request.url
                    }
                  },
                },
              ],
            },
          },
        ],
      },
      devOptions: {
        // SW disabled в dev по дефолту: cache штука неприятная для HMR.
        // Тестировать оffline-режим — через `npm run build && npm run preview`.
        enabled: false,
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Typed Dict locale (shared with Hone / Cue). Used alongside the
      // legacy react-i18next JSON namespaces during the wave-by-wave
      // migration to the flat compile-checked Dict.
      '@d9-i18n': path.resolve(__dirname, '../shared/i18n'),
    },
  },
  // Vitest exclude e2e dir — playwright runs туда через `npm run test:e2e`
  // отдельно. Без этого `npm test` (vitest) пытается load'ить
  // @playwright/test модуль который требует playwright runtime context.
  test: {
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
  build: {
    // Modern browsers only — соответствует tsconfig target: ES2022.
    // Уменьшает bundle (no transpile down к ES2015) и включает native
    // top-level await, optional chaining без polyfill'ов.
    target: 'esnext',
    // manualChunks убран намеренно: ручное разделение разделяло react в свой
    // chunk, но React-зависимые либы (sentry/react, monaco-editor/react,
    // framer-motion, @tanstack/react-query) попадали в "vendor", который
    // загружался ДО react chunk → "Cannot read properties of undefined
    // (reading 'createContext')". Vite/Rollup умеет делать корректный
    // topological-split автоматически — пусть делает.
    // Brotli/gzip compression выполняется на nginx-уровне (см infra/nginx/),
    // дублировать build-time плагином смысла нет — лишний devDep.
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: (process.env.VITE_API_PROXY || 'http://localhost:8080').replace(/^http/, 'ws'),
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
