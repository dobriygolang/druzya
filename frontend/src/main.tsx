import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import App from './App'
import './styles/main.css'
import { initI18n } from './lib/i18n'
import { initObservability, ErrorBoundary } from './lib/observability'
import { bootstrapSilentRefresh } from './lib/apiClient'
import { startCWV } from './lib/perfMetrics'
import { installOnlineSync } from './lib/offline'

async function bootstrap() {
  initObservability()
  // Core Web Vitals — LCP / INP / CLS / TTFB. Dev: console.debug под [CWV].
  // Prod: sendBeacon → /api/v1/telemetry/cwv (silent если endpoint отсутствует).
  startCWV()
  await initI18n()
  // Restart the silent-refresh timer from the persisted access TTL — without
  // this, a page reload would only see access expiry on the next failing
  // request, causing a brief flash of 401 → /login during the rotation.
  bootstrapSilentRefresh()
  // Offline vocab outbox: drain on app boot + register online listener.
  // Безопасно вызывать даже если IDB недоступен — internally degrade'ит.
  installOnlineSync()
  // PWA service worker — autoUpdate registration через vite-plugin-pwa
  // virtual module. Динамический import чтобы dev build (где плагин даёт
  // no-op stub) не падал при отсутствии virtual:pwa-register.
  void registerServiceWorker()

  if (import.meta.env.VITE_USE_MSW === 'true') {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    },
  })

  // Last-resort fallback before i18n is even initialised — kept as a
  // literal so it always renders, even if i18next failed to bootstrap.
  // eslint-disable-next-line d9-i18n/no-cyrillic-literals
  const bootFallback = 'Что-то сломалось. Перезагрузи страницу.'
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary fallback={<div style={{padding:40,color:'#FFFFFF',background:'#000000',minHeight:'100vh'}}>{bootFallback}</div>}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

// Регистрируем SW через `virtual:pwa-register` (генерирует vite-plugin-pwa).
// autoUpdate: новые версии устанавливаются молча, без модального prompt.
// onNeedRefresh / onOfflineReady — оставлены как hooks для последующего
// subtle toast, сейчас просто debug-логи (no UI noise).
async function registerServiceWorker() {
  // Skip в MSW dev-моде: mockServiceWorker.js конфликтует с workbox SW —
  // оба пытаются claim /‌. PWA-режим тестируется через `npm run build && preview`.
  if (import.meta.env.VITE_USE_MSW === 'true') return
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    // @ts-expect-error — virtual module, генерится vite-plugin-pwa в build/preview.
    // В dev (`vite` без build) модуль резолвится в noop, всё равно safe.
    const mod = await import('virtual:pwa-register')
    mod.registerSW({
      immediate: true,
      onNeedRefresh() {
        // eslint-disable-next-line no-console
        console.debug('[pwa] new version available — will activate on next load')
      },
      onOfflineReady() {
        // eslint-disable-next-line no-console
        console.debug('[pwa] offline-ready')
      },
    })
  } catch {
    // dev mode без plugin'а или browser без SW — silently skip.
  }
}

void bootstrap()
