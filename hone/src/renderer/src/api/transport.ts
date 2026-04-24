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
import type { Interceptor } from '@connectrpc/connect';

import { API_BASE_URL, DEV_BEARER_TOKEN } from './config';
import { useSessionStore } from '../stores/session';

// Auth interceptor. Reads the token lazily on each call so a post-login
// rotation is picked up without rebuilding the transport.
const authInterceptor: Interceptor = (next) => async (req) => {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  if (token) {
    req.header.set('authorization', `Bearer ${token}`);
  }
  return await next(req);
};

export const transport = createConnectTransport({
  baseUrl: API_BASE_URL,
  // The monolith speaks Connect wire (binary + JSON). Default here is
  // JSON because it's the debugger-friendly one and the throughput cost
  // is immaterial for a desktop app doing ~dozens of requests/hour.
  useBinaryFormat: false,
  interceptors: [authInterceptor],
});
