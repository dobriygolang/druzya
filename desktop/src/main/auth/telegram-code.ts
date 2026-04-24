// Telegram login via the code-flow pattern the Druzya frontend already
// uses (see frontend/src/pages/LoginPage.tsx). We call two endpoints:
//
//   POST /api/v1/auth/telegram/start
//        → { code, deep_link, expires_at }
//        The user opens `deep_link` in their browser (t.me/<bot>?start=<code>);
//        the bot's webhook on the backend fills the code in Redis.
//
//   POST /api/v1/auth/telegram/poll { code }
//        → 202 { pending: true } — keep polling
//        → 200 { access_token, refresh_token, user, is_new_user } — done
//        → 410 { error: "code_expired" } — start over
//        → 429 { error, retry_after } — back off
//
// No deep-link callback: the bot talks to the backend, the backend
// talks to us, we never hear from the bot directly.

import { shell } from 'electron';

import type { SessionProfile, StoredSession } from './keychain';
import { saveSession } from './keychain';

const POLL_INTERVAL_MS = 2000;

export interface StartedLogin {
  /** Eight-char Crockford base32 code user already has to see. */
  code: string;
  /** t.me/<bot>?start=<code>. We open this for them, but also show it. */
  deepLink: string;
  /** ISO-8601 — fall-through to "restart" after this. */
  expiresAt: string;
}

export interface TelegramCodeClient {
  start: () => Promise<StartedLogin>;
  /**
   * Pulls /poll on an interval until the code is filled, expires, or
   * `signal` aborts. Resolves with the session profile on success —
   * tokens are persisted to the keychain inside this method.
   */
  awaitCompletion: (code: string, signal: AbortSignal) => Promise<SessionProfile>;
}

export function createTelegramCodeClient(apiBaseURL: string): TelegramCodeClient {
  const url = (path: string) => `${apiBaseURL.replace(/\/+$/, '')}${path}`;

  return {
    start: async (): Promise<StartedLogin> => {
      const resp = await fetch(url('/api/v1/auth/telegram/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (resp.status === 429) {
        const retry = resp.headers.get('retry-after') ?? '60';
        throw new Error(`rate_limited:${retry}`);
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`start failed: ${resp.status} ${text.slice(0, 200)}`);
      }
      const body = (await resp.json()) as {
        code: string;
        deep_link: string;
        expires_at: string;
      };
      // Fire-and-forget: open the Telegram bot in the user's browser.
      // This is the UX trigger that makes the bot emit the /start
      // prefilled with the code. The shell call is fine from main.
      void shell.openExternal(body.deep_link);
      return { code: body.code, deepLink: body.deep_link, expiresAt: body.expires_at };
    },

    awaitCompletion: async (code: string, signal: AbortSignal): Promise<SessionProfile> => {
      while (!signal.aborted) {
        const resp = await fetch(url('/api/v1/auth/telegram/poll'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
          signal,
        });

        if (resp.status === 202) {
          await sleep(POLL_INTERVAL_MS, signal);
          continue;
        }
        if (resp.status === 410) {
          throw new Error('code_expired');
        }
        if (resp.status === 429) {
          const ra = parseInt(resp.headers.get('retry-after') ?? '2', 10);
          await sleep(Math.max(ra, 1) * 1000, signal);
          continue;
        }
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          throw new Error(`poll failed: ${resp.status} ${text.slice(0, 200)}`);
        }

        const body = (await resp.json()) as PollSuccess;
        const profile: SessionProfile = {
          userId: body.user?.id ?? '',
          username: body.user?.username ?? '',
          avatarURL: body.user?.avatar_url ?? '',
          isNewUser: !!body.is_new_user,
        };
        const session: StoredSession = {
          accessToken: body.access_token,
          refreshToken: body.refresh_token,
          expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
          profile,
        };
        await saveSession(session);
        return profile;
      }
      throw new Error('aborted');
    },
  };
}

interface PollSuccess {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: { id?: string; username?: string; avatar_url?: string };
  is_new_user?: boolean;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
