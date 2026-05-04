/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Vitest exclude e2e dir — playwright runs туда через `npm run test:e2e`
  // отдельно. Без этого `npm test` (vitest) пытается load'ить
  // @playwright/test модуль который требует playwright runtime context.
  test: {
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
  build: {
    // manualChunks убран намеренно: ручное разделение разделяло react в свой
    // chunk, но React-зависимые либы (sentry/react, monaco-editor/react,
    // framer-motion, @tanstack/react-query) попадали в "vendor", который
    // загружался ДО react chunk → "Cannot read properties of undefined
    // (reading 'createContext')". Vite/Rollup умеет делать корректный
    // topological-split автоматически — пусть делает.
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
