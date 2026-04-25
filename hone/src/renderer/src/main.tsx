import { createRoot } from 'react-dom/client';
import {
  init as sentryInit,
  getDefaultIntegrations,
  scopeToMainIntegration,
} from '@sentry/electron/renderer';

// React namespace is auto-injected via tsconfig "jsx": "react-jsx", so we
// deliberately do NOT `import React` here (an unused import in strict
// mode breaks the build).
import App from './App';
import './styles/globals.css';

// Sentry-renderer — attach to main-process DSN via @sentry/electron IPC.
// scopeToMainIntegration отключаем потому что в Electron-renderer'е оно
// триггерит fetch() на custom URL `sentry-ipc://scope/sentry_key`, а
// Chromium не поддерживает custom-scheme fetch без registerSchemesAsPrivileged.
// Без этой integration scope-updates на main не доходят (и breadcrumb-history
// у crash'ей в renderer'е будет пустой), НО renderer перестаёт спамить
// «Fetch API cannot load sentry-ipc://...» в console на каждый log/RECV.
// Сами exception'ы в renderer'е всё равно поедут в main через preload IPC
// bridge (из @sentry/electron preload script).
const sentryOpts = { tracesSampleRate: 0 };
sentryInit({
  ...sentryOpts,
  integrations: getDefaultIntegrations(sentryOpts).filter(
    (i) => i.name !== scopeToMainIntegration().name,
  ),
});

// Strict mode is deliberately OFF for the MVP. The ported design uses
// requestAnimationFrame-driven state in <CanvasBg> which double-fires
// under StrictMode's intentional development remount, causing visual
// stutter. We flip it back on once the canvas component is refactored
// to be remount-safe.
const mount = document.getElementById('root');
if (!mount) throw new Error('hone: #root missing');

createRoot(mount).render(<App />);
