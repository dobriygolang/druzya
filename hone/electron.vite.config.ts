import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// electron-vite scaffolding mirrors desktop/ (the stealth copilot) so the
// two apps can share a codegen root (frontend/src/api/generated) and a
// future shared/electron-core package. Any divergence here should have a
// reason documented in the README.
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main'),
        // Connect-RPC TS stubs are emitted into the frontend tree by the
        // backend's `make gen-proto`; both desktop and hone alias the same
        // directory so one codegen run updates both apps.
        '@generated': resolve(__dirname, '../frontend/src/api/generated'),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [react()],
  },
});
