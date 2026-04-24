import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Minimal Vite config for the Tauri 2.0 POC. Vite serves the React
// renderer on port 1420; tauri.conf.json's build.devUrl points at it.
// clearScreen: false — keeps Tauri's own logs visible when running
// `npm run tauri:dev` (Vite otherwise clears the terminal on reload).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'es2021',
    // Tauri's asset loading expects a relative base path; './' produces
    // <script src="./assets/…"> instead of absolute URLs.
    outDir: 'dist',
    emptyOutDir: true,
  },
});
