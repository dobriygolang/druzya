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
  D9IconCamera,
  D9IconCollapse,
  D9IconClose,
  D9IconCopy,
  D9IconSparkle,
  IconButton,
  Kbds,
  ModelPill,
  QuotaMeterMini,
  StatusDot,
  StreamingHairline,
} from '../../components/d9';
import { IconHistory, IconSend } from '../../components/icons';
import { ProviderPicker } from '../../components/ProviderPicker';
import { useConfig } from '../../hooks/use-config';
import { exportConversationAsMarkdown } from '../../lib/export-markdown';
// Appearance slider now writes --d9-window-alpha globally via app.tsx —
// we just consume that var below, no need to hook the store here.
import { useConversationStore, type UIMessage } from '../../stores/conversation';
import { usePersonaStore } from '../../stores/persona';
import { useQuotaStore } from '../../stores/quota';
import { useSelectedModelStore } from '../../stores/selected-model';
import { useSessionStore } from '../../stores/session';
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
  // Auto-open the Summary modal the first time a report lands while
  // the window is visible. The user can close + re-open via the header
  // button (rendered only when lastAnalysis is non-null).
  useEffect(() => {
    if (lastAnalysis && lastAnalysis.status === 'ready') setSummaryOpen(true);
  }, [lastAnalysis]);
  // Temp tooltip feedback after clicking "copy as markdown"
  // ("✓ Скопировано" / "Не удалось скопировать"). Null = default title.
  const [exportHint, setExportHint] = useState<string | null>(null);
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
      unsubPicker();
      unsubTurn();
    };
  }, [bootstrap, sessionBootstrap]);

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
        // Tinted-glass look — deep indigo-biased scrim. `transparent:
        // true` on the BrowserWindow (main/windows/window-manager.ts
        // 'expanded' case) lets desktop show through; alpha controlled
        // by Appearance slider. No OS vibrancy (Tahoe 26.x regressions).
        background: 'oklch(0.14 0.035 280 / var(--d9-window-alpha))',
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
          gap: 10,
          padding: '12px 12px 10px 14px',
          borderBottom: '0.5px solid var(--d9-hairline)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <BrandMark
          persona={activePersona.id}
          background={activePersona.brand_gradient}
          size={24}
        />
        <span
          style={{
            fontSize: 13,
            color: 'var(--d9-ink)',
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        >
          {activePersona.label}
        </span>
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <ModelPill
            label={modelLabelText}
            title={config ? 'Выбрать модель' : 'Нужен вход'}
            onClick={() => setPickerOpen(true)}
          />
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 2, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <AttachedDocsBadge />
          {lastAnalysis && lastAnalysis.status === 'ready' && (
            <button
              onClick={() => setSummaryOpen(true)}
              title="Открыть session summary"
              style={{
                padding: '4px 10px',
                marginRight: 4,
                borderRadius: 7,
                background: 'var(--d9-accent-glow)',
                border: '0.5px solid oklch(0.72 0.23 300 / 0.35)',
                color: 'var(--d9-accent-hi)',
                fontSize: 11.5,
                fontFamily: 'inherit',
                letterSpacing: '-0.005em',
                cursor: 'pointer',
              }}
            >
              Summary
            </button>
          )}
          <IconButton
            title={exportHint || 'Скопировать диалог как Markdown (Obsidian · Typora)'}
            onClick={async () => {
              const md = exportConversationAsMarkdown(messages, {
                modelLabel: activeModelId,
              });
              try {
                await navigator.clipboard.writeText(md);
                setExportHint('✓ Скопировано');
                setTimeout(() => setExportHint(null), 2000);
              } catch {
                setExportHint('Не удалось скопировать');
                setTimeout(() => setExportHint(null), 2500);
              }
            }}
          >
            <D9IconCopy size={14} />
          </IconButton>
          <IconButton title="История" onClick={() => void window.druz9.windows.show('history')}>
            <IconHistory size={14} />
          </IconButton>
          <IconButton
            title="Свернуть"
            onClick={() => void window.druz9.windows.hide('expanded')}
          >
            <D9IconCollapse size={14} />
          </IconButton>
          <IconButton
            title="Закрыть (⌘W)"
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
          padding: '18px 18px 10px',
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

      {/* Follow-up input */}
      <div
        style={{
          padding: '10px 12px 12px',
          borderTop: '0.5px solid var(--d9-hairline)',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            minHeight: 44,
            padding: '8px 8px 8px 12px',
            borderRadius: 12,
            background: 'oklch(1 0 0 / 0.05)',
            border: `0.5px solid ${focused ? 'var(--d9-accent)' : 'var(--d9-hairline)'}`,
            boxShadow: focused ? '0 0 0 3px var(--d9-accent-glow)' : 'none',
            transition: 'box-shadow 160ms var(--d9-ease), border-color 160ms',
          }}
        >
          <textarea
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
            placeholder="Продолжить диалог…"
            style={{
              flex: 1,
              minHeight: 24,
              maxHeight: 120,
              padding: '4px 0',
              background: 'transparent',
              border: 'none',
              color: 'var(--d9-ink)',
              font: 'inherit',
              fontSize: 13.5,
              lineHeight: 1.5,
              letterSpacing: '-0.005em',
              outline: 'none',
              resize: 'none',
            }}
          />
          <IconButton
            title="Скриншот (⌘⇧S)"
            onClick={() => void captureAndSend(conversationId, draft, setDraft, selectedModel || config?.defaultModelId || '')}
          >
            <D9IconCamera size={14} />
          </IconButton>
          <IconButton
            title="Отправить (Enter)"
            tone="accent"
            onClick={() => void send()}
            disabled={streaming || !draft.trim()}
          >
            <IconSend size={14} />
          </IconButton>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 8,
            paddingLeft: 2,
            fontSize: 11,
            color: 'var(--d9-ink-ghost)',
          }}
        >
          <Kbds keys={['⌘', '⏎']} size="sm" sep="" />
          <span>send</span>
          <span style={{ margin: '0 4px' }}>·</span>
          <Kbds keys={['⌘', '⇧', 'S']} size="sm" sep="" />
          <span>screenshot</span>
          <span style={{ flex: 1 }} />
          {streaming ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <StatusDot state="streaming" size={6} />
              streaming
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
          onClose={() => setSummaryOpen(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function EmptyState() {
  const persona = usePersonaStore((s) => s.active);
  const grad = persona.brand_gradient;
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
        persona={persona.id}
        background={grad}
        size={76}
        style={{
          borderRadius: 22,
          boxShadow:
            'inset 0 0.5px 0 rgba(255,255,255,0.3), ' +
            '0 4px 20px -2px currentColor, ' +
            '0 0 40px -8px currentColor',
          fontSize: 44,
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
            borderRadius: '14px 14px 4px 14px',
            background: 'linear-gradient(180deg, oklch(0.38 0.18 298), oklch(0.30 0.20 295))',
            color: 'var(--d9-ink)',
            fontSize: 13.5,
            lineHeight: 1.5,
            letterSpacing: '-0.005em',
            boxShadow:
              'inset 0 0.5px 0 oklch(1 0 0 / 0.15), ' +
              '0 1px 2px rgba(0,0,0,0.3)',
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
    <div style={{ display: 'flex', marginBottom: 20, gap: 10 }}>
      <div style={{ width: 22, flex: 'none', paddingTop: 2 }}>
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: 'var(--d9-slate)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--d9-ink-dim)',
          }}
        >
          <D9IconSparkle size={10} />
        </div>
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13.5,
          lineHeight: 1.65,
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
          border: '0.5px solid oklch(0.72 0.23 300 / 0.4)',
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
        background: 'oklch(0.11 0.03 280 / 0.75)',
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
