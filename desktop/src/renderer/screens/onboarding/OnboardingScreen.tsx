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
  BrandMark,
  IconCheck,
  IconKey,
  IconMic,
  IconShield,
  IconSparkles,
} from '../../components/icons';
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
    if (step === 'permissions') {
      void refreshPerms();
      const h = setInterval(refreshPerms, 1500);
      const onFocus = () => void refreshPerms();
      window.addEventListener('focus', onFocus);
      return () => {
        clearInterval(h);
        window.removeEventListener('focus', onFocus);
      };
    }
  }, [step]);

  // Move past login automatically once session appears.
  useEffect(() => {
    if (step === 'login' && session) setStep('done');
  }, [step, session]);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--d-bg-0)',
        color: 'var(--d-text)',
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
            background: i <= idx ? 'var(--d-accent)' : 'var(--d-line-strong)',
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
      <h1 style={{ fontSize: 28, margin: '20px 0 8px', fontFamily: 'var(--f-display)' }}>
        Druz9 Copilot
      </h1>
      <p style={{ fontSize: 14, color: 'var(--d-text-2)', lineHeight: 1.5, margin: '0 0 28px' }}>
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
  const all = perms?.screenRecording === 'granted' && perms?.accessibility === 'granted';
  return (
    <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, margin: '0 0 6px' }}>Разрешения macOS</h2>
        <p style={{ fontSize: 13, color: 'var(--d-text-2)', margin: 0 }}>
          Без них приложение не сможет работать полноценно.
        </p>
      </div>

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

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <Button variant="primary" onClick={onNext} disabled={!all}>
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
        background: 'var(--d-bg-2)',
        border: '1px solid var(--d-line)',
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
          background: granted ? 'rgba(52, 199, 89, 0.12)' : 'var(--d-accent-soft)',
          color: granted ? 'var(--d-green)' : 'var(--d-accent)',
          flexShrink: 0,
        }}
      >
        {granted ? <IconCheck size={16} /> : icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
          {title}
          {!required && (
            <span style={{ fontSize: 10, color: 'var(--d-text-3)', fontFamily: 'var(--f-mono)' }}>
              опционально
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--d-text-3)', marginTop: 2 }}>{hint}</div>
      </div>
      {granted ? (
        <StatusDot state="ready" size={8} />
      ) : (
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
      )}
    </div>
  );
}

function LoginStep() {
  const [waiting, setWaiting] = useState(false);
  return (
    <div style={{ textAlign: 'center', maxWidth: 420 }}>
      <IconSparkles size={40} />
      <h2 style={{ fontSize: 22, margin: '16px 0 8px' }}>Вход в Druz9</h2>
      <p style={{ fontSize: 13, color: 'var(--d-text-2)', lineHeight: 1.5, margin: '0 0 24px' }}>
        Мы откроем браузер с Telegram-логином. После подтверждения вернёмся сюда автоматически.
      </p>
      <Button
        variant="primary"
        onClick={async () => {
          setWaiting(true);
          // Main opens the browser to the Telegram widget; the deep-link
          // handler pushes the session via event:auth-changed and we
          // move on automatically (see effect in OnboardingScreen).
          await openTelegramLogin();
        }}
      >
        {waiting ? 'Ждём подтверждения…' : 'Войти через Telegram'}
      </Button>
    </div>
  );
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
          color: 'var(--d-green)',
        }}
      >
        <IconCheck size={28} />
      </div>
      <h2 style={{ fontSize: 22, margin: '16px 0 8px' }}>Всё готово</h2>
      <p style={{ fontSize: 13, color: 'var(--d-text-2)', lineHeight: 1.5, margin: '0 0 18px' }}>
        Нажми <Kbd size="sm">CommandOrControl+Shift+S</Kbd>, чтобы задать свой первый вопрос по скриншоту.
      </p>
      <Button variant="primary" onClick={() => void window.druz9.windows.hide('onboarding')}>
        Закрыть
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

async function openTelegramLogin(): Promise<void> {
  // Main process owns the URL; exposing a dedicated IPC method for this
  // would be cleaner but for MVP we piggyback on `permissions.openSettings`
  // style — the real URL comes from DesktopConfig in a future revision.
  // Placeholder: just wait for the deep-link callback from an external flow.
  await new Promise((r) => setTimeout(r, 0));
}
