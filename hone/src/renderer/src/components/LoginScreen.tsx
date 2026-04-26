// LoginScreen — показывается когда session.status === 'guest'.
//
// Telegram code-flow прямо через main-process: никаких /login web-страниц,
// никаких druz9:// custom-scheme прыжков. Hone main fetch'ает
// /auth/telegram/start, открывает t.me/<bot>?start=<code>, polling'ит до
// confirmation, сохраняет сессию в keychain, broadcast'ит authChanged —
// renderer хидрейтится сам.
//
// Старый flow («открой web /login → druz9://auth») удалён: Chrome блокировал
// custom-scheme redirect из async-контекста, в dev Electron вообще не
// регистрировал druz9:// в LaunchServices, итого «логонюсь и ничего не
// происходит» (см комментарий пользователя 2026-04-25).
import { useEffect, useRef, useState } from 'react';

import type { TelegramStart } from '@shared/ipc';
import { Wordmark } from './Chrome';
import { useSessionStore } from '../stores/session';

const POLL_INTERVAL_MS = 2000;
// Max time юзер может ждать в `awaiting` перед тем как мы скажем «бот не
// отвечает». Раньше polling шёл indefinitely → юзер тыкал в бота, бот
// почему-то не fill'ил code (webhook misconfig / token revoked / etc),
// и приложение молча polling'ало вечно. Теперь через 2 минуты — явное
// «Bot didn't respond» с retry button'ом.
const POLL_TIMEOUT_MS = 120_000;

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'awaiting'; flow: TelegramStart }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

export function LoginScreen() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const pollTimer = useRef<number | null>(null);
  const pollEpochRef = useRef(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    };
  }, []);

  const onSignIn = async () => {
    const bridge = window.hone;
    if (!bridge) {
      setPhase({ kind: 'error', message: 'Hone bridge unavailable (running in browser?)' });
      return;
    }
    setPhase({ kind: 'starting' });
    try {
      const flow = await bridge.auth.tgStart();
      // Open the bot deep-link in the system browser. macOS / iOS / Android
      // catch the t.me/* link and hand it to the Telegram app if installed.
      await bridge.shell.openExternal(flow.deepLink);
      setPhase({ kind: 'awaiting', flow });
      pollLoop(flow.code);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPhase({ kind: 'error', message: msg });
    }
  };

  const pollLoop = (code: string) => {
    // Kill any in-flight ticks от прошлых attempt'ов. Если юзер кликнул
    // Sign In дважды быстро (или React StrictMode double-mount'нул), могла
    // получиться race: tick-A polls для code-A, tick-B polls для code-B,
    // оба переписывают pollTimer.current, в итоге один из них продолжает
    // тикать с stale code'ом и никогда не получит 'ok'.
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    // Per-call cancel-token — если pollLoop вызвался ещё раз с новым code'ом,
    // старый цикл проверит свой токен и завершится.
    const myEpoch = ++pollEpochRef.current;
    const startedAt = Date.now();
    const tick = async () => {
      const bridge = window.hone;
      if (!bridge || cancelledRef.current) return;
      // Stale tick — другой pollLoop запущен после нас.
      if (myEpoch !== pollEpochRef.current) return;
      // Hard timeout — bot не отвечает уже 2 минуты, не tease'им юзера.
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setPhase({
          kind: 'error',
          message:
            "Bot didn't respond within 2 min. Likely the bot webhook isn't registered on the server, or the bot didn't receive your /start message. Try again, and if it still fails, contact admin.",
        });
        return;
      }
      const result = await bridge.auth.tgPoll(code);
      if (cancelledRef.current) return;
      switch (result.kind) {
        case 'ok':
          // Direct hydrate — НЕ полагаемся на authChanged IPC event'у. Был
          // bug: backend возвращал 200, main сохранял session, broadcast'ил
          // authChanged, но renderer'овский listener почему-то не срабатывал
          // (race с unmount/remount?), юзер застревал в "Waiting for
          // confirmation…" хотя по логам всё успешно. Hydrate напрямую из
          // result.session — failsafe, не зависит от IPC bus'а.
          if (result.session && result.session.accessToken) {
            useSessionStore.getState().hydrate({
              userId: result.session.userId,
              accessToken: result.session.accessToken,
              refreshToken: result.session.refreshToken ?? undefined,
              expiresAt: result.session.expiresAt,
            });
          }
          setPhase({ kind: 'idle' });
          return;
        case 'pending':
          pollTimer.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
          return;
        case 'expired':
          setPhase({ kind: 'expired' });
          return;
        case 'rate_limited':
          // Backoff to whatever the server told us, fall back to default.
          pollTimer.current = window.setTimeout(
            () => void tick(),
            Math.max(result.retryAfter * 1000, POLL_INTERVAL_MS),
          );
          return;
        case 'error':
          setPhase({ kind: 'error', message: result.message });
          return;
      }
    };
    pollTimer.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
  };

  const cancelFlow = () => {
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
    setPhase({ kind: 'idle' });
  };

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
      }}
    >
      <Wordmark />
      <div style={{ maxWidth: 420, textAlign: 'center', padding: '0 32px' }}>
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}
        >
          QUIET COCKPIT FOR DEVELOPERS
        </div>
        <h1
          style={{
            margin: '20px 0 8px',
            fontSize: 36,
            fontWeight: 400,
            letterSpacing: '-0.025em',
            lineHeight: 1.05,
          }}
        >
          Sign in to start.
        </h1>
        <p
          style={{
            fontSize: 14,
            color: 'var(--ink-60)',
            marginTop: 12,
            lineHeight: 1.6,
          }}
        >
          Hone uses your druz9 account. Подтверди вход в Telegram, мы поймаем
          подтверждение автоматически.
        </p>

        {phase.kind === 'awaiting' ? (
          <AwaitingPanel flow={phase.flow} onCancel={cancelFlow} />
        ) : (
          <button
            onClick={() => void onSignIn()}
            disabled={phase.kind === 'starting'}
            className="focus-ring"
            style={{
              marginTop: 32,
              padding: '11px 24px',
              borderRadius: 999,
              background: phase.kind === 'starting' ? 'rgba(255,255,255,0.08)' : '#fff',
              color: phase.kind === 'starting' ? 'var(--ink-60)' : '#000',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {phase.kind === 'starting' ? 'Connecting…' : 'Sign in via Telegram'}
          </button>
        )}

        {phase.kind === 'expired' && (
          <p className="mono" style={{ marginTop: 16, fontSize: 11, color: 'var(--ink-40)' }}>
            CODE EXPIRED — TRY AGAIN
          </p>
        )}
        {phase.kind === 'error' && (
          <p className="mono" style={{ marginTop: 16, fontSize: 11, color: 'var(--red)' }}>
            {phase.message}
          </p>
        )}
      </div>
    </div>
  );
}

function AwaitingPanel({ flow, onCancel }: { flow: TelegramStart; onCancel: () => void }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(flow.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard может быть недоступен */
    }
  };
  const onReopenBot = async () => {
    await window.hone?.shell.openExternal(flow.deepLink);
  };
  return (
    <div style={{ marginTop: 28 }}>
      <div
        style={{
          padding: '14px 18px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ textAlign: 'left' }}>
          <div
            className="mono"
            style={{ fontSize: 9, letterSpacing: '.18em', color: 'var(--ink-40)' }}
          >
            CODE
          </div>
          <div className="mono" style={{ fontSize: 22, letterSpacing: '.12em', marginTop: 2 }}>
            {flow.code}
          </div>
        </div>
        <button
          onClick={() => void onCopy()}
          className="focus-ring mono"
          style={{
            padding: '6px 12px',
            fontSize: 10,
            letterSpacing: '.14em',
            color: copied ? 'var(--ink)' : 'var(--ink-60)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 999,
            background: 'transparent',
          }}
        >
          {copied ? '✓ COPIED' : 'COPY'}
        </button>
      </div>
      <p style={{ marginTop: 14, fontSize: 13, color: 'var(--ink-60)', lineHeight: 1.55 }}>
        Открой бота в Telegram и нажми Start. Если бот не открылся
        автоматически — клик{' '}
        <button
          onClick={() => void onReopenBot()}
          style={{
            color: 'var(--ink)',
            textDecoration: 'underline',
            background: 'transparent',
            padding: 0,
          }}
        >
          сюда
        </button>
        .
      </p>
      <p
        className="mono"
        style={{ marginTop: 12, fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-40)' }}
      >
        WAITING FOR CONFIRMATION…
      </p>
      <button
        onClick={onCancel}
        className="mono"
        style={{
          marginTop: 16,
          padding: '5px 12px',
          fontSize: 10,
          letterSpacing: '.14em',
          color: 'var(--ink-40)',
          background: 'transparent',
        }}
      >
        CANCEL
      </button>
    </div>
  );
}
