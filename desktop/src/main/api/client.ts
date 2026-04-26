// Connect-RPC client for the copilot service. Runs in the main process
// (not the renderer) so:
//   1. the auth token never crosses the IPC boundary as a string — it
//      lives in keychain and is fetched on demand for each request.
//   2. the HTTP/2 connection can be kept warm across IPC calls.
//   3. streaming RPCs can be converted into IPC events without the
//      renderer needing to understand Connect internals.
//
// We use @connectrpc/connect-web rather than connect-node because it
// works over plain fetch (available in Electron's main process via the
// `net` or `undici` transport), keeps the binary small, and mirrors what
// the desktop client would do if it ever moved into the renderer.

import { Code, ConnectError, createPromiseClient, type PromiseClient, type Interceptor } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

import { CopilotService } from '@generated/pb/druz9/v1/copilot_connect';
import type { RuntimeConfig } from '../config/bootstrap';
import { getValidSession, refreshSession } from '../auth/refresh';

// Connect v1 API (matches the frontend's generated stubs from
// @connectrpc/protoc-gen-connect-es ^1.4.0). If we ever regenerate to
// v2, switch to createClient / Client here.
export type CopilotClient = PromiseClient<typeof CopilotService>;

/**
 * Builds a copilot client configured with the Druz9 API base URL and a
 * per-request Authorization header pulled from keychain.
 *
 * Auth flow:
 *   1. Pre-call: getValidSession() proactively refreshes if the access
 *      token is within 30s of expiry. Coalesced — one refresh per burst.
 *   2. Reactive: if the server still returns Unauthenticated (e.g. clock
 *      skew, token revoked just before the call), refresh once and retry.
 *
 * Without this, a stale access token bricked the app: keychain still
 * had a session, every call returned «HTTP 401 unauthenticated», and
 * only re-login через настройки спасал.
 */
export function createCopilotClient(cfg: RuntimeConfig): CopilotClient {
  const authDeps = { apiBaseURL: cfg.apiBaseURL };

  const authInterceptor: Interceptor = (next) => async (req) => {
    const session = await getValidSession(authDeps);
    if (session) {
      req.header.set('Authorization', `Bearer ${session.accessToken}`);
    }
    try {
      return await next(req);
    } catch (err) {
      const isUnauth =
        err instanceof ConnectError && err.code === Code.Unauthenticated;
      if (!isUnauth) throw err;
      // Server rejected — try a forced refresh once and retry the call.
      const refreshed = await refreshSession(authDeps);
      if (!refreshed) throw err; // refresh failed → bubble up the 401
      req.header.set('Authorization', `Bearer ${refreshed.accessToken}`);
      return next(req);
    }
  };

  const transport = createConnectTransport({
    baseUrl: cfg.apiBaseURL,
    useBinaryFormat: true, // smaller than JSON on the wire
    interceptors: [authInterceptor],
  });

  return createPromiseClient(CopilotService, transport);
}
