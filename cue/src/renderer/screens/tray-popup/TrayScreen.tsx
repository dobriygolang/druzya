// TrayScreen — custom HTML tray dropdown.
// All actions route through the same IPC APIs as app buttons/hotkeys.
//
// 2026-05-12: v2 visual language — hover blue (#0a84ff system blue)
// заменён на ink-ramp 8% tint (b/w rule). PrototypeMark inner circle —
// red signal dot (canonical accent) вместо системного синего.

import { useEffect, useState } from 'react';

// CSS injection — hover background uses ink-ramp 8% via --d9-hairline,
// the canonical white-alpha 8% token (b/w rule, see memory/feedback_color_rule.md).
const trayStyle = `
@keyframes d9-tray-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
.d9-tray-item {
  outline: none;
  position: relative;
}
.d9-tray-item:hover,
.d9-tray-item:focus-visible {
  background: var(--d9-hairline) !important;
  color: var(--d9-ink, #fff) !important;
}
/* Red signal stripe on active (focus-visible) state — 1.5px left edge.
   Per b/w rule, #FF3B30 is only ever a stripe/dot/single-stroke marker. */
.d9-tray-item:focus-visible::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 1.5px;
  background: var(--d9-accent);
  border-radius: 0 1px 1px 0;
}
`;

interface TrayItem {
  label: string;
  kbd?: string;
  action?: string;
}

const QUICK: TrayItem[] = [
  { label: 'Capture screenshot', kbd: '⇧⌘S', action: 'screenshot' },
  { label: 'Voice prompt', kbd: '⇧⌘V', action: 'voice' },
  { label: 'Freeze cursor', kbd: '⇧⌘Y', action: 'freeze' },
];

const OPEN: TrayItem[] = [
  { label: 'Open Cue', action: 'open' },
  { label: 'History', action: 'history' },
  { label: 'Preferences...', action: 'settings' },
];

const QUIT: TrayItem[] = [
  { label: 'Quit Cue', kbd: '⌘Q', action: 'quit' },
];

export function TrayScreen() {
  const [sessionLive, setSessionLive] = useState(false);
  const [version, setVersion] = useState('');

  useEffect(() => {
    const id = 'd9-tray-style';
    if (!document.getElementById(id)) {
      const el = document.createElement('style');
      el.id = id;
      el.textContent = trayStyle;
      document.head.appendChild(el);
    }
  }, []);

  useEffect(() => {
    void window.druz9.app.version().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    const onBlur = () => void window.druz9.windows.hide('tray-popup');
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  useEffect(() => {
    void window.druz9.sessions.current().then((session) => setSessionLive(Boolean(session)));
  }, []);

  const doAction = async (action?: string) => {
    await window.druz9.windows.hide('tray-popup');
    if (!action) return;

    switch (action) {
      case 'screenshot':
        await window.druz9.hotkeys.trigger('screenshot_area');
        break;
      case 'voice':
        await window.druz9.hotkeys.trigger('voice_input');
        break;
      case 'freeze':
        await window.druz9.hotkeys.trigger('cursor_freeze_toggle');
        break;
      case 'session':
        // CI1: wrap session start/end в try/catch + toast. Silent fail
        // здесь = юзер думает что сессия закрылась, а на бэке всё ещё
        // running (или vice-versa). Tray pop'ает + sessionLive optimistic
        // обновляется, на error катимся обратно.
        if (sessionLive) {
          try {
            await window.druz9.sessions.end();
            setSessionLive(false);
          } catch (err) {
            const msg = (err as Error)?.message || 'session end failed';
            void window.druz9.toast.show(`Cue: ${msg}`, 'error').catch(() => {});
          }
        } else {
          try {
            await window.druz9.sessions.start('interview');
            setSessionLive(true);
          } catch (err) {
            const msg = (err as Error)?.message || 'session start failed';
            void window.druz9.toast.show(`Cue: ${msg}`, 'error').catch(() => {});
          }
        }
        break;
      case 'open':
        await window.druz9.windows.show('compact');
        break;
      case 'history':
        await window.druz9.windows.show('history');
        break;
      case 'settings':
        await window.druz9.windows.show('settings');
        break;
      case 'quit':
        await window.druz9.app.quit();
        break;
    }
  };

  return (
    <div
      className="d9-root"
      style={{
        width: '100%',
        height: '100%',
        background: 'rgba(20, 20, 22, 0.94)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        border: '1px solid var(--d9-hairline-b)',
        borderRadius: 8,
        padding: '0 0 6px',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro', system-ui, sans-serif",
        animation: 'd9-tray-in var(--motion-dur-small) var(--motion-ease-decelerate) both',
      }}
    >
      <div
        style={{
          height: 34,
          padding: '0 14px',
          fontSize: 11,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontWeight: 500,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--d9-ink-mute)',
          borderBottom: '1px solid var(--d9-hairline)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--pad-inline)',
        }}
      >
        <PrototypeMark />
        <span>CUE{version ? ` · v${version}` : ''}</span>
        {sessionLive && (
          <span
            aria-hidden="true"
            className="red-pulse"
            style={{
              display: 'inline-block',
              width: 5,
              height: 5,
              borderRadius: 999,
              // canonical signal dot (b/w rule): #FF3B30 only for dot / 1.5px stripe / single stroke
              background: 'var(--d9-accent)',
              marginLeft: 'auto',
            }}
          />
        )}
      </div>

      <TrayGroup items={QUICK} onAction={doAction} />
      <TrayDivider />
      <TrayGroup
        items={[
          {
            label: sessionLive ? 'End interview session' : 'Start interview session',
            action: 'session',
          },
        ]}
        onAction={doAction}
      />
      <TrayDivider />
      <TrayGroup items={OPEN} onAction={doAction} />
      <TrayDivider />
      <TrayGroup items={QUIT} onAction={doAction} />
    </div>
  );
}

function TrayGroup({
  items,
  onAction,
}: {
  items: TrayItem[];
  onAction: (action?: string) => void;
}) {
  return (
    <>
      {items.map((item) => (
        <button
          key={item.label}
          className="d9-tray-item"
          type="button"
          onClick={() => onAction(item.action)}
          style={{
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            height: 28,
            padding: '0 14px',
            fontSize: 13,
            color: 'var(--d9-ink, #fff)',
            background: 'transparent',
            border: 0,
            textAlign: 'left',
            cursor: 'pointer',
            fontFamily: 'inherit',
            letterSpacing: '-0.005em',
            transition:
              'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
          {item.kbd && (
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
                color: 'var(--d9-ink-ghost)',
                marginLeft: 12,
                letterSpacing: '0.08em',
              }}
            >
              {item.kbd}
            </span>
          )}
        </button>
      ))}
    </>
  );
}

function PrototypeMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M11 3.5A4.5 4.5 0 1 0 11 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      {/* v2: inner dot uses canonical red accent (was system blue #0a84ff). */}
      <circle cx="7" cy="7" r="1" fill="var(--d9-accent)" />
    </svg>
  );
}

function TrayDivider() {
  return (
    <div
      style={{
        height: 1,
        background: 'var(--d9-hairline)',
        margin: '5px 0',
      }}
    />
  );
}
