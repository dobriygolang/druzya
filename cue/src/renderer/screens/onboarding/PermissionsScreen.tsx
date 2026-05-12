// Step 2 — Permissions pre-prompt (C1).
//
// This is the screen that stops 30-50% of users from denying TCC dialogs
// they didn't expect. macOS's native prompt is one line of un-styled
// system copy + Allow/Deny — without context, "Cue wants to record
// your screen" reads like spyware. We solve that by:
//
//   1. Showing three permission CARDS up-front with their actual use
//      case in plain Russian: "чтобы видеть код собеседника", not
//      "Screen Recording access required".
//   2. Inlining a tiny SVG glyph that hints at WHAT the permission
//      unlocks (screenshot, microphone, hotkey).
//   3. Triggering the OS prompts sequentially only AFTER the user
//      clicks "Разрешить доступы". By that point they've already
//      consented to the spirit of the request; the system dialogs
//      are confirmation.
//   4. Re-prompting via the system Settings deep-link when a previous
//      run denied — macOS never re-fires the TCC prompt for a denied
//      bundle, so deep-linking to Privacy → Screen Recording is the
//      only path back.
//
// We do NOT block the user from advancing without granting everything.
// Microphone is optional; Screen Recording / Accessibility get a "позже"
// affordance that bumps them to the next step but leaves the cards
// re-grantable from Settings → Доступы macOS.

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  IconCheck,
  IconKey,
  IconMic,
  IconShield,
} from '../../components/icons';
import { Button } from '../../components/primitives';
import type { PermissionKind, PermissionState } from '@shared/ipc';

type PermStatus = 'granted' | 'denied' | 'not-determined';

interface PermDescriptor {
  kind: PermissionKind;
  title: string;
  why: string;
  icon: React.ReactNode;
  required: boolean;
  /** Inlined sample sketch — illustrates what the permission unlocks
   *  without leaking real screenshots. SVG + B/W only. */
  preview: React.ReactNode;
}

const PERMISSIONS: ReadonlyArray<PermDescriptor> = [
  {
    kind: 'screen-recording',
    title: 'Запись экрана',
    why: 'Чтобы видеть код собеседника и задачу на экране — для скриншот-вопросов и live-чтения IDE.',
    icon: <IconShield size={18} />,
    required: true,
    preview: <ScreenshotPreview />,
  },
  {
    kind: 'microphone',
    title: 'Микрофон',
    why: 'Чтобы слышать ваш голос и собеседника — для live-транскрипта и auto-suggest на встречах.',
    icon: <IconMic size={18} />,
    required: false,
    preview: <MicPreview />,
  },
  {
    kind: 'accessibility',
    title: 'Универсальный доступ',
    why: 'Чтобы глобальные хоткеи ⌘⇧Space / ⌘⇧S работали поверх IDE, Zoom и любого приложения.',
    icon: <IconKey size={18} />,
    required: true,
    preview: <HotkeyPreview />,
  },
];

interface Props {
  onNext: () => void;
  onBack: () => void;
}

export function PermissionsScreen({ onNext, onBack }: Props) {
  const [perms, setPerms] = useState<PermissionState | null>(null);
  const [granting, setGranting] = useState(false);

  // Poll System Settings on focus so the cards reflect the user's
  // toggle flips without requiring a wizard restart. 1.5s background
  // poll matches the old single-file wizard cadence.
  const refresh = useCallback(async () => {
    try {
      setPerms(await window.druz9.permissions.check());
    } catch {
      // Non-darwin → permissions API returns all 'granted'; nothing to
      // render. Renderer-side errors just leave the previous snapshot.
    }
  }, []);
  useEffect(() => {
    void refresh();
    const h = setInterval(refresh, 1500);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(h);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const statusFor = (kind: PermissionKind): PermStatus => {
    if (!perms) return 'not-determined';
    if (kind === 'screen-recording') return perms.screenRecording;
    if (kind === 'microphone') return perms.microphone;
    return perms.accessibility;
  };

  const allGranted = useMemo(() => {
    if (!perms) return false;
    // Microphone is optional. Required = screen-recording + accessibility.
    return perms.screenRecording === 'granted' && perms.accessibility === 'granted';
  }, [perms]);

  const anyDenied = useMemo(() => {
    if (!perms) return false;
    return (
      perms.screenRecording === 'denied' ||
      perms.accessibility === 'denied' ||
      perms.microphone === 'denied'
    );
  }, [perms]);

  // Sequential triggering. We deliberately do NOT Promise.all here —
  // macOS shows one system dialog at a time anyway, and a serial flow
  // gives the user a moment to read each prompt. Mic first because
  // its dialog is the least scary ("microphone access"), then Screen
  // Recording (most scary — usually the abandonment point), then
  // Accessibility (requires manual toggle in Settings, no prompt).
  const grantAll = async () => {
    setGranting(true);
    try {
      // Refresh before each ask — user might've granted between cards
      // in a previous session.
      await refresh();

      if (statusFor('microphone') !== 'granted' && statusFor('microphone') !== 'denied') {
        await window.druz9.permissions.request('microphone');
      }
      await refresh();

      if (
        statusFor('screen-recording') !== 'granted' &&
        statusFor('screen-recording') !== 'denied'
      ) {
        await window.druz9.permissions.request('screen-recording');
      }
      await refresh();

      if (statusFor('accessibility') !== 'granted') {
        // Accessibility never prompts via API; it always requires the
        // user to toggle Cue in System Settings. Calling request with
        // `true` pops the macOS "is requesting access" dialog with an
        // "Open System Settings" button.
        await window.druz9.permissions.request('accessibility');
      }
      await refresh();
    } finally {
      setGranting(false);
    }
  };

  // Re-prompt path: if any permission is in 'denied' state, the macOS
  // TCC prompt will not re-appear. Surface the Settings deep-link with
  // a clear explanation.
  const reopenSettings = (kind: PermissionKind) => {
    void window.druz9.permissions.openSettings(kind);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 16,
        padding: '12px 28px 4px',
        width: '100%',
        maxWidth: 640,
        minWidth: 0,
      }}
    >
      <header style={{ textAlign: 'center', marginBottom: 4 }}>
        <h2
          style={{
            fontFamily: 'var(--d9-font-sans)',
            fontWeight: 700,
            fontSize: 22,
            margin: '0 0 8px',
            letterSpacing: '-0.018em',
            color: 'var(--d9-ink)',
          }}
        >
          Доступы macOS
        </h2>
        <p
          style={{
            fontSize: 12.5,
            lineHeight: 1.5,
            color: 'var(--d9-ink-mute)',
            margin: 0,
            letterSpacing: '-0.005em',
          }}
        >
          Объясняем заранее, зачем каждое разрешение. Нажми «Разрешить
          доступы» — macOS покажет системные диалоги по очереди.
        </p>
      </header>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minWidth: 0,
        }}
      >
        {PERMISSIONS.map((p) => (
          <PermissionCard
            key={p.kind}
            descriptor={p}
            status={statusFor(p.kind)}
            onReopenSettings={() => reopenSettings(p.kind)}
          />
        ))}
      </div>

      {/* Re-prompt banner — only when at least one permission is in the
          terminal 'denied' state. Acts as the "fix this" affordance for
          the user who said no to a prompt and now needs to fix it. */}
      {anyDenied && (
        <div
          role="note"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid var(--d9-hairline-b)',
            fontSize: 11.5,
            lineHeight: 1.5,
            color: 'var(--d9-ink-dim)',
            background: 'transparent',
          }}
        >
          {/* Red 1.5px signal stripe — the only allowed red surface here */}
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 1.5,
              minHeight: 32,
              background: 'var(--d9-accent)',
              flex: '0 0 auto',
              marginTop: 2,
            }}
          />
          <span>
            <b style={{ color: 'var(--d9-ink)' }}>
              Macy отказал в системном диалоге?
            </b>{' '}
            macOS никогда не покажет этот диалог снова — открой Системные
            настройки и включи Cue вручную в каждом разделе.
          </span>
        </div>
      )}

      <footer
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginTop: 6,
          flexWrap: 'wrap',
        }}
      >
        <Button variant="ghost" size="sm" onClick={onBack}>
          Назад
        </Button>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            onClick={onNext}
            style={{
              background: 'transparent',
              border: 0,
              color: 'var(--d9-ink-ghost)',
              fontSize: 11,
              fontFamily: 'var(--d9-font-mono)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              padding: '6px 4px',
            }}
            title="Можно выдать позже через Настройки → Доступы macOS"
          >
            позже
          </button>

          {allGranted ? (
            <Button variant="primary" size="md" onClick={onNext}>
              Далее
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={() => void grantAll()}
              disabled={granting}
            >
              {granting ? 'Запрашиваем…' : 'Разрешить доступы'}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PermissionCard — one row per permission. Compact horizontal layout so
// all three fit on a 720×560 wizard without scroll.
// ─────────────────────────────────────────────────────────────────────────

function PermissionCard({
  descriptor,
  status,
  onReopenSettings,
}: {
  descriptor: PermDescriptor;
  status: PermStatus;
  onReopenSettings: () => void;
}) {
  const granted = status === 'granted';
  const denied = status === 'denied';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 14,
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid var(--d9-hairline-b)',
        background: granted ? 'rgba(255, 255, 255, 0.02)' : 'transparent',
        minWidth: 0,
        transition:
          'background var(--motion-dur-small, 160ms) var(--motion-ease-standard, cubic-bezier(.2,.7,.2,1)), border-color var(--motion-dur-small, 160ms) var(--motion-ease-standard, cubic-bezier(.2,.7,.2,1))',
      }}
    >
      {/* Icon + status badge — left rail, fixed 32px square */}
      <div
        aria-hidden="true"
        style={{
          flex: '0 0 auto',
          width: 36,
          height: 36,
          borderRadius: 9,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: granted ? 'var(--d9-ink)' : 'transparent',
          color: granted ? 'var(--d9-obsidian)' : 'var(--d9-ink)',
          border: granted ? 0 : '1px solid var(--d9-hairline-b)',
        }}
      >
        {granted ? <IconCheck size={18} /> : descriptor.icon}
      </div>

      {/* Copy column */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--d9-ink)',
              letterSpacing: '-0.005em',
            }}
          >
            {descriptor.title}
          </span>
          {!descriptor.required && (
            <span
              style={{
                fontSize: 9.5,
                fontFamily: 'var(--d9-font-mono)',
                color: 'var(--d9-ink-ghost)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              опционально
            </span>
          )}
          {granted && (
            <span
              style={{
                fontSize: 9.5,
                fontFamily: 'var(--d9-font-mono)',
                color: 'var(--d9-ink-dim)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              разрешено
            </span>
          )}
        </div>
        <span
          style={{
            fontSize: 11.5,
            lineHeight: 1.45,
            color: 'var(--d9-ink-mute)',
            letterSpacing: '-0.005em',
          }}
        >
          {descriptor.why}
        </span>
        {denied && (
          <button
            type="button"
            onClick={onReopenSettings}
            className="d9-row-hover"
            style={{
              alignSelf: 'flex-start',
              marginTop: 4,
              padding: '3px 8px',
              fontSize: 10.5,
              fontFamily: 'var(--d9-font-mono)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: 'transparent',
              color: 'var(--d9-ink-dim)',
              border: '1px solid var(--d9-hairline-b)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            ↗ Открыть Системные настройки
          </button>
        )}
      </div>

      {/* Preview sketch — fixed-width column on the right. Hides on
          narrow displays via flex-basis 0 + collapses when min-content
          forces it out. */}
      <div
        aria-hidden="true"
        style={{
          flex: '0 1 96px',
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.85,
        }}
      >
        {descriptor.preview}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Preview SVGs — monochrome 1.5px stroke sketches that hint at what
// the permission unlocks. NOT photographic mockups (that would require
// real screenshots → noisy on a B/W canvas). NOT vendor logos.
// ─────────────────────────────────────────────────────────────────────────

function ScreenshotPreview() {
  // Tiny dashed selection-rect over a window mockup. Reads as "we'll
  // take screenshots of YOUR screen for AI questions".
  return (
    <svg
      width="84"
      height="56"
      viewBox="0 0 84 56"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--d9-ink-mute)' }}
    >
      <rect x="4" y="6" width="76" height="44" rx="4" />
      <path d="M4 14h76" />
      <circle cx="9" cy="10" r="0.8" fill="currentColor" />
      <circle cx="13" cy="10" r="0.8" fill="currentColor" />
      <circle cx="17" cy="10" r="0.8" fill="currentColor" />
      {/* Selection rect */}
      <rect
        x="22"
        y="22"
        width="36"
        height="20"
        rx="2"
        strokeDasharray="2.5 2"
        style={{ color: 'var(--d9-ink)' }}
        stroke="currentColor"
      />
    </svg>
  );
}

function MicPreview() {
  // Microphone with voice waveform — reads as "we'll listen to you".
  return (
    <svg
      width="84"
      height="56"
      viewBox="0 0 84 56"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--d9-ink-mute)' }}
    >
      <rect x="34" y="10" width="16" height="24" rx="8" />
      <path d="M28 26a14 14 0 0 0 28 0M42 38v8" />
      {/* Waveform on the right */}
      <path d="M60 18v20M64 22v12M68 26v4M72 20v16M76 24v8" style={{ color: 'var(--d9-ink)' }} stroke="currentColor" />
    </svg>
  );
}

function HotkeyPreview() {
  // Three keycaps with ⌘⇧S — reads as "global hotkeys".
  return (
    <svg
      width="84"
      height="56"
      viewBox="0 0 84 56"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--d9-ink-mute)' }}
    >
      <rect x="6" y="20" width="20" height="20" rx="4" />
      <rect x="32" y="20" width="20" height="20" rx="4" />
      <rect x="58" y="20" width="20" height="20" rx="4" />
      <text
        x="16"
        y="34"
        fontSize="11"
        fontFamily="var(--d9-font-mono)"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        style={{ color: 'var(--d9-ink)' }}
      >
        ⌘
      </text>
      <text
        x="42"
        y="34"
        fontSize="11"
        fontFamily="var(--d9-font-mono)"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        style={{ color: 'var(--d9-ink)' }}
      >
        ⇧
      </text>
      <text
        x="68"
        y="34"
        fontSize="11"
        fontFamily="var(--d9-font-mono)"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        style={{ color: 'var(--d9-ink)' }}
      >
        S
      </text>
    </svg>
  );
}
