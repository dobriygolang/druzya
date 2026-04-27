import { createRoot } from 'react-dom/client';

// React namespace is auto-injected via tsconfig "jsx": "react-jsx", so we
// deliberately do NOT `import React` here (an unused import in strict
// mode breaks the build).
import App from './App';
import './styles/globals.css';

// Sentry — gate'им по `VITE_HONE_SENTRY_DSN` (build-time env). На dev/тесте
// этот флаг пустой → @sentry/electron/renderer вообще не загружается, и
// sentry-ipc:// fetch-spam в console не появляется. На prod-build CI
// выставляет переменную, IPC bridge до main-process'а активируется.
const SENTRY_DSN_BUILD_FLAG =
  ((import.meta.env.VITE_HONE_SENTRY_DSN as string | undefined) ?? '').trim();
if (SENTRY_DSN_BUILD_FLAG) {
  // Динамический import чтобы не тащить @sentry/electron/renderer в bundle
  // dev-сборки. В prod чанк всё равно создаётся — flag постоянный.
  void import('@sentry/electron/renderer').then(
    ({ init, getDefaultIntegrations, scopeToMainIntegration }) => {
      const opts = { tracesSampleRate: 0 };
      init({
        ...opts,
        // scopeToMain удаляем — он зовёт fetch('sentry-ipc://scope/…'),
        // Chromium не поддерживает custom-scheme fetch без privileged-
        // scheme registration. Renderer-side breadcrumbs не сольются в
        // main scope, но sами exception'ы пойдут через preload IPC.
        integrations: getDefaultIntegrations(opts).filter(
          (i) => i.name !== scopeToMainIntegration().name,
        ),
      });
    },
  );
}

// Strict mode is deliberately OFF for the MVP. The ported design uses
// requestAnimationFrame-driven state in <CanvasBg> which double-fires
// under StrictMode's intentional development remount, causing visual
// stutter. We flip it back on once the canvas component is refactored
// to be remount-safe.
const mount = document.getElementById('root');
if (!mount) throw new Error('hone: #root missing');

createRoot(mount).render(<App />);
