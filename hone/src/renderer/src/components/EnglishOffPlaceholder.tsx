// EnglishOffPlaceholder — рендерится когда юзер навигирует на Reading /
// Writing / Listening / Overview, но english_active = false. Sergey
// 2026-05-03: «если пользователь не выбрал English вектор — нет смысла
// пихать в Hone». Показываем CTA «активируй» ведущий в Settings.
import React from 'react';

export function EnglishOffPlaceholder({ onActivate }: { onActivate: () => void }): React.ReactElement {
  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animationDuration: 'var(--motion-dur-large)',
      }}
    >
      <div style={{ maxWidth: 460, padding: 32, textAlign: 'center' }}>
        <div
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.24em',
            color: 'var(--ink-40)',
            marginBottom: 12,
          }}
        >
          ENGLISH HUB · OFF
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 28,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
          }}
        >
          English-loop отключён
        </h1>
        <p
          style={{
            marginTop: 12,
            fontSize: 13,
            lineHeight: 1.55,
            color: 'var(--ink-60)',
          }}
        >
          Reading / Writing / Listening + vocab SRS — это отдельный модуль.
          Включи его в Settings, если готовишься к English-собесу или хочешь
          подтянуть уровень с тутором.
        </p>
        <button
          type="button"
          onClick={onActivate}
          className="mono focus-ring"
          style={{
            marginTop: 20,
            padding: '8px 16px',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-90)',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 999,
            cursor: 'pointer',
          }}
        >
          Открыть Settings
        </button>
      </div>
    </div>
  );
}
