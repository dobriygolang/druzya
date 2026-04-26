// TodayStandupBanner — утренний standup в виде collapse'абельного баннера
// в верху Today page. Заменил отдельный StandupOverlay (open via Palette)
// — теперь интегрировано в естественный morning-flow.
//
// Conditions для показа:
//   1. Локальное время < MORNING_CUTOFF_HOUR (по дефолту 14:00) — после
//      уже не утренний standup, баннер не имеет смысла.
//   2. Server-side: ещё не записан standup на сегодня (note "Standup
//      YYYY-MM-DD" отсутствует) — проверяется через getTodayStandup().
//   3. Юзер не нажал «Skip» сегодня — local-only dismiss state, ключ
//      `hone:standup:dismissed:<YYYY-MM-DD>`. Server-truth перебивает —
//      если recorded=true, dismiss-state игнорируется.
//
// UX states:
//   - hidden:    условия не выполнены → не рендерим вообще.
//   - collapsed: одна строка «Morning standup ...» + chevron-кнопка раскрыть.
//     После того как юзер прочитал yesterday-recap и не хочет blockers
//     писать, может collapse'ить. На next mount уже рендерится expanded.
//   - expanded:  full-form с yesterday-recap (auto-prefill из queue.done)
//     и blockers-input. Save → POST /standup → unmount.
//   - submitted: после save схлопывается в «✓ Saved» на 2 секунды → unmount.
import { useEffect, useState } from 'react';

import { getTodayStandup, recordStandup } from '../api/hone';

const MORNING_CUTOFF_HOUR = 14; // local time: до 14:00 — утро

function todayKey(): string {
  // Local-time date (не UTC) — баннер привязан к восприятию юзера. Если
  // он в МСК открывает Hone в 11 утра, это его «morning», даже если в UTC
  // уже не утро.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isDismissedToday(): boolean {
  try {
    return window.localStorage.getItem(`hone:standup:dismissed:${todayKey()}`) === '1';
  } catch {
    return false;
  }
}

function markDismissedToday() {
  try {
    window.localStorage.setItem(`hone:standup:dismissed:${todayKey()}`, '1');
  } catch {
    /* private mode → fall back на server-side recorded flag */
  }
}

interface State {
  kind: 'hidden' | 'loading' | 'expanded' | 'collapsed' | 'submitted';
  yesterdayDone: string[];
  blockers: string;
  busy: boolean;
  error: string | null;
}

const INITIAL: State = {
  kind: 'loading',
  yesterdayDone: [],
  blockers: '',
  busy: false,
  error: null,
};

export function TodayStandupBanner() {
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    const hour = new Date().getHours();
    if (hour >= MORNING_CUTOFF_HOUR) {
      setState({ ...INITIAL, kind: 'hidden' });
      return;
    }
    if (isDismissedToday()) {
      setState({ ...INITIAL, kind: 'hidden' });
      return;
    }
    void getTodayStandup()
      .then((snap) => {
        if (cancelled) return;
        if (snap.recorded) {
          // Раньше тут было `kind: 'hidden'` → юзер записал standup и
          // banner ИСЧЕЗАЛ. Юзер просил наоборот: оставить summary-card
          // с подтверждением. Используем kind='submitted' но без auto-
          // unmount'а (см. ниже onSave + render).
          setState({ ...INITIAL, kind: 'submitted', yesterdayDone: snap.yesterdayDone });
          return;
        }
        setState({
          kind: 'expanded',
          yesterdayDone: snap.yesterdayDone,
          blockers: '',
          busy: false,
          error: null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Network blip — баннер не показываем (не блокируем Today).
        setState({ ...INITIAL, kind: 'hidden' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'hidden' || state.kind === 'loading') return null;

  const onSkip = () => {
    markDismissedToday();
    setState({ ...state, kind: 'hidden' });
  };

  const onCollapse = () => setState({ ...state, kind: 'collapsed' });
  const onExpand = () => setState({ ...state, kind: 'expanded' });

  const onSave = async () => {
    setState({ ...state, busy: true, error: null });
    try {
      // Yesterday — собираем из auto-prefill списка (юзер не редактировал
      // — confirm-only). Today — пусто (юзер заполняет Focus Queue ниже,
      // это наш today-intent). Blockers — из input'а.
      await recordStandup({
        yesterday: state.yesterdayDone.length > 0
          ? state.yesterdayDone.map((t) => `- ${t}`).join('\n')
          : '',
        today: '', // backend allows empty if остальные поля непустые
        blockers: state.blockers.trim(),
      });
      // No auto-unmount — юзер просил оставлять подтверждение видимым.
      // Раньше через 2 сек банер пропадал, юзер не видел что записалось
      // (особенно blockers). Теперь summary-card живёт до next-day refresh
      // или page-reload (на reload mount-probe видит recorded=true и снова
      // показывает submitted-state).
      setState({ ...state, kind: 'submitted', busy: false });
    } catch (e) {
      setState({ ...state, busy: false, error: (e as Error).message });
    }
  };

  if (state.kind === 'submitted') {
    return (
      <div
        className="fadein"
        style={{
          margin: '0 0 24px',
          padding: '14px 18px',
          borderRadius: 10,
          background: 'rgba(127,212,155,0.05)', // subtle green tint — confirmation
          border: '1px solid rgba(127,212,155,0.18)',
          fontSize: 13,
          color: 'var(--ink-60)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 11,
            letterSpacing: '0.18em',
            color: 'rgba(127,212,155,0.95)',
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          ✓ DONE
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'var(--ink-90)', fontWeight: 500, marginBottom: 4 }}>
            Morning standup recorded
          </div>
          {state.yesterdayDone.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-40)' }}>
              Yesterday: {state.yesterdayDone.length} task
              {state.yesterdayDone.length === 1 ? '' : 's'} finished
            </div>
          )}
          {state.blockers.trim() !== '' && (
            <div style={{ fontSize: 12, color: 'var(--ink-40)', marginTop: 2 }}>
              Blockers: {state.blockers.trim()}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--ink-40)', marginTop: 6 }}>
            Banner reappears tomorrow morning. Have a focused day.
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === 'collapsed') {
    return (
      <button
        onClick={onExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          margin: '0 0 24px',
          padding: '10px 16px',
          borderRadius: 10,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          color: 'var(--ink-60)',
          fontSize: 13,
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'background-color 160ms ease, color 160ms ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
      >
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--ink-40)' }}>
          MORNING STANDUP
        </span>
        <span style={{ flex: 1 }}>Quick recap of yesterday + today's blockers ›</span>
      </button>
    );
  }

  // expanded
  return (
    <div
      className="fadein"
      style={{
        margin: '0 0 32px',
        padding: '16px 20px 18px',
        borderRadius: 12,
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.22em', color: 'var(--ink-40)' }}>
          MORNING STANDUP
        </span>
        <button
          onClick={onCollapse}
          aria-label="Collapse"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--ink-40)',
            fontSize: 12,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ⌃ collapse
        </button>
      </div>

      {state.yesterdayDone.length > 0 ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-60)', marginBottom: 6 }}>
            Yesterday you finished:
          </div>
          <ul style={{ margin: 0, padding: '0 0 0 18px', listStyle: 'disc', color: 'var(--ink-90)', fontSize: 13, lineHeight: 1.55 }}>
            {state.yesterdayDone.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--ink-40)' }}>
          Yesterday: nothing logged. Fresh start today.
        </div>
      )}

      <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-60)', marginBottom: 6 }}>
        Anything blocking today?
      </label>
      <textarea
        value={state.blockers}
        onChange={(e) => setState({ ...state, blockers: e.target.value })}
        placeholder="Optional — e.g. waiting on review, flaky CI, …"
        rows={2}
        style={{
          width: '100%',
          padding: '8px 10px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 6,
          color: 'var(--ink)',
          fontSize: 13,
          outline: 'none',
          resize: 'vertical',
          fontFamily: 'inherit',
          lineHeight: 1.5,
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void onSave();
          }
        }}
      />

      {state.error && (
        <div className="mono" style={{ marginTop: 8, fontSize: 11, color: '#ff6a6a' }}>
          {state.error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button
          onClick={onSkip}
          disabled={state.busy}
          style={{
            padding: '7px 14px',
            background: 'transparent',
            border: 'none',
            color: 'var(--ink-40)',
            fontSize: 12,
            cursor: 'pointer',
            borderRadius: 6,
            transition: 'color 160ms ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink-90)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-40)')}
        >
          Skip
        </button>
        {(() => {
          const canSave =
            !state.busy &&
            (state.yesterdayDone.length > 0 || state.blockers.trim() !== '');
          return (
            <button
              onClick={() => void onSave()}
              disabled={!canSave}
              title={
                canSave
                  ? 'Save standup'
                  : 'Add a blocker or finish a task yesterday to save'
              }
              style={{
                padding: '7px 16px',
                borderRadius: 999,
                background: canSave ? '#fff' : 'rgba(255,255,255,0.08)',
                color: canSave ? '#000' : 'var(--ink-60)',
                border: 'none',
                fontSize: 12.5,
                fontWeight: 500,
                cursor: canSave ? 'pointer' : 'not-allowed',
              }}
            >
              {state.busy ? 'Saving…' : 'Save & continue'}
            </button>
          );
        })()}
      </div>
    </div>
  );
}
