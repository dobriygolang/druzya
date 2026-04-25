// transport.ts — the Connect-RPC transport used by every generated client.
//
// Single global transport: creating one per query would be a waste (each
// allocates headers maps + interceptor chain). Connect-Web transports are
// thread-safe by construction, so we memoise.
//
// Auth interceptor order:
//   1. dev-bearer hatch (VITE_DRUZ9_DEV_TOKEN) — useful before keychain
//      auth ships; flagged unused in prod.
//   2. session store bearer — populated after the keychain auth flow
//      completes. Empty until then → unauthenticated calls → the backend
//      returns Unauthenticated which the renderer surfaces as "log in".
import { createConnectTransport } from '@connectrpc/connect-web';
import { ConnectError, Code, type Interceptor } from '@connectrpc/connect';

import { API_BASE_URL, DEV_BEARER_TOKEN } from './config';
import { useSessionStore } from '../stores/session';
import { getDeviceId, clearDeviceId } from './device';

// Auth interceptor. Reads the token lazily on each call so a post-login
// rotation is picked up without rebuilding the transport.
const authInterceptor: Interceptor = (next) => async (req) => {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  if (token) {
    req.header.set('authorization', `Bearer ${token}`);
  }
  // X-Device-ID — Phase C-3.1 sync foundation. Backend пишет heartbeat
  // и проверяет revocation. Когда device-id ещё не зарегистрирован
  // (первый запуск до ensureDevice) — header просто отсутствует,
  // backend трактует как «legacy без sync» и пропускает.
  const deviceId = getDeviceId();
  if (deviceId) {
    req.header.set('x-device-id', deviceId);
  }
  try {
    return await next(req);
  } catch (err) {
    // device_revoked — backend signal'ит что наш device disabled с
    // другого устройства. Wipe local state и отправляем юзера в логин.
    handleRevocation(err);
    throw err;
  }
};

function handleRevocation(err: unknown): void {
  if (!(err instanceof ConnectError)) return;
  if (err.code !== Code.Unauthenticated) return;
  const raw = err.rawMessage ?? '';
  if (!raw.includes('device_revoked')) return;
  // Wipe local secrets — auth token + device id + sync cursor + IndexedDB
  // cache (privacy: revoke = data wipe). Session-store clear вернёт юзера
  // на LoginScreen (App.tsx подписан на accessToken).
  clearDeviceId();
  // Best-effort cache wipe + cursor clear. Lazy-import чтобы не тащить
  // IndexedDB/cursor код в hot transport path при каждом запуске.
  const userId = useSessionStore.getState().userId;
  void Promise.all([
    import('./sync').then(({ clearStoredCursor }) => clearStoredCursor()),
    userId
      ? import('./localCache').then(({ wipeCache }) => wipeCache(userId))
      : Promise.resolve(),
  ]).catch(() => {
    /* best-effort */
  });
  void useSessionStore.getState().clear();
}

export const transport = createConnectTransport({
  baseUrl: API_BASE_URL,
  // The monolith speaks Connect wire (binary + JSON). Default here is
  // JSON because it's the debugger-friendly one and the throughput cost
  // is immaterial for a desktop app doing ~dozens of requests/hour.
  useBinaryFormat: false,
  interceptors: [authInterceptor],
});
