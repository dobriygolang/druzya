// Onboarding — 4-step wizard:
//   1. Welcome
//   2. macOS permissions (Screen Recording, Accessibility, Microphone)
//   3. Telegram login (opens browser → druz9:// callback)
//   4. Done / hotkey demo
//
// We poll permission state on every focus so the UI reflects what the
// user did in System Settings without needing to restart.

import { useEffect, useState } from 'react';

import {
  IconCheck,
  IconKey,
  IconMic,
  IconShield,
  IconSparkles,
} from '../../components/icons';
import { BrandMark } from '../../components/d9';
import { Button, Kbd, StatusDot } from '../../components/primitives';
import type { PermissionKind, PermissionState } from '@shared/ipc';
import { useAuthStore } from '../../stores/auth';

type Step = 'welcome' | 'permissions' | 'login' | 'done';

export function OnboardingScreen() {
  const [step, setStep] = useState<Step>('welcome');
  const [perms, setPerms] = useState<PermissionState | null>(null);
  const session = useAuthStore((s) => s.session);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    return bootstrap();
  }, [bootstrap]);

  const refreshPerms = async () => {
    try {
      setPerms(await window.druz9.permissions.check());
    } catch {
      /* noop — shown as "не определено" in UI */
    }
  };

  useEffect(() => {
    if (step !== 'permissions') return;
    void refreshPerms();
    const h = setInterval(refreshPerms, 1500);
    const onFocus = () => void refreshPerms();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(h);
      window.removeEventListener('focus', onFocus);
    };
  }, [step]);

  // Move past login automatically once session appears.
  useEffect(() => {
    if (step === 'login' && session) setStep('done');
  }, [step, session]);

  return (
    <div
      className="d9-root"
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--d9-obsidian)',
        color: 'var(--d9-ink)',
        fontFamily: 'var(--d9-font-sans)',
      }}
    >
      <StepDots current={step} />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        {step === 'welcome' && <WelcomeStep onNext={() => setStep('permissions')} />}
        {step === 'permissions' && (
          <PermissionsStep perms={perms} refresh={refreshPerms} onNext={() => setStep('login')} />
        )}
        {step === 'login' && <LoginStep />}
        {step === 'done' && <DoneStep />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function StepDots({ current }: { current: Step }) {
  const order: Step[] = ['welcome', 'permissions', 'login', 'done'];
  const idx = order.indexOf(current);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '24px 0 0' }}>
      {order.map((_, i) => (
        <div
          key={i}
          style={{
            width: 24,
            height: 4,
            borderRadius: 2,
            background: i <= idx ? 'var(--d9-accent)' : 'var(--d9-hairline-b)',
            transition: 'background 160ms',
          }}
        />
      ))}
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ textAlign: 'center', maxWidth: 440 }}>
      <BrandMark size={72} />
      <h1 style={{ fontSize: 28, margin: '20px 0 8px', fontFamily: 'var(--d9-font-display)' }}>
        Druz9 Copilot
      </h1>
      <p style={{ fontSize: 14, color: 'var(--d9-ink-dim)', lineHeight: 1.5, margin: '0 0 28px' }}>
        Невидимый AI-помощник для разработчиков. Скриншот — и ответ рядом, пока ты делишь экран.
      </p>
      <Button variant="primary" size="md" onClick={onNext}>
        Начать
      </Button>
    </div>
  );
}

function PermissionsStep({
  perms,
  refresh,
  onNext,
}: {
  perms: PermissionState | null;
  refresh: () => Promise<void>;
  onNext: () => void;
}) {
  return (
    <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, margin: '0 0 6px' }}>Разрешения macOS</h2>
        <p style={{ fontSize: 13, color: 'var(--d9-ink-mute)', margin: 0 }}>
          Без них приложение не сможет работать полноценно.
        </p>
      </div>

      {/* macOS quirk: both Screen Recording and Accessibility statuses
          are cached by the TCC subsystem for the lifetime of the process.
          Users toggle the switch in System Settings, come back to Druz9,
          and still see "not granted". We show a hint + Рестарт button on
          any still-ungranted permission to make the fix obvious. */}
      {(perms?.screenRecording !== 'granted' || perms?.accessibility !== 'granted') && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 9,
            background: 'var(--d9-accent-glow)',
            border: '0.5px solid oklch(0.72 0.23 300 / 0.35)',
            fontSize: 11.5,
            color: 'var(--d9-accent-hi)',
            letterSpacing: '-0.005em',
            lineHeight: 1.45,
          }}
        >
          <b>Если переключатель уже включён, а доступа «нет»</b> — macOS кэширует
          статус до рестарта процесса. Включи тоггл в Системных настройках, затем нажми
          «Рестарт» — приложение перезапустится и подтянет свежее состояние.
        </div>
      )}

      <PermissionRow
        icon={<IconShield size={16} />}
        title="Запись экрана"
        hint="Чтобы делать скриншоты для AI."
        state={perms?.screenRecording}
        kind="screen-recording"
        refresh={refresh}
        required
      />
      <PermissionRow
        icon={<IconKey size={16} />}
        title="Универсальный доступ"
        hint="Чтобы глобальные хоткеи работали в любом приложении."
        state={perms?.accessibility}
        kind="accessibility"
        refresh={refresh}
        required
      />
      <PermissionRow
        icon={<IconMic size={16} />}
        title="Микрофон"
        hint="Опционально — для голосового ввода."
        state={perms?.microphone}
        kind="microphone"
        refresh={refresh}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: 'var(--d9-ink-ghost)',
            letterSpacing: '-0.005em',
          }}
        >
          Можно выдать позже — в Настройках.
        </span>
        <Button variant="primary" onClick={onNext}>
          Далее
        </Button>
      </div>
    </div>
  );
}

function PermissionRow({
  icon,
  title,
  hint,
  state,
  kind,
  refresh,
  required,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  state: PermissionState[keyof PermissionState] | undefined;
  kind: PermissionKind;
  refresh: () => Promise<void>;
  required?: boolean;
}) {
  const granted = state === 'granted';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 16px',
        background: 'var(--d9-slate)',
        border: '1px solid var(--d9-hairline)',
        borderRadius: 10,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: granted ? 'rgba(52, 199, 89, 0.12)' : 'var(--d9-accent-glow)',
          color: granted ? 'var(--d9-ok)' : 'var(--d9-accent)',
          flexShrink: 0,
        }}
      >
        {granted ? <IconCheck size={16} /> : icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
          {title}
          {!required && (
            <span style={{ fontSize: 10, color: 'var(--d9-ink-mute)', fontFamily: 'var(--d9-font-mono)' }}>
              опционально
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--d9-ink-mute)', marginTop: 2 }}>{hint}</div>
      </div>
      {granted ? (
        <StatusDot state="ready" size={8} />
      ) : (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Показываем Рестарт для screen-recording и accessibility —
              оба кэшируются TCC на время жизни процесса. */}
          {(kind === 'screen-recording' || kind === 'accessibility') && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void window.druz9.app.quit()}
              title="Если разрешение уже дано — macOS требует рестарт процесса чтобы увидеть новое состояние"
            >
              Рестарт
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await window.druz9.permissions.request(kind);
              await window.druz9.permissions.openSettings(kind);
              void refresh();
            }}
          >
            Разрешить
          </Button>
        </div>
      )}
    </div>
  );
}

function LoginStep() {
  // State machine for the login flow, mirroring the frontend (see
  // frontend/src/pages/LoginPage.tsx):
  //   idle → starting → waiting (polling) → done
  //                   └→ error
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'starting' }
    | { kind: 'waiting'; code: string; deepLink: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // When the user chooses "Log in", main does the start + we call await.
  // Pressing "Restart" cancels the in-flight poll and reruns start.
  useEffect(() => {
    if (state.kind !== 'waiting') return;
    let cancelled = false;
    void (async () => {
      try {
        await window.druz9.auth.loginTelegramAwait();
        // Onboarding watches the auth store for isNewUser === true via
        // the event:auth-changed push; this component just waits for
        // the outer effect to move to 'done'.
        if (!cancelled) {
          /* success — parent effect handles transition */
        }
      } catch (err) {
        if (!cancelled) {
          setState({ kind: 'error', message: (err as Error).message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.kind === 'waiting' ? state.code : '']);

  const begin = async () => {
    setState({ kind: 'starting' });
    try {
      const r = await window.druz9.auth.loginTelegramStart();
      setState({ kind: 'waiting', code: r.code, deepLink: r.deepLink });
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  };

  const restart = async () => {
    await window.druz9.auth.loginTelegramCancel().catch(() => undefined);
    await begin();
  };

  if (state.kind === 'idle' || state.kind === 'starting') {
    return (
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <IconSparkles size={40} />
        <h2 style={{ fontSize: 22, margin: '16px 0 8px' }}>Вход в Druz9</h2>
        <p style={{ fontSize: 13, color: 'var(--d9-ink-dim)', lineHeight: 1.5, margin: '0 0 24px' }}>
          Откроем Telegram-бота. Жми в боте «Start» — мы узнаем об этом и
          продолжим сами.
        </p>
        <Button variant="primary" disabled={state.kind === 'starting'} onClick={() => void begin()}>
          {state.kind === 'starting' ? 'Готовим…' : 'Войти через Telegram'}
        </Button>
      </div>
    );
  }

  if (state.kind === 'waiting') {
    return (
      <div style={{ textAlign: 'center', maxWidth: 460 }}>
        <IconSparkles size={40} />
        <h2 style={{ fontSize: 22, margin: '16px 0 8px' }}>Подтверди вход в Telegram</h2>
        <p style={{ fontSize: 13, color: 'var(--d9-ink-dim)', lineHeight: 1.5, margin: '0 0 20px' }}>
          Мы открыли бота в браузере. Жми{' '}
          <span style={{ fontFamily: 'var(--d9-font-mono)', color: 'var(--d9-ink)' }}>/start</span>{' '}
          там. Этот код должен совпасть с тем, что бот отправит тебе:
        </p>

        {/* Big code display — purely advisory so users can verify they're
            talking to the right bot. No copy/paste required; backend already
            knows this code belongs to our session. */}
        <div
          style={{
            display: 'inline-flex',
            padding: '10px 18px',
            background: 'var(--d9-accent-glow)',
            border: '1px solid var(--d9-hairline)',
            borderRadius: 10,
            fontFamily: 'var(--d9-font-mono)',
            fontSize: 22,
            letterSpacing: 4,
            color: 'var(--d9-ink)',
          }}
        >
          {state.code}
        </div>

        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center', gap: 8 }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void window.druz9.shell.openExternal(state.deepLink)}
          >
            Открыть бот ещё раз
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void restart()}>
            Новый код
          </Button>
        </div>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, color: 'var(--d9-ink-mute)' }}>
          <StatusDot state="thinking" size={6} />
          <span>ждём подтверждения в Telegram…</span>
        </div>
      </div>
    );
  }

  // error
  return (
    <div style={{ textAlign: 'center', maxWidth: 420 }}>
      <h2 style={{ fontSize: 20, margin: '0 0 8px', color: 'var(--d9-err)' }}>
        Не получилось войти
      </h2>
      <p style={{ fontSize: 13, color: 'var(--d9-ink-dim)', margin: '0 0 18px' }}>
        {humanizeError(state.message)}
      </p>
      <Button variant="primary" onClick={() => void restart()}>
        Попробовать снова
      </Button>
    </div>
  );
}

function humanizeError(m: string): string {
  if (m === 'code_expired') return 'Код устарел — запросим новый.';
  if (m.startsWith('rate_limited')) return 'Слишком много попыток. Попробуй через минуту.';
  if (m === 'aborted') return 'Вход отменён.';
  return m.slice(0, 160);
}

function DoneStep() {
  return (
    <div style={{ textAlign: 'center', maxWidth: 440 }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: 'rgba(52, 199, 89, 0.14)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--d9-ok)',
        }}
      >
        <IconCheck size={28} />
      </div>
      <h2 style={{ fontSize: 22, margin: '16px 0 8px' }}>Всё готово</h2>
      <p style={{ fontSize: 13, color: 'var(--d9-ink-dim)', lineHeight: 1.5, margin: '0 0 18px' }}>
        Нажми <Kbd size="sm">CommandOrControl+Shift+S</Kbd>, чтобы задать свой первый вопрос по скриншоту.
      </p>
      <Button variant="primary" onClick={() => void window.druz9.windows.hide('onboarding')}>
        Закрыть
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

// openTelegramLogin was a stub for a deep-link callback flow. The real
// flow lives in auth.loginTelegramStart / loginTelegramAwait IPC — see
// main/auth/telegram-code.ts. The OnboardingScreen's LoginStep calls
// those directly above.
