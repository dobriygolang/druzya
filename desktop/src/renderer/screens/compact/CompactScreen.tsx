// Compact floating window — the app's always-on entry point.
// Two rows: input + status. Dragging is enabled on the main frame (via
// WebkitAppRegion) but disabled on interactive controls.
//
// Hotkey wiring: listens for 'event:hotkey-fired' from main and routes
// screenshot / toggle-window / quick-prompt actions through this window.

import { useEffect, useRef, useState } from 'react';

import { BrandMark, IconCamera, IconMic, IconSettings } from '../../components/icons';
import { IconButton, Kbd, StatusDot } from '../../components/primitives';
import { useConfig } from '../../hooks/use-config';
import { useHotkeyEvents } from '../../hooks/use-hotkey-events';
import { useAuthStore } from '../../stores/auth';
import { useConversationStore } from '../../stores/conversation';

export function CompactScreen() {
  const { config } = useConfig();
  const session = useAuthStore((s) => s.session);
  const authBootstrap = useAuthStore((s) => s.bootstrap);
  const conversationBootstrap = useConversationStore((s) => s.bootstrap);
  const streaming = useConversationStore((s) => s.streaming);
  const beginTurn = useConversationStore((s) => s.beginTurn);

  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'ready' | 'thinking' | 'recording'>('ready');
  const [statusText, setStatusText] = useState('Готов');
  const inputRef = useRef<HTMLInputElement>(null);

  // One-time wiring.
  useEffect(() => {
    const unsubAuth = authBootstrap();
    const unsubConv = conversationBootstrap();
    return () => {
      unsubAuth();
      unsubConv();
    };
  }, [authBootstrap, conversationBootstrap]);

  // Streaming → local status dot.
  useEffect(() => {
    if (streaming) {
      setStatus('thinking');
      setStatusText(`${modelLabel(config?.defaultModelId, config)} · думает…`);
    } else {
      setStatus('ready');
      setStatusText(session ? 'Готов' : 'Нужен вход');
    }
  }, [streaming, session, config]);

  useHotkeyEvents(async (action) => {
    if (action === 'screenshot_area' || action === 'screenshot_full') {
      void triggerScreenshot(action, input, setInput);
    } else if (action === 'quick_prompt') {
      inputRef.current?.focus();
    } else if (action === 'toggle_window') {
      void window.druz9.windows.show('expanded');
    }
  });

  const submitText = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    const handle = await window.druz9.analyze.start({
      conversationId: useConversationStore.getState().conversationId,
      promptText: text,
      model: '',
      attachments: [],
      triggerAction: 'quick_prompt',
      focusedAppHint: '',
    });
    beginTurn({ promptText: text, hasScreenshot: false, streamId: handle.streamId });
    void window.druz9.windows.show('expanded');
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--d-bg-1)',
        border: '1px solid var(--d-line)',
        borderRadius: 'var(--r-window)',
        boxShadow: 'var(--s-window)',
        // Drag-by-background; inputs/buttons opt out below.
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Row 1 — input */}
      <div
        style={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px 0 12px',
          gap: 10,
        }}
      >
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <BrandMark size={28} />
          <div
            style={{
              position: 'absolute',
              right: -2,
              bottom: -2,
              width: 10,
              height: 10,
              borderRadius: 5,
              border: '2px solid var(--d-bg-1)',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <StatusDot state={status} size={6} />
          </div>
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 32,
            padding: '0 10px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--d-line)',
            borderRadius: 'var(--r-inner)',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submitText();
              }
            }}
            placeholder="Сообщение или вопрос…"
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              color: 'var(--d-text)',
              fontSize: 13,
              outline: 'none',
            }}
          />
          <Kbd size="sm">Enter</Kbd>
        </div>

        <div style={{ display: 'flex', gap: 2, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <IconButton
            title="Скриншот области (⌘⇧S)"
            onClick={() => void triggerScreenshot('screenshot_area', input, setInput)}
          >
            <IconCamera size={15} />
          </IconButton>
          <IconButton title="Голос (⌘⇧V)" disabled>
            <IconMic size={15} />
          </IconButton>
          <IconButton
            title="Настройки"
            onClick={() => void window.druz9.windows.show('settings')}
          >
            <IconSettings size={15} />
          </IconButton>
        </div>
      </div>

      {/* Row 2 — status */}
      <div
        style={{
          height: 24,
          borderTop: '1px solid var(--d-line)',
          padding: '0 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 10.5,
          color: 'var(--d-text-3)',
          fontFamily: 'var(--f-mono)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StatusDot state={status} size={5} />
          <span>{statusText}</span>
        </div>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Kbd size="sm">CommandOrControl+Shift+D</Kbd>
          <span style={{ opacity: 0.6 }}>развернуть</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

async function triggerScreenshot(
  action: 'screenshot_area' | 'screenshot_full',
  promptText: string,
  setInput: (s: string) => void,
): Promise<void> {
  try {
    const shot =
      action === 'screenshot_full'
        ? await window.druz9.capture.screenshotFull()
        : await window.druz9.capture.screenshotFull(); // area UX is a Phase 4.x addition
    const handle = await window.druz9.analyze.start({
      conversationId: '',
      promptText,
      model: '',
      attachments: [
        {
          kind: 'screenshot',
          dataBase64: shot.dataBase64,
          mimeType: shot.mimeType,
          width: shot.width,
          height: shot.height,
        },
      ],
      triggerAction: action,
      focusedAppHint: '',
    });
    useConversationStore
      .getState()
      .beginTurn({ promptText, hasScreenshot: true, streamId: handle.streamId });
    setInput('');
    void window.druz9.windows.show('expanded');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('screenshot failed', err);
  }
}

function modelLabel(id: string | undefined, cfg: ReturnType<typeof useConfig>['config']): string {
  if (!id || !cfg) return 'AI';
  const m = cfg.models.find((x) => x.id === id);
  return m?.displayName ?? 'AI';
}
