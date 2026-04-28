// Renderer-side Sentry bootstrap.
//
// КРИТИЧНО: @sentry/electron renderer init использует кастомный
// `sentry-ipc://` URL scheme для общения с main process'ом. Этот scheme
// должен быть зарегистрирован main'ом через `protocol.registerSchemes
// AsPrivileged()` ДО `app.whenReady()` И main process должен иметь
// активный Sentry.init() для слушания этого канала.
//
// В dev-режиме (без DRUZ9_SENTRY_DSN env'а) main не запускает Sentry,
// scheme не регистрируется, а renderer всё равно пытался init'нуть —
// результат: спам в консоль «sentry-ipc:// scheme not supported» на
// каждый renderer event. Юзер не видит свои реальные ошибки за этим
// шумом.
//
// Решение: gate renderer init на наличие window.cueSentryEnabled (true
// expose'ится preload'ом ТОЛЬКО когда main реально сконфигурил Sentry).
// Без этой переменной — silent skip, никаких IPC-fetch'ей.

let started = false;

export async function initSentryRenderer(): Promise<void> {
  if (started) return;
  // Если main process не выставил флаг — skip. Не плодим scheme errors.
  // Флаг expose'ится preload-bridge'ем (см. preload/index.ts).
  const enabled = (window as unknown as { cueSentryEnabled?: boolean }).cueSentryEnabled === true;
  if (!enabled) {
    started = true;
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry: any = await import('@sentry/electron/renderer');
    Sentry.init({});
    started = true;
  } catch {
    // Package not installed — renderer stays silent.
  }
}
