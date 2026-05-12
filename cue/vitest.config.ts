// vitest.config.ts — test runner config для Cue.
//
// Wave 3 K (Phase J / C7) — stealth regression harness. Параллель с
// hone/vitest.config.ts: standalone от electron.vite.config.ts (мы не
// тянем React-плагин, тестируем чистую TS-логику main-процесса), но
// path aliases mirror'ят production-сборку чтобы code-under-test резолвил
// импорты одинаково.
//
// Что тестим (см. src/main/**/__tests__/*):
//   • windows/window-manager — stealth-set лежит как ожидается, BrowserWindow
//     calls к setContentProtection / setAlwaysOnTop / setVisibleOnAllWorkspaces
//     попадают на правильные имена окон.
//   • cursor/freeze-bridge — IPC-команды (freeze/thaw) пишутся в stdin
//     spawned helper'а в правильном формате.
//   • masquerade configs — LSUIElement: true сохранён во всех presets
//     (regression-guard для launch-blocking stealth break).
//
// Что НЕ тестим (см. native/stealth-verifier для real-screen verification):
//   • Что macOS реально не показывает окно при screen-share — это
//     OS-integration, не unit. Покрывается StealthVerifier + smoke-stealth.sh.
//   • Renderer UI / IPC handlers — Wave 3 L / M / N owns эти модули.
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@generated': resolve(__dirname, '../frontend/src/api/generated'),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    pool: 'threads',
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
