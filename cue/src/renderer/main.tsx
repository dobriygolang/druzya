import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import { initSentryRenderer } from './sentry';
import './styles/globals.css';

void initSentryRenderer();

declare global {
  interface Window {
    druz9: import('@shared/ipc').Druz9API;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
