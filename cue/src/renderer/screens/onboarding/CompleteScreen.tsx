// Step 4 — Complete. Hotkey reference + Get Started CTA.
//
// We deliberately lead with the hotkeys (not "you're set up!") because
// the user's first instinct after closing the wizard is to use the
// app. ⌘⇧Space is the master hotkey — every other entry point assumes
// the floating compact is open.
//
// IPC: onDone fires onboarding.complete in the orchestrator, which
// triggers main → markOnboardingCompleted + showWindow('compact') +
// hideWindow('onboarding'). The user blinks and finds themselves in
// the compact window with the brand mark in the top-right of their
// monitor.

import { IconCheck } from '../../components/icons';
import { Button, Kbd } from '../../components/primitives';

interface Props {
  onDone: () => void;
  onBack: () => void;
}

const HOTKEYS: ReadonlyArray<{ label: string; chord: string; note: string }> = [
  {
    label: 'Открыть / скрыть',
    chord: 'CommandOrControl+Shift+D',
    note: 'компактное окно поверх любого приложения',
  },
  {
    label: 'Скриншот области',
    chord: 'CommandOrControl+Shift+S',
    note: 'выдели прямоугольник → Cue задаст вопрос AI',
  },
  {
    label: 'Скриншот экрана',
    chord: 'CommandOrControl+Shift+A',
    note: 'весь дисплей → вопрос AI',
  },
  {
    label: 'Polish English',
    chord: 'CommandOrControl+Shift+L',
    note: 'правит текст из буфера обмена',
  },
  {
    label: 'Помочь сейчас',
    chord: 'CommandOrControl+Return',
    note: 'мгновенный chat-вход без выбора окна',
  },
];

export function CompleteScreen({ onDone, onBack }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 18,
        padding: '8px 28px 4px',
        width: '100%',
        maxWidth: 520,
        minWidth: 0,
      }}
    >
      <header style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'var(--d9-ink)',
            color: 'var(--d9-obsidian)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px',
          }}
        >
          <IconCheck size={28} />
        </div>
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
          Готово
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
          Запомни хоткеи — Cue работает из любого приложения.
        </p>
      </header>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 10,
          border: '1px solid var(--d9-hairline-b)',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        {HOTKEYS.map((h, i) => (
          <HotkeyRow key={h.chord} entry={h} divider={i < HOTKEYS.length - 1} />
        ))}
      </div>

      <p
        style={{
          fontSize: 11,
          lineHeight: 1.5,
          color: 'var(--d9-ink-ghost)',
          margin: 0,
          textAlign: 'center',
          letterSpacing: '-0.005em',
        }}
      >
        Все клавиши настраиваются в Settings → Горячие клавиши.
      </p>

      {/*
        Phase J / X1 (P0) — cross-promote Hone в самом конце onboarding'а.
        Subtle ghost-link, не CTA — Cue это самостоятельный продукт.
        druz9.online/hone — там же стоит download для macOS.
      */}
      <p
        style={{
          fontSize: 11,
          lineHeight: 1.5,
          color: 'var(--d9-ink-ghost)',
          margin: 0,
          textAlign: 'center',
          letterSpacing: '-0.005em',
        }}
      >
        Используешь Hone для daily focus?{' '}
        <a
          href="https://druz9.online/hone"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--d9-ink-mute)', textDecoration: 'underline' }}
        >
          druz9.online/hone
        </a>
      </p>

      <footer
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginTop: 2,
        }}
      >
        <Button variant="ghost" size="sm" onClick={onBack}>
          Назад
        </Button>
        <Button variant="primary" size="md" onClick={onDone} autoFocus>
          Начать работу
        </Button>
      </footer>
    </div>
  );
}

function HotkeyRow({
  entry,
  divider,
}: {
  entry: { label: string; chord: string; note: string };
  divider: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderBottom: divider ? '0.5px solid var(--d9-hairline)' : 'none',
        minWidth: 0,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontSize: 12.5,
            color: 'var(--d9-ink)',
            fontWeight: 500,
            letterSpacing: '-0.005em',
          }}
        >
          {entry.label}
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: 'var(--d9-ink-ghost)',
            letterSpacing: '-0.005em',
            lineHeight: 1.4,
          }}
        >
          {entry.note}
        </span>
      </div>
      <Kbd size="md">{entry.chord}</Kbd>
    </div>
  );
}
