// Expanded chat window — streaming assistant output with markdown-ish
// rendering (code fences highlighted via bold monospace boxes).
//
// Messages come from the conversation store which subscribes to IPC
// streaming events. Follow-up input calls analyze.chat with the current
// conversation id.

import { useEffect, useRef, useState } from 'react';

import { eventChannels } from '@shared/ipc';
import { BrandMark, IconCamera, IconChevronDown, IconClose, IconCopy, IconHistory, IconMinimize, IconSend } from '../../components/icons';
import { IconButton, Kbd, StatusDot } from '../../components/primitives';
import { ProviderPicker } from '../../components/ProviderPicker';
import { SessionReportView } from '../../components/SessionReportView';
import { useConfig } from '../../hooks/use-config';
import { useConversationStore, type UIMessage } from '../../stores/conversation';
import { useSelectedModelStore } from '../../stores/selected-model';
import { useSessionStore } from '../../stores/session';

export function ExpandedScreen() {
  const { config } = useConfig();
  const bootstrap = useConversationStore((s) => s.bootstrap);
  const messages = useConversationStore((s) => s.messages);
  const streaming = useConversationStore((s) => s.streaming);
  const conversationId = useConversationStore((s) => s.conversationId);
  const beginTurn = useConversationStore((s) => s.beginTurn);

  const selectedModel = useSelectedModelStore((s) => s.modelId);
  const modelBootstrap = useSelectedModelStore((s) => s.bootstrap);
  useEffect(() => modelBootstrap(), [modelBootstrap]);
  const lastAnalysis = useSessionStore((s) => s.lastAnalysis);
  const sessionBootstrap = useSessionStore((s) => s.bootstrap);
  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubConv = bootstrap();
    const unsubSession = sessionBootstrap();
    // Compact broadcasts this when the user clicks the model label —
    // expanded is the right place for the 440×520 picker modal.
    const unsubPicker = window.druz9.on(eventChannels.openProviderPicker, () => {
      setPickerOpen(true);
    });
    // Compact and expanded live in separate renderer processes, so they
    // can't share the conversation store directly. Main broadcasts a
    // userTurnStarted event from analyzeStart / chatStart so this window
    // can paint the optimistic user bubble (with screenshot preview) the
    // instant the turn begins.
    const seenTurns = new Set<string>();
    const applyTurn = (ev: import('@shared/ipc').UserTurnStartedEvent) => {
      // Two paths can deliver the same turn: the live broadcast (fires
      // before this window mounted when triggered from compact) AND the
      // getLastUserTurn replay on mount. Dedupe by streamId.
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
      unsubPicker();
      unsubTurn();
    };
  }, [bootstrap, sessionBootstrap]);

  useEffect(() => {
    // Pin to bottom while streaming. When the user manually scrolls away
    // we stop forcing the scroll — out of scope for MVP.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  const send = async () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft('');
    // If this is the first message in this window session, analyze.start
    // creates the conversation; subsequent turns use analyze.chat.
    const ipc = conversationId ? window.druz9.analyze.chat : window.druz9.analyze.start;
    const handle = await ipc({
      conversationId,
      promptText: text,
      model: selectedModel || config?.defaultModelId || '',
      attachments: [],
      triggerAction: 'quick_prompt',
      focusedAppHint: '',
    });
    beginTurn({ promptText: text, hasScreenshot: false, streamId: handle.streamId });
  };

  const activeModelId = selectedModel || config?.defaultModelId || '';
  const modelLabel = config?.models.find((m) => m.id === activeModelId)?.displayName ?? 'AI';

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
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px 0 14px',
          gap: 10,
          borderBottom: '1px solid var(--d-line)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <BrandMark size={22} />
        <button
          onClick={() => setPickerOpen(true)}
          disabled={!config}
          title="Выбрать модель"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 1,
            padding: '4px 8px',
            background: 'transparent',
            border: '1px solid transparent',
            borderRadius: 6,
            color: 'inherit',
            cursor: 'pointer',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
            e.currentTarget.style.borderColor = 'var(--d-line)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'transparent';
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--d-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {modelLabel}
            <IconChevronDown size={10} />
          </span>
          <span style={{ fontSize: 10, color: 'var(--d-text-3)', fontFamily: 'var(--f-mono)' }}>
            {streaming ? 'думает…' : 'готов'}
          </span>
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 2, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <IconButton title="История" onClick={() => void window.druz9.windows.show('history')}>
            <IconHistory size={15} />
          </IconButton>
          <IconButton title="Свернуть" onClick={() => void window.druz9.windows.hide('expanded')}>
            <IconMinimize size={15} />
          </IconButton>
          <IconButton
            title="Закрыть (⌘W)"
            onClick={() => void window.druz9.windows.hide('expanded')}
          >
            <IconClose size={15} />
          </IconButton>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 16px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* Session report takes precedence over the empty state — when
            BYOK analysis lands, the user probably wants to see it
            instead of a "press Cmd+Shift+S" prompt. */}
        {messages.length === 0 && lastAnalysis && !lastAnalysis.reportUrl && (
          <SessionReportView analysis={lastAnalysis} />
        )}
        {messages.length === 0 && !lastAnalysis && <EmptyState />}
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
        {streaming && <ThinkingIndicator />}
      </div>

      {/* Follow-up input */}
      <div
        style={{
          borderTop: '1px solid var(--d-line)',
          padding: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <IconButton
          title="Скриншот (⌘⇧S)"
          onClick={() => void captureAndSend(conversationId, draft, beginTurn, setDraft, selectedModel)}
        >
          <IconCamera size={15} />
        </IconButton>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Продолжить диалог…"
          style={{
            flex: 1,
            minHeight: 32,
            maxHeight: 120,
            padding: '8px 10px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--d-line)',
            borderRadius: 'var(--r-inner)',
            color: 'var(--d-text)',
            font: 'inherit',
            fontSize: 13,
            lineHeight: 1.4,
            outline: 'none',
            resize: 'none',
          }}
        />
        <IconButton title="Отправить (Enter)" onClick={() => void send()} disabled={streaming}>
          <IconSend size={15} />
        </IconButton>
      </div>

      {pickerOpen && (
        <ProviderPicker
          models={config?.models ?? []}
          defaultModelId={config?.defaultModelId ?? ''}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        padding: 40,
        textAlign: 'center',
        gap: 8,
      }}
    >
      <BrandMark size={48} />
      <div style={{ fontSize: 15, color: 'var(--d-text)', marginTop: 8 }}>
        Нажми <Kbd size="sm">CommandOrControl+Shift+S</Kbd> для скриншота
      </div>
      <div style={{ fontSize: 12, color: 'var(--d-text-3)' }}>
        или напиши вопрос в compact-окно
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--d-text-3)', fontSize: 12 }}>
      <StatusDot state="thinking" size={6} />
      <span>думаю…</span>
    </div>
  );
}

function MessageBubble({ m }: { m: UIMessage }) {
  if (m.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div
          style={{
            maxWidth: '80%',
            padding: '8px 12px',
            background: 'var(--d-gradient-hero)',
            color: 'white',
            borderRadius: 12,
            borderTopRightRadius: 4,
            fontSize: 13,
            lineHeight: 1.5,
            boxShadow: '0 2px 8px rgba(124,92,255,0.25)',
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
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.15)',
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
              <IconCamera size={12} />
              скриншот
            </div>
          )}
          {m.content || (!m.hasScreenshot && <span style={{ opacity: 0.6 }}>(пусто)</span>)}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <BrandMark size={22} />
      <div style={{ flex: 1, minWidth: 0 }}>
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
  // A 401 Unauthenticated ends up in the transport bucket because the
  // Connect error surfaces without a specific code string. Catch that
  // via the message text; everything else keeps its human label.
  const is401 =
    code === 'transport' &&
    /401|unauthenticated|unauthorized|no handler|not authenticated/i.test(message);

  if (is401) {
    return (
      <div
        style={{
          padding: '8px 12px',
          background: 'var(--d-accent-soft)',
          border: '1px solid var(--d-line)',
          borderRadius: 8,
          color: 'var(--d-accent)',
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 600 }}>Нужен вход</div>
        <div style={{ opacity: 0.85, marginTop: 2 }}>
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
        padding: '8px 12px',
        background: 'rgba(255, 69, 58, 0.08)',
        border: '1px solid rgba(255, 69, 58, 0.3)',
        borderRadius: 8,
        color: 'var(--d-red)',
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600 }}>{label[code] ?? code}</div>
      <div style={{ opacity: 0.85, marginTop: 2 }}>{message}</div>
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
    <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--d-text)' }}>
      {renderMiniMarkdown(text)}
      {pending && <span className="druz9-caret" style={{ opacity: 0.7 }}>▍</span>}
    </div>
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
              fontFamily: 'var(--f-mono)',
              fontSize: 12,
              padding: '1px 5px',
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 4,
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
  return (
    <div
      style={{
        margin: '10px 0',
        background: 'var(--d-bg-code)',
        border: '1px solid var(--d-line)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          borderBottom: '1px solid var(--d-line)',
          fontSize: 10,
          fontFamily: 'var(--f-mono)',
          color: 'var(--d-text-3)',
          textTransform: 'lowercase',
        }}
      >
        <span>{lang || 'code'}</span>
        <IconButton
          size={22}
          title="Копировать"
          onClick={() => void navigator.clipboard.writeText(code)}
        >
          <IconCopy size={12} />
        </IconButton>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 12,
          overflowX: 'auto',
          fontFamily: 'var(--f-mono)',
          fontSize: 12,
          lineHeight: 1.5,
          color: 'var(--d-text)',
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
  beginTurn: ReturnType<typeof useConversationStore.getState>['beginTurn'],
  setDraft: (s: string) => void,
  model: string,
) {
  try {
    const shot = await window.druz9.capture.screenshotArea();
    if (!shot) return; // user cancelled the overlay
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
    beginTurn({
      promptText,
      hasScreenshot: true,
      screenshotDataUrl: `data:${shot.mimeType};base64,${shot.dataBase64}`,
      streamId: handle.streamId,
    });
    setDraft('');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('screenshot failed', err);
  }
}
