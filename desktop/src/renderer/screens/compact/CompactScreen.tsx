// Compact floating window — the app's always-on entry point.
//
// Layout: a stack of up to three rows.
//   [optional] preview row — thumbnail of the pending screenshot +
//                            send / retake / discard actions.
//   input row — brand mark, prompt field, screenshot / voice / settings
//               buttons.
//   status row — model pill, "ready/thinking" dot, toggle-window hint.
//
// Screenshots are staged as a PendingAttachment before sending. The
// user can add text, retake, or discard — we only burn an Analyze call
// when they actually confirm. The compact window grows and shrinks via
// `windows.resize` so the preview fits without cramping the input.

import { useEffect, useRef, useState } from 'react';

import { BrandMark, IconCamera, IconChevronDown, IconClose, IconMinimize, IconSend, IconSettings } from '../../components/icons';
import { IconButton, Kbd, StatusDot } from '../../components/primitives';
import { VoiceButton } from '../../components/VoiceButton';
import { useConfig } from '../../hooks/use-config';
import { useHotkeyEvents } from '../../hooks/use-hotkey-events';
import { useAuthStore } from '../../stores/auth';
import { useConversationStore } from '../../stores/conversation';
import { useCursorFreezeStore } from '../../stores/cursor-freeze';
import { useSessionStore } from '../../stores/session';
import {
  usePendingAttachmentStore,
  type PendingAttachment,
} from '../../stores/pending-attachment';
import { useSelectedModelStore } from '../../stores/selected-model';

const COMPACT_BASE_WIDTH = 460;
const COMPACT_BASE_HEIGHT = 92;
const COMPACT_WITH_PREVIEW_WIDTH = 520;
const COMPACT_WITH_PREVIEW_HEIGHT = 180;

export function CompactScreen() {
  const { config } = useConfig();
  const session = useAuthStore((s) => s.session);
  const authBootstrap = useAuthStore((s) => s.bootstrap);
  const conversationBootstrap = useConversationStore((s) => s.bootstrap);
  const streaming = useConversationStore((s) => s.streaming);
  const beginTurn = useConversationStore((s) => s.beginTurn);

  const selectedModel = useSelectedModelStore((s) => s.modelId);
  const pending = usePendingAttachmentStore((s) => s.pending);
  const setPending = usePendingAttachmentStore((s) => s.set);
  const clearPending = usePendingAttachmentStore((s) => s.clear);
  const cursorState = useCursorFreezeStore((s) => s.state);
  const cursorBootstrap = useCursorFreezeStore((s) => s.bootstrap);
  const liveSession = useSessionStore((s) => s.current);
  const lastAnalysis = useSessionStore((s) => s.lastAnalysis);
  const sessionBootstrap = useSessionStore((s) => s.bootstrap);

  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'ready' | 'thinking' | 'recording'>('ready');
  const [statusText, setStatusText] = useState('Готов');
  // Model picker lives in expanded (compact is too small for the 440×520
  // modal). Clicking the model label in compact opens expanded and
  // signals via localStorage to pop the picker on mount.
  const [voiceToggleCount, setVoiceToggleCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auth + conversation + cursor + session store subscriptions.
  useEffect(() => {
    const unsubAuth = authBootstrap();
    const unsubConv = conversationBootstrap();
    const unsubCursor = cursorBootstrap();
    const unsubSession = sessionBootstrap();
    return () => {
      unsubAuth();
      unsubConv();
      unsubCursor();
      unsubSession();
    };
  }, [authBootstrap, conversationBootstrap, cursorBootstrap, sessionBootstrap]);

  // 1Hz tick so the "live session 12:34" label updates. Cheap — just a
  // state tick, no re-renders outside compact.
  const [, setTickTs] = useState(0);
  useEffect(() => {
    if (!liveSession) return;
    const t = setInterval(() => setTickTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [liveSession]);

  // Grow / shrink the window to accommodate the preview row. Works
  // whether the state change came from hotkey, click, or voice handoff.
  useEffect(() => {
    const [w, h] = pending
      ? [COMPACT_WITH_PREVIEW_WIDTH, COMPACT_WITH_PREVIEW_HEIGHT]
      : [COMPACT_BASE_WIDTH, COMPACT_BASE_HEIGHT];
    void window.druz9.windows.resize('compact', w, h);
  }, [pending]);

  const activeModelId = selectedModel || config?.defaultModelId || '';
  useEffect(() => {
    if (streaming) {
      setStatus('thinking');
      setStatusText(`${modelLabel(activeModelId, config)} · думает…`);
    } else {
      setStatus('ready');
      setStatusText(session ? 'Готов' : 'Нужен вход');
    }
  }, [streaming, session, config, activeModelId]);

  // Capture → INSTANT send. The input's current text (if any) rides
  // along as the prompt. Users who want to type first can do so — this
  // handler takes whatever's in the input at screenshot time. Users
  // who want to retake just hit ⌘⇧S again.
  const capture = async (kind: 'screenshot_area' | 'screenshot_full') => {
    try {
      const shot =
        kind === 'screenshot_full'
          ? await window.druz9.capture.screenshotFull()
          : await window.druz9.capture.screenshotArea();
      if (!shot) return;

      const text = input.trim();
      const conversationId = useConversationStore.getState().conversationId;
      const handle = await window.druz9.analyze.start({
        conversationId,
        promptText: text,
        model: selectedModel,
        attachments: [
          {
            kind: 'screenshot',
            dataBase64: shot.dataBase64,
            mimeType: shot.mimeType,
            width: shot.width,
            height: shot.height,
          },
        ],
        triggerAction: kind,
        focusedAppHint: '',
      });
      beginTurn({ promptText: text, hasScreenshot: true, streamId: handle.streamId });
      setInput('');
      clearPending();
      void window.druz9.windows.show('expanded');
    } catch (err) {
      setStatusText(`Ошибка: ${(err as Error).message.slice(0, 50)}`);
      // eslint-disable-next-line no-console
      console.error('screenshot failed', err);
    }
  };

  useHotkeyEvents(async (action) => {
    if (action === 'screenshot_area' || action === 'screenshot_full') {
      void capture(action);
    } else if (action === 'quick_prompt') {
      inputRef.current?.focus();
    } else if (action === 'toggle_window') {
      void window.druz9.windows.show('expanded');
    } else if (action === 'voice_input') {
      setVoiceToggleCount((c) => c + 1);
    }
  });

  const submit = async () => {
    const text = input.trim();
    if (streaming) return;
    if (!text && !pending) return;

    const attachments = pending
      ? [
          {
            kind: 'screenshot' as const,
            dataBase64: pending.dataBase64,
            mimeType: pending.mimeType,
            width: pending.width,
            height: pending.height,
          },
        ]
      : [];

    const conversationId = useConversationStore.getState().conversationId;
    const handle = await window.druz9.analyze.start({
      conversationId,
      promptText: text,
      model: selectedModel,
      attachments,
      triggerAction: pending ? 'screenshot_area' : 'quick_prompt',
      focusedAppHint: '',
    });
    beginTurn({ promptText: text, hasScreenshot: !!pending, streamId: handle.streamId });
    setInput('');
    clearPending();
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
        WebkitAppRegion: 'drag',
        overflow: 'hidden',
      } as React.CSSProperties}
    >
      {pending && (
        <PreviewRow
          pending={pending}
          onRetake={async () => {
            clearPending();
            await capture('screenshot_area');
          }}
          onDiscard={clearPending}
        />
      )}

      {/* Input row */}
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
                void submit();
              } else if (e.key === 'Escape' && pending) {
                e.preventDefault();
                clearPending();
              }
            }}
            placeholder={pending ? 'Добавь вопрос к скриншоту…' : 'Сообщение или вопрос…'}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              color: 'var(--d-text)',
              fontSize: 13,
              outline: 'none',
            }}
          />
          {pending ? (
            <IconButton title="Отправить (Enter)" onClick={() => void submit()}>
              <IconSend size={14} />
            </IconButton>
          ) : (
            <Kbd size="sm">Enter</Kbd>
          )}
        </div>

        <div style={{ display: 'flex', gap: 2, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <IconButton title="Скриншот области (⌘⇧S)" onClick={() => void capture('screenshot_area')}>
            <IconCamera size={15} />
          </IconButton>
          <VoiceButton
            onTranscript={(text) => setInput((prev) => (prev ? `${prev} ${text}` : text))}
            onError={(msg) => setStatusText(msg.slice(0, 60))}
            hotkeyToggle={voiceToggleCount}
          />
          <IconButton title="Настройки" onClick={() => void window.druz9.windows.show('settings')}>
            <IconSettings size={15} />
          </IconButton>

          {/* Window controls — visually separated from action icons by a
              thin divider, so users don't confuse "hide compact" with
              another feature button. */}
          <div
            style={{
              width: 1,
              height: 16,
              background: 'var(--d-line)',
              margin: '0 4px',
              alignSelf: 'center',
            }}
          />
          <WindowChromeButton
            title="Свернуть (⌘⇧D скроет/покажет)"
            onClick={() => void window.druz9.windows.hide('compact')}
          >
            <IconMinimize size={13} />
          </WindowChromeButton>
          <WindowChromeButton
            title="Закрыть приложение"
            danger
            onClick={() => {
              if (confirm('Закрыть Druz9 Copilot?\n\nПросто свернуть — ⌘⇧D или кнопка с чертой.')) {
                void window.druz9.app.quit();
              }
            }}
          >
            <IconClose size={13} />
          </WindowChromeButton>
        </div>
      </div>

      {/* Status row */}
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
          {cursorState === 'frozen' && (
            <span
              title="Курсор заморожен. ⌘⇧Y — разморозить"
              style={{
                marginLeft: 6,
                padding: '1px 6px',
                background: 'var(--d-accent-soft)',
                color: 'var(--d-accent)',
                borderRadius: 3,
                fontSize: 9.5,
                letterSpacing: 0.5,
              }}
            >
              CURSOR LOCK
            </span>
          )}
          {liveSession && (
            <span
              title={`Идёт сессия (${liveSession.kind}). Закончить — через трей.`}
              style={{
                marginLeft: 6,
                padding: '1px 6px',
                background: 'rgba(255, 69, 58, 0.15)',
                color: 'var(--d-red)',
                borderRadius: 3,
                fontSize: 9.5,
                letterSpacing: 0.5,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <StatusDot state="recording" size={5} />
              SESSION {formatElapsed(liveSession.startedAt)}
            </span>
          )}
          {!liveSession && lastAnalysis && (
            <button
              onClick={() => void openReport(lastAnalysis)}
              title="Отчёт по сессии готов — открыть"
              style={{
                marginLeft: 6,
                padding: '1px 6px',
                background: 'rgba(52, 199, 89, 0.15)',
                color: 'var(--d-green)',
                borderRadius: 3,
                border: 'none',
                fontSize: 9.5,
                letterSpacing: 0.5,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              REPORT READY
            </button>
          )}
        </div>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => void window.druz9.ui.openProviderPicker()}
            title={config ? 'Выбрать модель' : 'Нужен вход — зайди через Настройки'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 16,
              padding: '0 6px',
              background: 'transparent',
              border: '1px solid transparent',
              borderRadius: 4,
              color: 'var(--d-text-2)',
              fontFamily: 'inherit',
              fontSize: 10.5,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.borderColor = 'var(--d-line)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'transparent';
            }}
          >
            {modelLabel(activeModelId, config)}
            <IconChevronDown size={10} />
          </button>
          <Kbd size="sm">CommandOrControl+Shift+D</Kbd>
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function PreviewRow({
  pending,
  onRetake,
  onDiscard,
}: {
  pending: PendingAttachment;
  onRetake: () => void | Promise<void>;
  onDiscard: () => void;
}) {
  const src = `data:${pending.mimeType};base64,${pending.dataBase64}`;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderBottom: '1px solid var(--d-line)',
        background: 'var(--d-bg-2)',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {/* Thumbnail */}
      <div
        style={{
          width: 104,
          height: 64,
          flexShrink: 0,
          background: 'var(--d-bg-code)',
          border: '1px solid var(--d-line)',
          borderRadius: 6,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          src={src}
          alt="screenshot preview"
          style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}
        />
      </div>

      {/* Meta + actions */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--d-text)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <IconCamera size={12} />
          Скриншот готов
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--d-text-3)', fontFamily: 'var(--f-mono)' }}>
          {pending.width}×{pending.height} · добавь вопрос и жми Enter
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <button
            onClick={() => void onRetake()}
            style={smallChip}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Переделать
          </button>
        </div>
      </div>

      <IconButton title="Отменить (Esc)" onClick={onDiscard}>
        <IconClose size={14} />
      </IconButton>
    </div>
  );
}

const smallChip: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 8px',
  background: 'transparent',
  color: 'var(--d-text-2)',
  border: '1px solid var(--d-line)',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

// Tiny window-chrome button — smaller, flatter, and hover tints. Close
// button uses `danger` to go red on hover so it reads like a real
// close affordance, not just another icon.
function WindowChromeButton({
  title,
  onClick,
  children,
  danger = false,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  const hoverBg = danger ? 'rgba(255, 69, 58, 0.16)' : 'rgba(255,255,255,0.06)';
  const hoverColor = danger ? 'var(--d-red)' : 'var(--d-text)';
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        border: 'none',
        background: 'transparent',
        color: 'var(--d-text-3)',
        borderRadius: 4,
        cursor: 'pointer',
        padding: 0,
        transition: 'background-color 120ms ease, color 120ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = hoverBg;
        e.currentTarget.style.color = hoverColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--d-text-3)';
      }}
    >
      {children}
    </button>
  );
}

function modelLabel(id: string | undefined, cfg: ReturnType<typeof useConfig>['config']): string {
  if (!id || !cfg) return 'AI';
  const m = cfg.models.find((x) => x.id === id);
  return m?.displayName ?? 'AI';
}

function formatElapsed(iso: string): string {
  if (!iso) return '';
  const start = new Date(iso).getTime();
  if (isNaN(start)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

async function openReport(analysis: import('@shared/types').SessionAnalysis): Promise<void> {
  // Preference order:
  //   1. Server report URL → open in the OS browser (full Druzya UI).
  //   2. No URL (BYOK) → show in the expanded window's inline viewer.
  if (analysis.reportUrl) {
    await window.druz9.shell.openExternal(analysis.reportUrl);
    return;
  }
  await window.druz9.windows.show('expanded');
}
