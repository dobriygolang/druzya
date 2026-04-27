// TrayScreen — custom HTML tray dropdown.
// All actions route through the same IPC APIs as app buttons/hotkeys.

import { useEffect, useState } from 'react';

const trayStyle = `
@keyframes d9-tray-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
.d9-tray-item {
  outline: none;
}
.d9-tray-item:hover,
.d9-tray-item:focus-visible {
  background: #0a84ff !important;
  color: #ffffff !important;
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
        if (sessionLive) {
          await window.druz9.sessions.end();
          setSessionLive(false);
        } else {
          await window.druz9.sessions.start('interview');
          setSessionLive(true);
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
        background: 'rgba(20,20,22,0.94)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.13)',
        borderRadius: 8,
        padding: '0 0 6px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro', sans-serif",
        animation: 'd9-tray-in 0.15s ease-out both',
      }}
    >
      <div
        style={{
          height: 34,
          padding: '0 14px',
          fontSize: 12,
          color: 'rgba(255,255,255,0.50)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <PrototypeMark />
        <span>CUE · v0.8.1</span>
      </div>

      <TrayGroup items={QUICK} onAction={doAction} />
      <TrayDivider />
      <TrayGroup
        items={[{
          label: sessionLive ? 'End interview session' : 'Start interview session',
          action: 'session',
        }]}
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
            height: 27,
            padding: '0 14px',
            fontSize: 13,
            color: 'var(--d9-ink)',
            background: 'transparent',
            border: 0,
            textAlign: 'left',
            cursor: 'pointer',
            fontFamily: 'inherit',
            letterSpacing: 0,
            transition: 'background 80ms, color 80ms',
          }}
        >
          <span style={{ flex: 1 }}>{item.label}</span>
          {item.kbd && (
            <span style={{ fontSize: 12, color: 'inherit', opacity: 0.55, marginLeft: 8 }}>
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
      <path
        d="M11 3.5A4.5 4.5 0 1 0 11 10.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="7" cy="7" r="1" fill="#0a84ff" />
    </svg>
  );
}

function TrayDivider() {
  return (
    <div
      style={{
        height: 1,
        background: 'rgba(255,255,255,0.08)',
        margin: '5px 0',
      }}
    />
  );
}
