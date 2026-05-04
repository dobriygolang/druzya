// CompactScreen — 1:1 port of `CompactWindow` from the design package
// (design/windows.jsx, lines 6-70). The layout + inline styles below
// are copied verbatim from the design JSX; only demo-mode props
// (`state='idle'`, hard-coded persona strings) have been replaced with
// live data from the zustand stores.
//
// Design reference (don't drift without updating the mockup):
//   design/windows.jsx      — CompactWindow
//   design/components.jsx   — PERSONAS / IconButton / BrandMark / ModelPill / PersonaChip
//   design/tokens.css       — OKLCH palette, radii, shadows, motion
//
// Layout: 460×92 (grows to 520×180 w/ preview, or +300 w/ persona dropdown).
//   Row 1 (height ~34): BrandMark(30) · input pill (⌘⏎ chip) · camera · settings
//   Row 2 (height 22):  ModelPill · PersonaChip · status text · spacer · QuotaMeterMini
//   Bottom edge:        StreamingHairline while streaming
//
// Window chrome lives in main/windows/window-manager.ts: frame:false +
// transparent:true. We paint the glass ourselves here so the design
// tokens (gradient + backdrop-filter + shadow) are applied identically
// to the mockup.

import { useEffect, useRef, useState } from 'react';

import {
  CompactLogo,
  D9IconCamera,
  D9IconClose,
  D9IconSettings,
  IconButton,
  QuotaMeterMini,
  StatusDot,
  StreamingHairline,
} from '../../components/d9';
import { IconHistory } from '../../components/icons';
import { useConfig } from '../../hooks/use-config';
import { useHotkeyEvents } from '../../hooks/use-hotkey-events';
import { useAuthStore } from '../../stores/auth';
import { useConversationStore } from '../../stores/conversation';
import { usePersonaStore } from '../../stores/persona';
import { usePersonaHotkeys } from '../../hooks/use-persona-hotkeys';
import { useCursorFreezeStore } from '../../stores/cursor-freeze';
import { useQuotaStore } from '../../stores/quota';
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
  const clearSelectedModel = useSelectedModelStore((s) => s.clear);
  const modelBootstrap = useSelectedModelStore((s) => s.bootstrap);
  useEffect(() => modelBootstrap(), [modelBootstrap]);

  // Drop a persisted selection that no longer exists / is no longer
  // allowed — otherwise the server keeps rejecting with
  // CodePermissionDenied "model not allowed on current plan".
  useEffect(() => {
    if (!config || !selectedModel) return;
    const stillAllowed = config.models.some(
      (m) => m.id === selectedModel && m.availableOnCurrentPlan,
    );
    if (!stillAllowed) clearSelectedModel();
  }, [config, selectedModel, clearSelectedModel]);

  const pending = usePendingAttachmentStore((s) => s.pending);
  const clearPending = usePendingAttachmentStore((s) => s.clear);
  const cursorState = useCursorFreezeStore((s) => s.state);
  const cursorBootstrap = useCursorFreezeStore((s) => s.bootstrap);
  const liveSession = useSessionStore((s) => s.current);
  const lastAnalysis = useSessionStore((s) => s.lastAnalysis);
  const sessionBootstrap = useSessionStore((s) => s.bootstrap);

  const activePersona = usePersonaStore((s) => s.active);
  const personaBootstrap = usePersonaStore((s) => s.bootstrap);
  useEffect(() => { void personaBootstrap(); }, [personaBootstrap]);
  // ⌥1..⌥9 — quick-switch активной persona. Hint показывается в
  // expanded EmptyState; реализация была отсутствующей до этого.
  usePersonaHotkeys();

  const quota = useQuotaStore((s) => s.quota);
  const bootstrapQuota = useQuotaStore((s) => s.bootstrap);
  useEffect(() => {
    let unsub: (() => void) | null = null;
    void bootstrapQuota().then((u) => { unsub = u; });
    return () => { if (unsub) unsub(); };
  }, [bootstrapQuota]);

  const [input, setInput] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  // Which picker window is currently open, mirrored from main via
  // `pickerStateChanged` broadcast. Drives the caret-rotation on the
  // matching pill (model / persona). null = no picker open.
  const [_openPicker, setOpenPicker] = useState<'model' | 'persona' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Mirror the picker-window state so the caret on the corresponding
  // pill rotates. Picker runs in a separate BrowserWindow — we can't
  // observe its mount locally, so main broadcasts pickerStateChanged
  // on show/hide.
  useEffect(() => {
    const unsub = window.druz9.on<import('@shared/ipc').PickerStateEvent>(
      'event:picker-state-changed',
      (ev) => setOpenPicker(ev.kind),
    );
    return unsub;
  }, []);

  // 1Hz tick so the "SESSION 12:34" timer updates while a live session
  // is running. Cheap; only re-renders compact.
  const [, setTickTs] = useState(0);
  useEffect(() => {
    if (!liveSession) return;
    const t = setInterval(() => setTickTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [liveSession]);

  // Grow / shrink the window for the screenshot preview row. Dropdowns
  // (persona / model) now live in a separate 'picker' floating window
  // so compact stays at its fixed 92px chrome.
  useEffect(() => {
    const w = pending ? COMPACT_WITH_PREVIEW_WIDTH : COMPACT_BASE_WIDTH;
    const h = pending ? COMPACT_WITH_PREVIEW_HEIGHT : COMPACT_BASE_HEIGHT;
    void window.druz9.windows.resize('compact', w, h);
  }, [pending]);

  // Capture → instant send (input text rides along as the prompt).
  const capture = async (kind: 'screenshot_area' | 'screenshot_full') => {
    try {
      const shot =
        kind === 'screenshot_full'
          ? await window.druz9.capture.screenshotFull()
          : await window.druz9.capture.screenshotArea();
      if (!shot) return;

      const text = input.trim();
      const currentPersona = usePersonaStore.getState().active;
      const conversationId = useConversationStore.getState().conversationId;
      // Show expanded first so its renderer can subscribe to streaming
      // events before the first backend response arrives (fast
      // providers otherwise fire events before bootstrap()).
      await window.druz9.windows.show('expanded');
      await window.druz9.windows.hide('compact');
      const handle = await window.druz9.analyze.start({
        conversationId,
        // ЧИСТЫЙ user text. Persona system-prompt передаётся отдельным
        // полем personaSystemPrompt и backend добавит его как system
        // message; раньше prepend'ился сюда → загрязнял history → LLM
        // эхала persona-pattern в каждом ответе.
        promptText: text,
        model: selectedModel || config?.defaultModelId || '',
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
        personaSystemPrompt: currentPersona.system_prompt,
      });
      beginTurn({
        promptText: text,
        hasScreenshot: true,
        screenshotDataUrl: `data:${shot.mimeType};base64,${shot.dataBase64}`,
        streamId: handle.streamId,
      });
      setInput('');
      clearPending();
      setStatusError(null);
    } catch (err) {
      // Errors from capture/analyze can be verbose ("Error: Screen
      // Recording permission denied. Open System Settings → Privacy →
      // Screen Recording and enable Electron…"). Compact is 460×92 —
      // no room for multi-line. Route to the floating toast window;
      // keep a short marker in the status row so the user sees
      // something happened even if they missed the toast.
      const full = (err as Error).message;
      setStatusError('Ошибка — см. уведомление');
      void window.druz9.toast.show(full, 'error');
      // eslint-disable-next-line no-console
      console.error('screenshot failed', err);
    }
  };

  useHotkeyEvents(async (action) => {
    if (action === 'screenshot_area' || action === 'screenshot_full') {
      void capture(action);
    } else if (action === 'quick_prompt') {
      inputRef.current?.focus();
    } else if (action === 'instant_assist') {
      if (input.trim() || pending) {
        void submit();
      } else {
        inputRef.current?.focus();
      }
    } else if (action === 'toggle_window') {
      void (async () => {
        await window.druz9.windows.show('expanded');
        await window.druz9.windows.hide('compact');
      })();
    }
  });

  const submit = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
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
    const currentPersona = usePersonaStore.getState().active;
    const handle = await window.druz9.analyze.start({
      conversationId,
      // Чистый text; persona прокидывается отдельным system message.
      promptText: text,
      model: selectedModel || config?.defaultModelId || '',
      attachments,
      triggerAction: pending ? 'screenshot_area' : 'quick_prompt',
      focusedAppHint: '',
      personaSystemPrompt: currentPersona.system_prompt,
    });
    beginTurn({
      promptText: text,
      hasScreenshot: !!pending,
      screenshotDataUrl: pending ? `data:${pending.mimeType};base64,${pending.dataBase64}` : undefined,
      streamId: handle.streamId,
    });
    setInput('');
    clearPending();
    await window.druz9.windows.show('expanded');
    await window.druz9.windows.hide('compact');
  };

  const activeModelId = selectedModel || config?.defaultModelId || '';
  const modelDisplayName = config?.models.find((m) => m.id === activeModelId)?.displayName ?? 'AI';
  // Map internal status to design-package StatusDot state.
  const dotState: 'idle' | 'ready' | 'thinking' | 'streaming' | 'recording' =
    liveSession ? 'recording' : streaming ? 'streaming' : session ? 'ready' : 'idle';
  const statusLabel =
    statusError ? `Ошибка: ${statusError}` :
    liveSession ? `SESSION ${formatElapsed(liveSession.startedAt)}` :
    streaming ? 'Streaming…' :
    session ? 'Ready' : 'Нужен вход';

  return (
    // Outer — positioned; hosts the glass surface + dropdown + streaming hairline.
    <div
      className="d9-root"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
      }}
    >
      {/* WindowShell (heavy glass). Copied from design/components.jsx
          WindowShell heavy variant + wrapped in the drag region. */}
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 14,
          background:
            'linear-gradient(180deg, rgba(20, 20, 20, calc(var(--d9-window-alpha) * 0.88)), rgba(8, 8, 8, var(--d9-window-alpha)))',
          backdropFilter: 'var(--d9-glass-blur)',
          WebkitBackdropFilter: 'var(--d9-glass-blur)' as unknown as string,
          boxShadow: 'var(--d9-shadow-win)',
          color: 'var(--d9-ink)',
          fontFamily: 'var(--d9-font-sans)',
          position: 'relative',
          overflow: 'hidden',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        {/* Inner hairline highlight — design/components.jsx WindowShell */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            border: '0.5px solid var(--d9-hairline-b)',
            pointerEvents: 'none',
          }}
        />

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

        {/* Inner padded column */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: pending ? undefined : '100%',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {/* Row 1 — primary input (height 48px) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: 48,
              padding: '0 10px',
              WebkitAppRegion: 'drag',
            } as React.CSSProperties}
          >
            <CompactLogo size={32} />

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
              placeholder={
                streaming
                  ? 'Думаю…'
                  : pending
                  ? 'Добавь вопрос к скриншоту…'
                  : 'ask anything…'
              }
              style={{
                flex: 1,
                fontSize: 13,
                color: 'var(--d9-ink)',
                letterSpacing: '0.01em',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                caretColor: 'var(--d9-accent)',
                padding: '0 4px',
                WebkitAppRegion: 'no-drag',
              } as React.CSSProperties}
            />

            {/* Key pills — ⌘ ↵ */}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <KeyPill lit={input.length > 0}>⌘</KeyPill>
              <KeyPill lit={input.length > 0}>↵</KeyPill>
            </div>

            <div style={{ width: 1, height: 18, background: 'var(--d9-hairline-b)', flexShrink: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties} />

            <IconButton
              title="Скриншот области (⌘⇧S)"
              onClick={() => void capture('screenshot_area')}
              baseColor="var(--d9-ink-mute)"
              hoverColor="var(--d9-accent)"
            >
              <D9IconCamera size={16} />
            </IconButton>
            <IconButton
              title="История чатов"
              onClick={() => void window.druz9.windows.show('history')}
              baseColor="var(--d9-ink-mute)"
              hoverColor="var(--d9-accent)"
            >
              <IconHistory size={14} />
            </IconButton>
            <IconButton
              title="Настройки"
              onClick={() => void window.druz9.windows.show('settings')}
              baseColor="var(--d9-ink-mute)"
              hoverColor="var(--d9-accent)"
            >
              <D9IconSettings size={14} />
            </IconButton>
          </div>

          {/* Row 2 — status (height 32px, border-top hairline) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: 32,
              padding: '0 14px',
              borderTop: '1px solid rgba(255,255,255,0.04)',
              WebkitAppRegion: 'no-drag',
              fontFamily: 'var(--d9-font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
              color: 'var(--d9-ink-mute)',
            } as React.CSSProperties}
          >
            <StatusPillBtn
              onClick={() => void window.druz9.windows.showPicker('model')}
              title={config ? 'Выбрать модель' : 'Нужен вход'}
            >
              <StatusDot state={dotState} size={6} />
              <strong style={{ color: 'var(--d9-ink)', fontWeight: 400 }}>{modelDisplayName}</strong>
              <span style={{ color: 'var(--d9-ink-ghost)', fontSize: 8 }}>▾</span>
            </StatusPillBtn>

            <StatusPillBtn
              onClick={() => void window.druz9.windows.showPicker('persona')}
              title={activePersona.hint}
            >
              <StatusDot state={dotState} size={6} />
              <strong style={{ color: 'var(--d9-ink)', fontWeight: 400 }}>{activePersona.label}</strong>
              <span style={{ color: 'var(--d9-ink-ghost)', fontSize: 8 }}>▾</span>
            </StatusPillBtn>

            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {/* StatusDot перед таймером убран — рядом с цифрами он
                  читался как дубликат (модель/персонаж pill уже несут
                  тот же dotState). Без точки timer выглядит чище. */}
              {statusLabel}
            </span>

            {cursorState === 'frozen' && (
              <span
                title="Курсор заморожен. ⌘⇧Y — разморозить"
                style={{
                  padding: '1px 6px',
                  background: 'var(--d9-accent-glow)',
                  color: 'var(--d9-accent-hi)',
                  borderRadius: 3,
                  fontSize: 9,
                }}
              >
                CURSOR LOCK
              </span>
            )}
            {!liveSession && lastAnalysis && (
              <button
                onClick={() => void openReport(lastAnalysis)}
                title="Отчёт по сессии готов — открыть"
                style={{
                  padding: '1px 6px',
                  background: 'oklch(0.6 0.15 150 / 0.18)',
                  color: 'var(--d9-ok)',
                  borderRadius: 3,
                  border: 'none',
                  fontSize: 9,
                  fontFamily: 'var(--d9-font-mono)',
                  letterSpacing: 0.5,
                  cursor: 'pointer',
                }}
              >
                REPORT READY
              </button>
            )}

            {/* История перенесена в row 1 (рядом с Settings/Camera) —
                это action-кнопка, ей место в actions row, не в status. */}

            <span style={{ flex: 1 }} />

            {quota && (
              quota.requestsCap > 0 ? (
                <QuotaMeterMini used={quota.requestsUsed} cap={quota.requestsCap} />
              ) : quota.plan && quota.plan !== 'free' ? (
                // Paid unlimited plan — show a small badge instead of the
                // meter so the right edge of row 2 isn't empty.
                <span
                  title={`План: ${quota.plan}`}
                  style={{
                    fontSize: 9,
                    fontFamily: 'var(--d9-font-mono)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--d9-accent-hi)',
                    opacity: 0.75,
                    userSelect: 'none',
                  }}
                >
                  ✦ {quota.plan}
                </span>
              ) : null
            )}
          </div>
        </div>

        {streaming && <StreamingHairline />}
      </div>

    </div>
  );
}

// Keypill — monospace bordered key label; lit = accent when input has text.
function KeyPill({ children, lit }: { children: React.ReactNode; lit?: boolean }) {
  return (
    <span
      style={{
        border: `1px solid ${lit ? 'rgba(255,255,255,0.4)' : 'var(--d9-hairline-b)'}`,
        background: lit ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
        color: lit ? 'var(--d9-accent)' : 'var(--d9-ink-ghost)',
        fontFamily: 'var(--d9-font-mono)',
        fontSize: 11,
        padding: '3px 7px',
        borderRadius: 5,
        minWidth: 22,
        textAlign: 'center' as const,
        lineHeight: 1,
        height: 20,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'color 120ms, border-color 120ms, background 120ms',
        userSelect: 'none' as const,
      }}
    >
      {children}
    </span>
  );
}

// Clickable pill-button in the status row.
function StatusPillBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'transparent',
        border: 0,
        padding: '4px 4px',
        borderRadius: 4,
        cursor: 'pointer',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        letterSpacing: 'inherit',
        textTransform: 'inherit' as const,
        transition: 'background 120ms, color 120ms',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
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
        padding: '10px 14px',
        borderBottom: '0.5px solid var(--d9-hairline)',
        background: 'oklch(1 0 0 / 0.03)',
        position: 'relative',
        zIndex: 1,
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      <div
        style={{
          width: 104,
          height: 64,
          flexShrink: 0,
          background: 'var(--d9-void)',
          border: '0.5px solid var(--d9-hairline)',
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
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--d9-ink)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            letterSpacing: '-0.005em',
          }}
        >
          <D9IconCamera size={12} />
          Скриншот готов
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--d9-ink-mute)',
            fontFamily: 'var(--d9-font-mono)',
          }}
        >
          {pending.width}×{pending.height} · добавь вопрос и жми Enter
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <button
            onClick={() => void onRetake()}
            style={smallChip}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'oklch(1 0 0 / 0.06)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Переделать
          </button>
        </div>
      </div>
      <IconButton title="Отменить (Esc)" onClick={onDiscard}>
        <D9IconClose size={12} />
      </IconButton>
    </div>
  );
}

const smallChip: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 8px',
  background: 'transparent',
  color: 'var(--d9-ink-dim)',
  border: '0.5px solid var(--d9-hairline)',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '-0.005em',
};

function formatElapsed(iso: string): string {
  if (!iso) return '';
  const start = new Date(iso).getTime();
  if (isNaN(start)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

async function openReport(
  analysis: import('@shared/types').SessionAnalysis,
): Promise<void> {
  if (analysis.reportUrl) {
    await window.druz9.shell.openExternal(analysis.reportUrl);
    return;
  }
  await window.druz9.windows.show('expanded');
}
