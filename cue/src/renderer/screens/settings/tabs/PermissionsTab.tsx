// macOS permissions tab — same three permissions as onboarding plus
// onboarding re-entry affordances.

import { useEffect, useState } from 'react';

import { Button, StatusDot } from '../../../components/primitives';
import type { PermissionKind, PermissionState } from '@shared/ipc';
import { Row, SectionTitle } from '../lib/shared';

/**
 * PermissionsTab — same three macOS permissions as the onboarding step,
 * accessible post-onboarding from Settings. Users can skip the step on
 * first launch and come here when they actually need screenshots /
 * global hotkeys / voice input.
 */
export function PermissionsTab() {
  const [perms, setPerms] = useState<PermissionState | null>(null);

  const refresh = async () => {
    try {
      setPerms(await window.druz9.permissions.check());
    } catch {
      /* noop */
    }
  };

  useEffect(() => {
    void refresh();
    const h = setInterval(refresh, 1500);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(h);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const needsRestart =
    perms?.screenRecording !== 'granted' || perms?.accessibility !== 'granted';

  return (
    <>
      <SectionTitle
        title="Доступы macOS"
        subtitle="Выдать сейчас или позже — без них Cue всё равно работает, но часть функций недоступна."
      />

      {needsRestart && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 9,
            background: 'var(--d9-accent-glow)',
            border: '0.5px solid rgba(255, 59, 48, 0.35)',
            fontSize: 11.5,
            color: 'var(--d9-accent-hi)',
            letterSpacing: '-0.005em',
            lineHeight: 1.45,
            marginBottom: 14,
          }}
        >
          <b>Если переключатель уже включён, а доступа «нет»</b> — macOS кэширует
          статус до рестарта процесса. Включи тоггл в Системных настройках → нажми
          «Рестарт».
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <PermRow
          title="Запись экрана"
          hint="Чтобы делать скриншоты для AI."
          kind="screen-recording"
          state={perms?.screenRecording}
          refresh={refresh}
        />
        <PermRow
          title="Универсальный доступ"
          hint="Чтобы глобальные хоткеи работали в любом приложении."
          kind="accessibility"
          state={perms?.accessibility}
          refresh={refresh}
        />
        <PermRow
          title="Микрофон"
          hint="Опционально — для голосового ввода."
          kind="microphone"
          state={perms?.microphone}
          refresh={refresh}
        />
      </div>

      <OnboardingReentry />
    </>
  );
}

/**
 * OnboardingReentry — surfaces three re-run affordances for the wizard
 * we ship on first launch. Lives at the bottom of the Permissions tab
 * because that's the screen users land on when something feels broken
 * ("why is screen-record off?" → they're here → "let me re-run the
 * wizard with the demo").
 *
 *   • Re-run welcome flow      — wipe flag + open onboarding from
 *                                step one. Includes the stealth demo
 *                                + the permission cards.
 *   • Re-check permissions     — synchronous probe, surfaces toast
 *                                with current snapshot. Useful when
 *                                user just flipped a Settings toggle
 *                                and wants to confirm Cue saw it
 *                                without restarting.
 *   • Open System Preferences  — direct deep-link to the macOS
 *                                Privacy & Security pane.
 */
function OnboardingReentry() {
  const [busy, setBusy] = useState(false);
  const [lastProbeAt, setLastProbeAt] = useState<string>('');

  const onRerun = async () => {
    setBusy(true);
    try {
      await window.druz9.onboarding.reset();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[settings] onboarding.reset failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const onRecheck = async () => {
    setBusy(true);
    try {
      const p = await window.druz9.permissions.check();
      const ts = new Date().toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setLastProbeAt(`${ts} · screen=${p.screenRecording} · mic=${p.microphone} · a11y=${p.accessibility}`);
    } finally {
      setBusy(false);
    }
  };

  const onOpenPrivacy = () => {
    // Generic Privacy & Security root — user picks the specific pane
    // (Screen Recording / Accessibility / Microphone) from there.
    void window.druz9.shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy',
    );
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div
        style={{
          fontSize: 10,
          color: 'var(--d9-ink-ghost)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 12,
          fontFamily: 'var(--d9-font-mono)',
        }}
      >
        Онбординг
      </div>
      <Row
        title="Пройти онбординг снова"
        hint="Откроет приветственный wizard со скриншот-демо и пояснениями по доступам. Полезно когда хочется пересмотреть, что Cue невидим при демонстрации."
        control={
          <Button variant="secondary" size="sm" onClick={() => void onRerun()} disabled={busy}>
            Открыть wizard
          </Button>
        }
      />
      <Row
        title="Re-check доступов"
        hint={
          lastProbeAt
            ? `Последняя проверка: ${lastProbeAt}`
            : 'Сделать живой запрос к macOS TCC без рестарта приложения.'
        }
        control={
          <Button variant="ghost" size="sm" onClick={() => void onRecheck()} disabled={busy}>
            Проверить
          </Button>
        }
      />
      <Row
        title="Системные настройки"
        hint="Прямая ссылка на Privacy & Security в System Settings."
        control={
          <Button variant="ghost" size="sm" onClick={onOpenPrivacy}>
            Открыть
          </Button>
        }
      />
    </div>
  );
}

function PermRow({
  title,
  hint,
  kind,
  state,
  refresh,
}: {
  title: string;
  hint: string;
  kind: PermissionKind;
  state: PermissionState[keyof PermissionState] | undefined;
  refresh: () => Promise<void>;
}) {
  const granted = state === 'granted';
  return (
    <Row
      title={title}
      hint={hint}
      control={
        granted ? (
          <StatusDot state="ready" size={8} />
        ) : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {(kind === 'screen-recording' || kind === 'accessibility') && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void window.druz9.app.quit()}
                title="macOS кэширует статус до рестарта процесса"
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
        )
      }
    />
  );
}
