import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import App from './App'
import './styles/tokens.css'
import './styles/motion.css'
import { initI18n } from './lib/i18n'

async function bootstrap() {
  await initI18n()

  if (import.meta.env.VITE_USE_MSW === 'true') {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    },
  })

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  )
}

void bootstrap()
