import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles/main.css';
import { initI18n } from './lib/i18n';
import { initObservability, ErrorBoundary } from './lib/observability';
async function bootstrap() {
    initObservability();
    await initI18n();
    if (import.meta.env.VITE_USE_MSW === 'true') {
        const { worker } = await import('./mocks/browser');
        await worker.start({ onUnhandledRequest: 'bypass' });
    }
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
    });
    ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(ErrorBoundary, { fallback: _jsx("div", { style: { padding: 40, color: '#fff', background: '#0A0A0F', minHeight: '100vh' }, children: "\u0427\u0442\u043E-\u0442\u043E \u0441\u043B\u043E\u043C\u0430\u043B\u043E\u0441\u044C. \u041F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443." }), children: _jsx(QueryClientProvider, { client: queryClient, children: _jsx(BrowserRouter, { children: _jsx(App, {}) }) }) }) }));
}
void bootstrap();
