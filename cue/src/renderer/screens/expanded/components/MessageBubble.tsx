// Chat message rendering — user (right, violet tint) / assistant (left,
// prose) bubbles, plus the error card and assistant streaming content
// helpers. Pulled out of ExpandedScreen.

import { D9IconCamera } from '../../../components/d9';
import type { UIMessage } from '../../../stores/conversation';
import { renderMiniMarkdown } from '../lib/markdown';

export function MessageBubble({ m, persona: _persona }: { m: UIMessage; persona: string }) {
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
                  borderRadius: 'var(--radius-inner)',
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
        background: 'transparent',
        border: '0.5px solid rgba(255, 59, 48, 0.4)',
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
