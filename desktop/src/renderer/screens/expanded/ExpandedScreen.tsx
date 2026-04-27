// Expanded chat window — streaming assistant output with markdown-ish
// rendering (code fences highlighted via flat monospace blocks + copy).
//
// Messages come from the conversation store which subscribes to IPC
// streaming events. Follow-up input calls analyze.chat with the current
// conversation id.
//
// Visual: Midnight-velvet design system. The window uses `transparent:
// true` at the OS level + an rgba scrim inside so the desktop shows
// through at whatever alpha the Appearance slider sets. No OS vibrancy
// (Tahoe 26.x regressions). The header/input use hairlines; messages
// use the MessageBubble pattern from windows.jsx.

import { useEffect, useRef, useState } from 'react';

import { eventChannels } from '@shared/ipc';
import {
  BrandMark,
  CompactLogo,
  D9IconCamera,
  D9IconClose,
  D9IconCopy,
  D9IconSettings,
  IconButton,
  Kbds,
  QuotaMeterMini,
  StatusDot,
  StreamingHairline,
} from '../../components/d9';
import { IconHistory, IconMic, IconSend } from '../../components/icons';
import { ProviderPicker } from '../../components/ProviderPicker';
import { useConfig } from '../../hooks/use-config';
import { useHotkeyEvents } from '../../hooks/use-hotkey-events';
// Appearance slider now writes --d9-window-alpha globally via app.tsx —
// we just consume that var below, no need to hook the store here.
import { useConversationStore, type UIMessage } from '../../stores/conversation';
import { usePersonaStore } from '../../stores/persona';
import { useQuotaStore } from '../../stores/quota';
import { useSelectedModelStore } from '../../stores/selected-model';
import { useSessionStore } from '../../stores/session';
import { useAudioCaptureStore } from '../../stores/audio-capture';
import { useCoachStore } from '../../stores/coach';
import { SummaryModal } from '../summary/SummaryModal';

export function ExpandedScreen() {
  const { config } = useConfig();
  const bootstrap = useConversationStore((s) => s.bootstrap);
  const messages = useConversationStore((s) => s.messages);
  const streaming = useConversationStore((s) => s.streaming);
  const conversationId = useConversationStore((s) => s.conversationId);

  const selectedModel = useSelectedModelStore((s) => s.modelId);
  const modelBootstrap = useSelectedModelStore((s) => s.bootstrap);
  useEffect(() => modelBootstrap(), [modelBootstrap]);
  const sessionBootstrap = useSessionStore((s) => s.bootstrap);
  const audioCaptureBootstrap = useAudioCaptureStore((s) => s.bootstrap);
  const coachBootstrap = useCoachStore((s) => s.bootstrap);

  const activePersona = usePersonaStore((s) => s.active);
  const personaBootstrap = usePersonaStore((s) => s.bootstrap);
  useEffect(() => { void personaBootstrap(); }, [personaBootstrap]);

  const quota = useQuotaStore((s) => s.quota);
  const bootstrapQuota = useQuotaStore((s) => s.bootstrap);
  useEffect(() => {
    let unsub: (() => void) | null = null;
    void bootstrapQuota().then((u) => { unsub = u; });
    return () => { if (unsub) unsub(); };
  }, [bootstrapQuota]);

  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const lastAnalysis = useSessionStore((s) => s.lastAnalysis);
  const notesFilePath = useSessionStore((s) => s.notesFilePath);
  // Auto-open the Summary modal the first time a report lands while
  // the window is visible. The user can close + re-open via the header
  // button (rendered only when lastAnalysis is non-null).
  useEffect(() => {
    if (lastAnalysis && lastAnalysis.status === 'ready') setSummaryOpen(true);
  }, [lastAnalysis]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draftInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubConv = bootstrap();
    const unsubSession = sessionBootstrap();
    const unsubAudio = audioCaptureBootstrap();
    const unsubCoach = coachBootstrap();
    // Compact broadcasts this when the user clicks the model label —
    // expanded is the right place for the 440×520 picker modal.
    const unsubPicker = window.druz9.on(eventChannels.openProviderPicker, () => {
      setPickerOpen(true);
    });
    // Compact and expanded live in separate renderer processes, so they
    // can't share the conversation store directly. Main broadcasts a
    // userTurnStarted event so this window can paint the optimistic
    // user bubble (with screenshot preview) the instant the turn begins.
    const seenTurns = new Set<string>();
    const applyTurn = (ev: import('@shared/ipc').UserTurnStartedEvent) => {
      // Dedupe: both the live broadcast (fires before this window
      // mounted) and the getLastUserTurn replay can deliver the same
      // turn. streamId is the key.
      if (seenTurns.has(ev.streamId)) return;
      seenTurns.add(ev.streamId);
      const { getState } = useConversationStore;
      if (getState().streamId === ev.streamId) return; // local begin already ran
      getState().beginTurn({
        promptText: ev.promptText,
        hasScreenshot: ev.hasScreenshot,
        screenshotDataUrl: ev.screenshotDataUrl || undefined,
        streamId: ev.streamId,
      });
    };
    const unsubTurn = window.druz9.on<import('@shared/ipc').UserTurnStartedEvent>(
      eventChannels.userTurnStarted,
      applyTurn,
    );
    // Race fix: compact broadcasts userTurnStarted *before* this window
    // exists. Pull the cached snapshot from main so we still draw the
    // optimistic bubble on first paint.
    void window.druz9.ui.getLastUserTurn().then((ev) => {
      if (ev) applyTurn(ev);
    });
    return () => {
      unsubConv();
      unsubSession();
      unsubAudio();
      unsubCoach();
      unsubPicker();
      unsubTurn();
    };
  }, [bootstrap, sessionBootstrap, audioCaptureBootstrap, coachBootstrap]);

  useEffect(() => {
    // Pin to bottom while streaming. Manual scroll-away handling is out
    // of scope for MVP.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  const send = async () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft('');
    // First message in this window session: analyze.start creates the
    // conversation; subsequent turns use analyze.chat.
    //
    // Why no direct beginTurn here: main broadcasts `userTurnStarted`
    // inside the ipc handler BEFORE returning. applyTurn (above, with
    // seenTurns dedupe) paints the optimistic bubble on broadcast
    // arrival. A direct call here raced the broadcast and doubled the
    // message when the event handler ran first.
    const ipc = conversationId ? window.druz9.analyze.chat : window.druz9.analyze.start;
    await ipc({
      conversationId,
      promptText: text,
      model: selectedModel || config?.defaultModelId || '',
      attachments: [],
      triggerAction: 'quick_prompt',
      focusedAppHint: '',
    });
  };

  // Auto-send-on-silence: после VAD-tail (3s без новых chunk'ов) пушим
  // accumulated transcript в чат + clear store. Юзер хочет hands-free
  // flow: говорит → пауза → ответ модели → говорит → ...
  //
  // Flow:
  //   1. Когда recording=true и chunks меняются — reset 3s timeout.
  //   2. Если timeout срабатывает И есть текст И не streaming — splice
  //      + send + clear.
  //   3. Если streaming идёт — НЕ отправляем (модель ещё отвечает на
  //      предыдущее), просто оставляем chunks в буфере; следующий tick
  //      попробует снова. Это даёт юзеру естественный turn-taking
  //      ритм: «говорю — пауза — модель отвечает — снова говорю».
  const audioChunks = useAudioCaptureStore((s) => s.chunks);
  const audioFullText = useAudioCaptureStore((s) => s.fullText);
  const audioClear = useAudioCaptureStore((s) => s.clear);
  const audioState = useAudioCaptureStore((s) => s.state);
  const autoSendTimerRef = useRef<number | null>(null);
  const SILENCE_AUTOSEND_MS = 3000;

  useEffect(() => {
    if (autoSendTimerRef.current !== null) {
      window.clearTimeout(autoSendTimerRef.current);
      autoSendTimerRef.current = null;
    }
    const recording = audioState === 'running';
    if (!recording || audioChunks.length === 0 || streaming) return;

    autoSendTimerRef.current = window.setTimeout(() => {
      const text = audioFullText().trim();
      if (!text) return;
      // Re-check streaming в момент срабатывания: гонка между
      // useEffect cleanup'ом и setTimeout closure'ом возможна, если
      // streaming flip'нулся true прямо перед firing'ом. Проверяем
      // через store напрямую.
      if (useConversationStore.getState().streaming) return;

      audioClear();
      // Если у юзера в draft был text — приплюсуем (очень редкий
      // случай, но сохраняем).
      const joined = draft.trim() ? `${draft.trim()} ${text}` : text;
      setDraft('');
      const ipc = conversationId ? window.druz9.analyze.chat : window.druz9.analyze.start;
      void ipc({
        conversationId,
        promptText: joined,
        model: selectedModel || config?.defaultModelId || '',
        attachments: [],
        triggerAction: 'voice_input',
        focusedAppHint: '',
      }).catch(() => {
        // Network blip / quota — не падаем, просто оставляем chunks
        // которые мы уже cleared'нули. Юзер увидит что ответ не пришёл
        // и заговорит снова.
      });
    }, SILENCE_AUTOSEND_MS);

    return () => {
      if (autoSendTimerRef.current !== null) {
        window.clearTimeout(autoSendTimerRef.current);
        autoSendTimerRef.current = null;
      }
    };
  }, [audioChunks, audioState, streaming, draft, conversationId, selectedModel, config?.defaultModelId, audioFullText, audioClear]);

  useHotkeyEvents((action) => {
    if (action !== 'instant_assist') return;
    if (draft.trim()) {
      void send();
    } else {
      draftInputRef.current?.focus();
    }
  });

  const activeModelId = selectedModel || config?.defaultModelId || '';
  const modelLabelText = config?.models.find((m) => m.id === activeModelId)?.displayName ?? 'AI';

  return (
    <div
      className="d9-root"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        // Hone-aligned scrim — pure black with the Appearance slider
        // controlling alpha. Previously indigo-tinted; the new palette
        // drops colour from the bg so accent content (red, persona
        // gradients) pops without fighting a purple cast.
        background: 'rgba(10, 10, 10, var(--d9-window-alpha))',
        border: '0.5px solid var(--d9-hairline-b)',
        borderRadius: 'var(--d9-r-xl)',
        boxShadow: 'var(--d9-shadow-win)',
        color: 'var(--d9-ink)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          WebkitAppRegion: 'drag',
          flexShrink: 0,
        } as React.CSSProperties}
      >
        {/* Logo pill */}
        <div style={{ WebkitAppRegion: 'no-drag', flexShrink: 0 } as React.CSSProperties}>
          <CompactLogo size={28} />
        </div>

        {/* Persona chip */}
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <ChatHeadPill color="cyan">{activePersona.label}</ChatHeadPill>
        </div>

        {/* Model pill */}
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <ChatHeadPill color="cyan" onClick={() => setPickerOpen(true)} chevron>
            {modelLabelText}
          </ChatHeadPill>
        </div>

        <div style={{ flex: 1 }} />

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <MeetingRecordButton />
          <AttachedDocsBadge />
          {lastAnalysis && lastAnalysis.status === 'ready' && (
            <button
              onClick={() => setSummaryOpen(true)}
              title="Открыть session summary"
              style={{
                padding: '4px 10px',
                marginRight: 4,
                borderRadius: 6,
                background: 'rgba(79,195,247,0.10)',
                border: '0.5px solid rgba(79,195,247,0.3)',
                color: 'var(--d9-accent)',
                fontSize: 11,
                fontFamily: 'var(--d9-font-mono)',
                letterSpacing: '0.04em',
                cursor: 'pointer',
              }}
            >
              SUMMARY
            </button>
          )}
          {messages.length > 0 && (
            <IconButton
              title="Сохранить чат как заметку в Hone"
              onClick={() => {
                void (async () => {
                  try {
                    await window.druz9.notes.saveChatToHone({
                      title: '',
                      messages: messages
                        .filter((m) => !m.pending && m.content.trim().length > 0)
                        .map((m) => ({ role: m.role, content: m.content })),
                    });
                  } catch {
                    // Hone не установлен / OS блокировал deeplink — silent.
                  }
                })();
              }}
            >
              <SaveToHoneIcon />
            </IconButton>
          )}
          <IconButton title="История" onClick={() => void window.druz9.windows.show('history')}>
            <IconHistory size={14} />
          </IconButton>
          <IconButton title="Настройки" onClick={() => void window.druz9.windows.show('settings')}>
            <D9IconSettings size={14} />
          </IconButton>
          <IconButton
            title="Свернуть / закрыть (⌘W)"
            onClick={() => void window.druz9.windows.hide('expanded')}
          >
            <D9IconClose size={12} />
          </IconButton>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 22px 20px',
          position: 'relative',
        }}
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} persona={activePersona.id} />
            ))}
            {streaming && <ThinkingIndicator />}
          </>
        )}
      </div>

      {/* Live transcript ticker — visible only when macOS system-
          audio capture is running or has accumulated chunks. Click to
          splice the full transcript into the draft. */}
      <LiveTranscriptStrip draft={draft} setDraft={setDraft} />

      {/* Auto-suggest pill — renders the latest AI suggestion from
          the etap-3 trigger policy. Hidden when no suggestion +
          toggle off. */}
      <AutoSuggestPill draft={draft} setDraft={setDraft} />

      {/* Follow-up input */}
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${focused ? 'rgba(79,195,247,0.4)' : 'transparent'}`,
            borderRadius: 10,
            padding: '8px 8px 8px 14px',
            transition: 'border-color 150ms',
          }}
        >
          <input
            ref={draftInputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Continue dialog…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--d9-ink)',
              fontFamily: 'var(--d9-font-sans)',
              fontSize: 14,
              letterSpacing: '0.01em',
              outline: 'none',
              caretColor: 'var(--d9-accent)',
            }}
          />
          <MicButton draft={draft} setDraft={setDraft} />
          <IconButton
            title="Скриншот (⌘⇧S)"
            onClick={() => void captureAndSend(conversationId, draft, setDraft, selectedModel || config?.defaultModelId || '')}
          >
            <D9IconCamera size={14} />
          </IconButton>
          {/* Send button — cyan accent circle */}
          <button
            type="button"
            title="Отправить (Enter)"
            onClick={() => void send()}
            disabled={streaming || !draft.trim()}
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              border: 0,
              cursor: streaming || !draft.trim() ? 'not-allowed' : 'pointer',
              background: streaming || !draft.trim() ? 'rgba(79,195,247,0.25)' : 'var(--d9-accent)',
              color: '#001218',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'transform 120ms, filter 120ms, background 120ms',
              boxShadow: !streaming && draft.trim() ? '0 0 12px rgba(79,195,247,0.35)' : 'none',
            }}
          >
            <IconSend size={14} />
          </button>
        </div>
        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginTop: 8,
            paddingLeft: 2,
            fontFamily: 'var(--d9-font-mono)',
            fontSize: 10,
            letterSpacing: '0.08em',
            color: 'var(--d9-ink-ghost)',
          }}
        >
          <ChatKbd>⌘</ChatKbd><ChatKbd>↵</ChatKbd>
          <span style={{ marginLeft: -10 }}>SEND</span>
          <span style={{ color: 'var(--d9-hairline-b)' }}>·</span>
          <ChatKbd>⌘</ChatKbd><ChatKbd>⇧</ChatKbd><ChatKbd>S</ChatKbd>
          <span style={{ marginLeft: -20 }}>SCREENSHOT</span>
          <span style={{ flex: 1 }} />
          {streaming ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <StatusDot state="streaming" size={6} />
              <span>streaming</span>
            </span>
          ) : (
            quota && quota.requestsCap > 0 && (
              <QuotaMeterMini used={quota.requestsUsed} cap={quota.requestsCap} />
            )
          )}
        </div>
      </div>

      {streaming && <StreamingHairline inset={18} />}

      {pickerOpen && (
        <ProviderPicker
          models={config?.models ?? []}
          defaultModelId={config?.defaultModelId ?? ''}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {summaryOpen && lastAnalysis && (
        <SummaryModal
          analysis={lastAnalysis}
          modelLabel={activeModelId}
          notesFilePath={notesFilePath}
          onClose={() => setSummaryOpen(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function EmptyState() {
  // The hero BrandMark is now always black (post-Cue rebrand), so we
  // only need the persona label for the subtitle — no gradient lookup.
  const persona = usePersonaStore((s) => s.active);
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: '0 20px',
      }}
    >
      <BrandMark
        size={76}
        style={{
          borderRadius: 22,
          boxShadow:
            'inset 0 0.5px 0 rgba(255,255,255,0.3), ' +
            '0 4px 20px -2px rgba(0,0,0,0.4), ' +
            '0 0 40px -8px rgba(0,0,0,0.4)',
        }}
      />
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--d9-font-display)',
            fontStyle: 'italic',
            fontSize: 26,
            color: 'var(--d9-ink)',
            letterSpacing: '-0.01em',
            lineHeight: 1.1,
          }}
        >
          Незаметно. Точно.
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--d9-ink-mute)',
            marginTop: 6,
            letterSpacing: '-0.005em',
          }}
        >
          {persona.label} · невидимо для screen-sharing
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 320 }}>
        {([
          ['Объяснить что я вижу', ['⌘', '⏎']],
          ['Заскринить область + спросить', ['⌘', '⇧', 'S']],
          ['Сменить персону', ['⌥', '1']],
          ['Скрыть окно', ['⌘', '\\']],
        ] as Array<[string, string[]]>).map(([label, keys]) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 9,
              background: 'oklch(1 0 0 / 0.03)',
              border: '0.5px solid var(--d9-hairline)',
            }}
          >
            <span
              style={{
                fontSize: 12.5,
                color: 'var(--d9-ink-dim)',
                letterSpacing: '-0.005em',
                flex: 1,
              }}
            >
              {label}
            </span>
            <Kbds keys={keys} size="sm" sep="" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: 'var(--d9-ink-mute)',
        fontSize: 12,
        marginBottom: 16,
      }}
    >
      <StatusDot state="thinking" size={6} />
      <span style={{ letterSpacing: '-0.005em' }}>думаю…</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Message bubbles — user (right, violet tint) / assistant (left, prose)
// ─────────────────────────────────────────────────────────────────────────

function MessageBubble({ m, persona: _persona }: { m: UIMessage; persona: string }) {
  if (m.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div
          style={{
            maxWidth: '78%',
            padding: '10px 14px',
            borderRadius: '12px 12px 4px 12px',
            background: 'rgba(255,255,255,0.06)',
            color: 'var(--d9-ink)',
            fontSize: 14,
            lineHeight: 1.5,
            letterSpacing: '0.01em',
          }}
        >
          {m.hasScreenshot && m.screenshotDataUrl && (
            <a
              href={m.screenshotDataUrl}
              target="_blank"
              rel="noreferrer"
              title="Открыть в полном размере"
              style={{
                display: 'block',
                marginBottom: m.content ? 8 : 0,
                padding: 2,
                borderRadius: 8,
                background: 'rgba(0,0,0,0.25)',
                cursor: 'zoom-in',
              }}
            >
              <img
                src={m.screenshotDataUrl}
                alt="скриншот"
                style={{
                  display: 'block',
                  width: '100%',
                  maxHeight: 240,
                  objectFit: 'cover',
                  borderRadius: 6,
                }}
              />
            </a>
          )}
          {m.hasScreenshot && !m.screenshotDataUrl && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
                fontSize: 11,
                opacity: 0.85,
              }}
            >
              <D9IconCamera size={12} />
              скриншот
            </div>
          )}
          {m.content || (!m.hasScreenshot && <span style={{ opacity: 0.6 }}>(пусто)</span>)}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', marginBottom: 20, gap: 12, maxWidth: '92%' }}>
      {/* Star glyph — cyan sparkle matching prototype */}
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        <svg width={18} height={18} viewBox="0 0 18 18" fill="none" style={{ color: 'var(--d9-accent)' }}>
          <path d="M9 1l1.5 5.5L16 8l-5.5 1.5L9 15l-1.5-5.5L2 8l5.5-1.5L9 1z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
        </svg>
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 14.5,
          lineHeight: 1.6,
          letterSpacing: '-0.002em',
          color: 'var(--d9-ink)',
        }}
      >
        {m.errorCode ? (
          <ErrorCard code={m.errorCode} message={m.errorMessage ?? 'Unknown error'} />
        ) : (
          <AssistantContent text={m.content} pending={m.pending} />
        )}
      </div>
    </div>
  );
}

function ErrorCard({ code, message }: { code: string; message: string }) {
  // A 401 Unauthenticated often ends up in the transport bucket because
  // the Connect error surfaces without a specific code string. Detect via
  // the message; everything else keeps its human label.
  const is401 =
    code === 'transport' &&
    /401|unauthenticated|unauthorized|no handler|not authenticated/i.test(message);

  if (is401) {
    return (
      <div
        style={{
          padding: '10px 12px',
          background: 'var(--d9-accent-glow)',
          border: '0.5px solid rgba(255, 59, 48, 0.4)',
          borderRadius: 9,
          color: 'var(--d9-accent-hi)',
          fontSize: 12.5,
          letterSpacing: '-0.005em',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Нужен вход</div>
        <div style={{ opacity: 0.85 }}>
          Открой Настройки → Общее → Войти и авторизуйся через Telegram.
        </div>
      </div>
    );
  }

  const label: Record<string, string> = {
    rate_limited: 'Лимит запросов исчерпан',
    model_unavailable: 'Модель недоступна на вашем плане',
    invalid_input: 'Неверный ввод',
    internal: 'Ошибка сервера',
    transport: 'Потеряно соединение с сервером',
  };
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'oklch(0.68 0.22 25 / 0.08)',
        border: '0.5px solid oklch(0.68 0.22 25 / 0.3)',
        borderRadius: 9,
        color: 'var(--d9-err)',
        fontSize: 12.5,
        letterSpacing: '-0.005em',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{label[code] ?? code}</div>
      <div style={{ opacity: 0.85 }}>{message}</div>
    </div>
  );
}

/**
 * AssistantContent renders the streaming text with a minimal markdown pass:
 *  - triple-backtick fences → code blocks
 *  - single backticks → inline code
 *
 * We deliberately avoid a full markdown lib until UX demands it; this
 * covers 90% of LLM outputs for MVP.
 */
function AssistantContent({ text, pending }: { text: string; pending: boolean }) {
  return (
    <>
      {renderMiniMarkdown(text)}
      {pending && (
        <span
          style={{
            display: 'inline-block',
            width: '0.55em',
            height: '1em',
            marginLeft: 1,
            verticalAlign: '-0.15em',
            background: 'var(--d9-accent-hi)',
            borderRadius: 1,
            opacity: 0.8,
            animation: 'druz9-pulse 1s ease-in-out infinite',
          }}
        />
      )}
    </>
  );
}

function renderMiniMarkdown(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  const parts = text.split(/(```[\s\S]*?```)/g);
  parts.forEach((part, i) => {
    if (part.startsWith('```')) {
      const closed = part.endsWith('```') && part.length > 6;
      const body = closed ? part.slice(3, -3) : part.slice(3);
      const firstNl = body.indexOf('\n');
      const lang = firstNl >= 0 ? body.slice(0, firstNl).trim() : '';
      const code = firstNl >= 0 ? body.slice(firstNl + 1) : body;
      nodes.push(<CodeBlock key={i} lang={lang} code={code.trimEnd()} />);
    } else {
      nodes.push(<InlineText key={i} text={part} />);
    }
  });
  return nodes;
}

function InlineText({ text }: { text: string }) {
  const segments = text.split(/(`[^`]+`)/g);
  return (
    <>
      {segments.map((s, i) =>
        s.startsWith('`') && s.endsWith('`') && s.length > 2 ? (
          <code
            key={i}
            style={{
              fontFamily: 'var(--d9-font-mono)',
              fontSize: 12,
              padding: '1px 5px',
              background: 'oklch(1 0 0 / 0.06)',
              borderRadius: 4,
              color: 'var(--d9-ink)',
            }}
          >
            {s.slice(1, -1)}
          </code>
        ) : (
          <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
            {s}
          </span>
        ),
      )}
    </>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        margin: '8px 0 12px',
        borderRadius: 10,
        // Code-block shell — deeper than the surrounding surface.
        // Pure black 75% alpha lets the scrim show through slightly.
        background: 'rgba(0, 0, 0, 0.6)',
        border: '0.5px solid var(--d9-hairline)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 8px 6px 12px',
          borderBottom: '0.5px solid var(--d9-hairline)',
          background: 'oklch(1 0 0 / 0.02)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--d9-font-mono)',
            fontSize: 10.5,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--d9-ink-ghost)',
          }}
        >
          {lang || 'code'}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard denied — silent */
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 7px',
            borderRadius: 5,
            color: 'var(--d9-ink-mute)',
            fontSize: 10.5,
            letterSpacing: '0.02em',
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'oklch(1 0 0 / 0.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <D9IconCopy size={11} />
          {copied ? 'Скопировано' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '10px 12px 12px',
          overflowX: 'auto',
          fontFamily: 'var(--d9-font-mono)',
          fontSize: 12,
          lineHeight: 1.65,
          color: 'var(--d9-ink-dim)',
          whiteSpace: 'pre',
        }}
      >
        {code}
      </pre>
    </div>
  );
}

async function captureAndSend(
  conversationId: string,
  promptText: string,
  setDraft: (s: string) => void,
  model: string,
) {
  try {
    const shot = await window.druz9.capture.screenshotArea();
    if (!shot) return; // user cancelled
    const ipc = conversationId ? window.druz9.analyze.chat : window.druz9.analyze.start;
    const handle = await ipc({
      conversationId,
      promptText,
      model,
      attachments: [
        {
          kind: 'screenshot',
          dataBase64: shot.dataBase64,
          mimeType: shot.mimeType,
          width: shot.width,
          height: shot.height,
        },
      ],
      triggerAction: 'screenshot_area',
      focusedAppHint: '',
    });
    // Main broadcasts `userTurnStarted` before the handle returns, but
    // push and invoke-response travel independently — the push can lose
    // the race on some Electron builds. If the broadcast already ran
    // applyTurn, streamId will match; skip. Otherwise paint here.
    if (useConversationStore.getState().streamId !== handle.streamId) {
      useConversationStore.getState().beginTurn({
        promptText,
        hasScreenshot: true,
        screenshotDataUrl: `data:${shot.mimeType};base64,${shot.dataBase64}`,
        streamId: handle.streamId,
      });
    }
    setDraft('');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('screenshot failed', err);
  }
}

/**
 * MicButton — one-click voice dictation. States:
 *   idle      → click to start recording;
 *   recording → pulsing accent dot; click again to stop;
 *   busy      → sending to backend / waiting for transcript;
 *
 * Pipeline:
 *   getUserMedia(audio) → MediaRecorder(webm/opus) → onstop combines
 *   chunks into a Blob → ArrayBuffer → Uint8Array → IPC → main →
 *   multipart POST → Groq whisper-large-v3-turbo → transcript.
 *
 * On success the transcript is APPENDED (not replaced) to the current
 * draft so user's typed context is preserved. Space separator inserted
 * iff the existing draft doesn't already end in whitespace.
 *
 * Errors (denied mic, backend 502, etc.) land as an inline tooltip
 * title on the button; we don't toast to avoid two error surfaces.
 * The user clicks again to retry.
 *
 * Not in scope here: system-audio capture (requires native Swift/
 * WASAPI modules — see docs/etap-1-audio.md next iteration), VAD,
 * streaming STT, diarization.
 */
function MicButton({ draft, setDraft }: { draft: string; setDraft: (s: string) => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'busy'>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Pick the MIME the browser can actually produce. Safari reports
      // webm;codecs=opus as supported but then fails to finalize the
      // container — mp4/m4a is a better default on macOS's WebKit path.
      // Our Electron build ships Chromium so webm always wins, but the
      // fallback keeps us honest if we ever ship a Safari-based runtime.
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        '',
      ];
      const mime = candidates.find((m) => !m || MediaRecorder.isTypeSupported(m)) ?? '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stopStream();
        setState('busy');
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          if (blob.size === 0) {
            setError('Пустая запись');
            setState('idle');
            return;
          }
          const buf = await blob.arrayBuffer();
          const ext = (rec.mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm';
          const result = await window.druz9.transcription.transcribe({
            audio: new Uint8Array(buf),
            mime: rec.mimeType || 'audio/webm',
            filename: `voice.${ext}`,
            language: '',
            prompt: '',
          });
          const text = result.text.trim();
          if (text) {
            const joiner = draft.length === 0 || /\s$/.test(draft) ? '' : ' ';
            setDraft(draft + joiner + text);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Ошибка распознавания');
        } finally {
          setState('idle');
        }
      };
      rec.start();
      setState('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нет доступа к микрофону');
      setState('idle');
      stopStream();
    }
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop(); // → triggers onstop → sends to backend.
    }
  };

  const toggle = () => {
    if (state === 'recording') stopRecording();
    else if (state === 'idle') void startRecording();
  };

  const title =
    error ??
    (state === 'recording'
      ? 'Остановить и распознать'
      : state === 'busy'
        ? 'Распознавание…'
        : 'Голосовой ввод');

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={state === 'busy'}
      title={title}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        padding: 0,
        borderRadius: 7,
        background: state === 'recording'
          ? 'rgba(79,195,247,0.12)'
          : 'transparent',
        border: '0.5px solid ' + (state === 'recording'
          ? 'rgba(79,195,247,0.4)'
          : 'transparent'),
        color: error
          ? 'oklch(0.75 0.18 25)'
          : state === 'recording'
            ? 'var(--d9-accent)'
            : state === 'busy'
              ? 'var(--d9-ink-ghost)'
              : 'var(--d9-ink-mute)',
        cursor: state === 'busy' ? 'wait' : 'pointer',
        transition: 'background 200ms, border-color 200ms, color 200ms',
        boxShadow: state === 'recording' ? '0 0 12px rgba(79,195,247,0.2)' : 'none',
      }}
    >
      <IconMic size={14} />
      {/* Recording: pulsing cyan ring (ripple outward) */}
      {state === 'recording' && (
        <>
          <span style={{
            position: 'absolute',
            inset: -4,
            borderRadius: 12,
            border: '1.5px solid var(--d9-accent)',
            opacity: 0.6,
            animation: 'd9pulse 1.4s ease-out infinite',
            pointerEvents: 'none',
          }} />
          <span style={{
            position: 'absolute',
            inset: -8,
            borderRadius: 16,
            border: '1px solid var(--d9-accent)',
            opacity: 0.25,
            animation: 'd9pulse 1.4s ease-out infinite 0.4s',
            pointerEvents: 'none',
          }} />
        </>
      )}
      {/* Busy: small spinning arc */}
      {state === 'busy' && (
        <span style={{
          position: 'absolute',
          inset: -3,
          borderRadius: '50%',
          border: '1.5px solid transparent',
          borderTopColor: 'var(--d9-accent)',
          animation: 'spin 0.8s linear infinite',
          pointerEvents: 'none',
        }} />
      )}
    </button>
  );
}

/**
 * AutoSuggestPill — floating suggestion strip above the input row.
 * Shows the most recent /copilot/suggestion result, the question
 * that triggered it, and an action to splice into the draft.
 * Dismissable; auto-replaced on the next trigger.
 *
 * Accent glow differentiates it from the transcript strip so the
 * user instantly reads "this is AI" vs "this is raw transcript".
 */
function AutoSuggestPill({
  draft,
  setDraft,
}: {
  draft: string;
  setDraft: (s: string) => void;
}) {
  const suggestion = useCoachStore((s) => s.suggestion);
  const thinking = useCoachStore((s) => s.thinking);
  const enabled = useCoachStore((s) => s.enabled);
  const error = useCoachStore((s) => s.error);
  const dismiss = useCoachStore((s) => s.dismiss);

  // Render only when there's something to say. Toggle off + no
  // active suggestion + no error = stay invisible.
  if (!suggestion && !thinking && !error) return null;
  if (!enabled && !suggestion) return null;

  const insert = () => {
    if (!suggestion) return;
    const joiner = draft.length === 0 || /\s$/.test(draft) ? '' : '\n';
    setDraft(draft + joiner + suggestion.text);
    dismiss();
  };

  return (
    <div
      style={{
        padding: '6px 12px 0',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '8px 12px',
          borderRadius: 10,
          background: error
            ? 'oklch(0.6 0.2 25 / 0.1)'
            : 'linear-gradient(135deg, rgba(255, 59, 48, 0.1), rgba(255, 107, 96, 0.08))',
          border: `0.5px solid ${error ? 'oklch(0.6 0.2 25 / 0.35)' : 'rgba(255, 59, 48, 0.3)'}`,
          boxShadow: error ? 'none' : '0 0 14px -4px var(--d9-accent-glow)',
        }}
      >
        <span
          aria-hidden
          style={{
            flex: 'none',
            fontSize: 13,
            lineHeight: '1.5em',
          }}
        >
          {error ? '⚠️' : thinking ? '💭' : '💡'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {error ? (
            <div
              style={{
                fontSize: 11.5,
                color: 'oklch(0.75 0.18 25)',
                letterSpacing: '-0.005em',
              }}
            >
              {error}
            </div>
          ) : thinking && !suggestion ? (
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--d9-accent-hi)',
                letterSpacing: '-0.005em',
                fontStyle: 'italic',
              }}
            >
              AI формулирует ответ на вопрос собеседника…
            </div>
          ) : suggestion ? (
            <>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--d9-ink-ghost)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontFamily: 'var(--d9-font-mono)',
                  marginBottom: 3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Q: {suggestion.question}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--d9-ink)',
                  lineHeight: 1.45,
                  letterSpacing: '-0.005em',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {suggestion.text}
              </div>
            </>
          ) : null}
        </div>
        {suggestion && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 'none' }}>
            <button
              type="button"
              onClick={insert}
              title="Вставить в поле ввода"
              style={{
                padding: '3px 8px',
                fontSize: 10.5,
                fontFamily: 'inherit',
                background: 'var(--d9-accent)',
                color: 'white',
                border: 0,
                borderRadius: 5,
                cursor: 'pointer',
                letterSpacing: '-0.005em',
              }}
            >
              в ввод
            </button>
            <button
              type="button"
              onClick={dismiss}
              title="Скрыть"
              style={{
                padding: '3px 8px',
                fontSize: 10.5,
                fontFamily: 'inherit',
                background: 'transparent',
                color: 'var(--d9-ink-ghost)',
                border: '0.5px solid var(--d9-hairline)',
                borderRadius: 5,
                cursor: 'pointer',
                letterSpacing: '-0.005em',
              }}
            >
              закрыть
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * LiveTranscriptStrip — one-line pill above the input that shows the
 * most recent transcript chunk streaming from the meeting. Clicking
 * it splices the FULL accumulated transcript into the draft and
 * clears the store, so the user can then edit + send to copilot.
 *
 * Hidden when there's nothing to show (no chunks yet and not
 * recording). A running-but-empty state renders the "слушаю…" hint
 * so the user knows audio is flowing even before the first chunk
 * transcribes.
 */
function LiveTranscriptStrip({
  draft,
  setDraft,
}: {
  draft: string;
  setDraft: (s: string) => void;
}) {
  const state = useAudioCaptureStore((s) => s.state);
  const chunks = useAudioCaptureStore((s) => s.chunks);
  const fullText = useAudioCaptureStore((s) => s.fullText);
  const clear = useAudioCaptureStore((s) => s.clear);
  const error = useAudioCaptureStore((s) => s.error);

  const recording = state === 'running' || state === 'starting';
  if (!recording && chunks.length === 0 && !error) return null;

  const last = chunks[chunks.length - 1]?.text ?? '';
  const hint = recording && !last ? 'Слушаю встречу…' : last;

  const onClickSplice = () => {
    const text = fullText().trim();
    if (!text) return;
    const joiner = draft.length === 0 || /\s$/.test(draft) ? '' : ' ';
    setDraft(draft + joiner + text);
    clear();
  };

  return (
    <div
      style={{
        padding: '6px 12px 0',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={chunks.length > 0 ? onClickSplice : undefined}
        disabled={chunks.length === 0}
        title={
          chunks.length > 0
            ? 'Вставить полный транскрипт в поле ввода'
            : error || 'Идёт запись…'
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '6px 10px',
          borderRadius: 8,
          background: error
            ? 'oklch(0.6 0.2 25 / 0.12)'
            : recording
              ? 'rgba(255, 59, 48, 0.08)'
              : 'oklch(1 0 0 / 0.04)',
          border: `0.5px solid ${
            error
              ? 'oklch(0.6 0.2 25 / 0.35)'
              : recording
                ? 'rgba(255, 59, 48, 0.3)'
                : 'var(--d9-hairline)'
          }`,
          color: error ? 'oklch(0.75 0.18 25)' : 'var(--d9-ink-mute)',
          fontSize: 12,
          fontFamily: 'inherit',
          letterSpacing: '-0.005em',
          textAlign: 'left',
          cursor: chunks.length > 0 ? 'pointer' : 'default',
          overflow: 'hidden',
        }}
      >
        {recording && !error && (
          <span
            aria-hidden
            style={{
              flex: 'none',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'oklch(0.65 0.22 25)',
              animation: 'd9-pulse 1s ease-in-out infinite',
            }}
          />
        )}
        <span
          style={{
            flex: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {error ? `Запись: ${error}` : hint || 'Транскрипт пуст'}
        </span>
        {chunks.length > 0 && (
          <span
            style={{
              fontSize: 10,
              fontFamily: 'var(--d9-font-mono)',
              color: 'var(--d9-ink-ghost)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {chunks.length} • нажми чтобы вставить
          </span>
        )}
      </button>
    </div>
  );
}

/**
 * MeetingRecordButton — toggles macOS system-audio capture.
 *
 * States:
 *   hidden    — when binary missing (Windows/Linux or un-built dev),
 *               we render nothing rather than a disabled button;
 *   idle      — red-dot capsule "Запись встречи" — click to start;
 *   starting  — brief; shows spinner while TCC prompt may fire;
 *   running   — animated dot + elapsed-seconds counter; click to stop;
 *   stopping  — waiting for final chunk to drain.
 *
 * Each captured 5s window is POSTed to /transcription and the result
 * lands in `useAudioCaptureStore.chunks`. The chat input row rendered
 * below picks those up and shows a live-transcript ticker; the user
 * clicks it to splice the accumulated text into the draft.
 */
function MeetingRecordButton() {
  const state = useAudioCaptureStore((s) => s.state);
  const startedAt = useAudioCaptureStore((s) => s.startedAt);
  const available = useAudioCaptureStore((s) => s.available);
  const error = useAudioCaptureStore((s) => s.error);
  const start = useAudioCaptureStore((s) => s.start);
  const stop = useAudioCaptureStore((s) => s.stop);
  const setCoachEnabled = useCoachStore((s) => s.setEnabled);
  const [tick, setTick] = useState(0);

  // 1s repaint so the elapsed counter advances. Only runs while we're
  // in a recording-ish state to avoid touching the tree idle.
  useEffect(() => {
    if (state !== 'running') return;
    const h = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(h);
  }, [state]);

  useEffect(() => {
    if (error) void window.druz9.toast.show(error, 'error');
  }, [error]);

  if (!available) return null;

  const elapsed = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  const elapsedLabel = `${mm}:${ss.toString().padStart(2, '0')}`;

  const recording = state === 'running';
  const busy = state === 'starting' || state === 'stopping';
  const label =
    state === 'starting'
      ? 'Запуск…'
      : state === 'stopping'
        ? 'Остановка…'
        : recording
          ? `● ${elapsedLabel}`
          : 'Записать встречу';

  const onClick = () => {
    if (busy) return;
    if (recording) {
      void setCoachEnabled(false);
      void stop();
    } else {
      void setCoachEnabled(true);
      void start();
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={
        recording
          ? 'Остановить запись встречи'
          : 'Записать системный звук локально. Для расшифровки аудио отправляется в /transcription без сохранения raw-записи.'
      }
      style={{
        padding: '4px 10px',
        marginRight: 4,
        borderRadius: 7,
        background: recording
          ? 'oklch(0.6 0.2 25 / 0.15)'
          : 'oklch(1 0 0 / 0.04)',
        border: `0.5px solid ${recording ? 'oklch(0.6 0.2 25 / 0.5)' : 'var(--d9-hairline)'}`,
        color: recording ? 'oklch(0.75 0.18 25)' : 'var(--d9-ink-mute)',
        fontSize: 11.5,
        fontFamily: recording ? 'var(--d9-font-mono)' : 'inherit',
        letterSpacing: '-0.005em',
        cursor: busy ? 'wait' : 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 120ms var(--d9-ease), color 120ms var(--d9-ease)',
      }}
    >
      {/* Invisible refresh — referencing `tick` inside a side-effect
          field would break SSR/Strict; reading the counter in JSX
          keeps the subscription live. */}
      <span style={{ display: 'none' }}>{tick}</span>
      {label}
    </button>
  );
}

/**
 * AttachedDocsBadge — compact pill in the expanded header that tells the
 * user how many documents feed the current turn's RAG context. Hidden
 * when there's no live session OR when the user hasn't attached
 * anything. Clicking opens the Settings → Documents tab where the user
 * can toggle attachments.
 *
 * This is informational-only here; full management (attach/detach,
 * upload) lives in Settings where there's room for a drop-zone and
 * list. Keeping the badge simple avoids a second picker-panel to own.
 */
function AttachedDocsBadge() {
  const current = useSessionStore((s) => s.current);
  const attached = useSessionStore((s) => s.attachedDocIds);
  if (!current || current.finishedAt || attached.length === 0) return null;
  const plural = attached.length === 1 ? 'документ' : attached.length < 5 ? 'документа' : 'документов';
  return (
    <button
      type="button"
      onClick={() => void window.druz9.windows.show('settings')}
      title={`Copilot учитывает ${attached.length} ${plural} в контексте. Открыть Настройки → Документы.`}
      style={{
        padding: '4px 10px',
        marginRight: 4,
        borderRadius: 7,
        background: 'oklch(0.8 0.17 150 / 0.12)',
        border: '0.5px solid oklch(0.8 0.17 150 / 0.28)',
        color: 'var(--d9-ok)',
        fontSize: 11.5,
        fontFamily: 'inherit',
        letterSpacing: '-0.005em',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      📎 {attached.length} {plural}
    </button>
  );
}

// ─── Chat-specific helpers ────────────────────────────────────────────────

/** Pill chip in the chat header — persona label or model name. */
function ChatHeadPill({
  children,
  color,
  onClick,
  chevron,
}: {
  children: React.ReactNode;
  color?: 'cyan' | 'red';
  onClick?: () => void;
  chevron?: boolean;
}) {
  const isCyan = color === 'cyan';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 9px',
        borderRadius: 6,
        background: 'rgba(255,255,255,0.04)',
        border: 0,
        fontFamily: 'var(--d9-font-mono)',
        fontSize: 11,
        letterSpacing: '0.04em',
        color: 'var(--d9-ink)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 120ms',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
      onMouseEnter={(e) => onClick && (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: isCyan ? 'var(--d9-accent)' : 'oklch(0.65 0.22 25)',
      }} />
      {children}
      {chevron && <span style={{ fontSize: 8, color: 'var(--d9-ink-ghost)' }}>▾</span>}
    </button>
  );
}

/** Tiny kbd chip for the chat footer shortcut hints. */
function ChatKbd({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      border: '1px solid var(--d9-hairline-b)',
      background: 'rgba(255,255,255,0.03)',
      padding: '2px 6px',
      borderRadius: 4,
      fontFamily: 'var(--d9-font-mono)',
      fontSize: 10,
      color: 'var(--d9-ink)',
      margin: '0 1px',
    }}>
      {children}
    </span>
  );
}

// SaveToHoneIcon — outlined notebook glyph (соответствует HoneIcon в
// SummaryModal, оставлен inline чтобы не плодить barrel-export'ы).
function SaveToHoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 8h2M4 12h2M4 16h2" />
      <path d="M11 9l4 4M15 9l-4 4" />
    </svg>
  );
}
