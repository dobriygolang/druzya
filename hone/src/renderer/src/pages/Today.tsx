// Today — dnevnoi AI-plan, realniy backend RPC.
//
// Три состояния: loading / error / ok. Loading рендерит плейсхолдеры с
// пустыми строками — layout не дёргается на resolve. Error — типизированные
// сообщения для Unauthenticated (dev-token hatch не установлен) /
// Unavailable (llmchain 503). Ok — реальные PlanItem'ы.
//
// Каждый элемент рендерит три строки: title, subtitle (one-liner причина),
// rationale (мотивирующий «closes your Graph gap progress=24»). Rationale
// опускается когда пусто (review/custom item'ы не привязаны к skill atlas).
//
// Pickup-pattern для focus'а: click по Start → родительский onStartFocus
// получает { planItemId, pinnedTitle } и отсылает App в focus-режим с
// привязанной сессией. Dismiss/Complete — inline, через `patchItem`,
// локальный refresh plan-state.
import { useEffect, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

import { Icon } from '../components/primitives/Icon';
import {
  getPlan,
  generatePlan,
  dismissPlanItem,
  completePlanItem,
  type Plan,
  type PlanItem,
} from '../api/hone';

export interface StartFocusArgs {
  planItemId?: string;
  pinnedTitle?: string;
}

interface TodayPageProps {
  onStartFocus: (args?: StartFocusArgs) => void;
}

interface FetchState {
  status: 'loading' | 'ok' | 'error';
  plan: Plan | null;
  error: string | null;
  errorCode: Code | null;
}

const INITIAL: FetchState = { status: 'loading', plan: null, error: null, errorCode: null };

// Человеко-читаемый хэдер «FRIDAY · APR 25» локально, без i18n-либы —
// в v0 интерфейс на английском, дата стабильна в формате EN-US.
function formatHeader(d: Date): string {
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}`;
}

export function TodayPage({ onStartFocus }: TodayPageProps) {
  const [state, setState] = useState<FetchState>(INITIAL);
  const [busy, setBusy] = useState<string | null>(null); // id того item'а, по которому идёт mutation

  useEffect(() => {
    let cancelled = false;
    setState(INITIAL);
    getPlan()
      .then((plan) => {
        if (cancelled) return;
        setState({ status: 'ok', plan, error: null, errorCode: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(err);
        // NotFound = плана ещё нет на сегодня. Рендерим "ok" с пустым
        // items-массивом + кнопкой Generate — это нормальный empty-state.
        if (ce.code === Code.NotFound) {
          setState({
            status: 'ok',
            plan: { id: '', date: '', regeneratedAt: null, items: [] },
            error: null,
            errorCode: null,
          });
          return;
        }
        setState({
          status: 'error',
          plan: null,
          error: ce.rawMessage || ce.message,
          errorCode: ce.code,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleGenerate = async (force: boolean) => {
    setBusy('__generate');
    try {
      const plan = await generatePlan(force);
      setState({ status: 'ok', plan, error: null, errorCode: null });
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: ce.rawMessage || ce.message,
        errorCode: ce.code,
      }));
    } finally {
      setBusy(null);
    }
  };

  const handleDismiss = async (itemId: string) => {
    setBusy(itemId);
    try {
      const plan = await dismissPlanItem(itemId);
      setState((prev) => ({ ...prev, plan }));
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setState((prev) => ({
        ...prev,
        error: ce.rawMessage || ce.message,
        errorCode: ce.code,
      }));
    } finally {
      setBusy(null);
    }
  };

  const handleComplete = async (itemId: string) => {
    setBusy(itemId);
    try {
      const plan = await completePlanItem(itemId);
      setState((prev) => ({ ...prev, plan }));
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setState((prev) => ({
        ...prev,
        error: ce.rawMessage || ce.message,
        errorCode: ce.code,
      }));
    } finally {
      setBusy(null);
    }
  };

  const items = state.plan?.items.filter((i) => !i.dismissed) ?? [];
  const header = formatHeader(new Date());

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: 620, maxWidth: '90%', padding: '0 16px' }}>
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--ink-40)' }}
        >
          {header}
        </div>
        <h1
          style={{
            margin: '20px 0 0',
            fontSize: 44,
            fontWeight: 400,
            letterSpacing: '-0.03em',
            lineHeight: 1.08,
          }}
        >
          What will you hone today?
        </h1>

        {state.status === 'loading' && (
          <p style={{ marginTop: 48, fontSize: 14, color: 'var(--ink-40)' }}>
            Gathering today’s plan…
          </p>
        )}

        {state.status === 'error' && (
          <div style={{ marginTop: 48 }}>
            <p style={{ fontSize: 14, color: 'var(--ink-60)' }}>{errorHeadline(state.errorCode)}</p>
            {state.error && (
              <p
                className="mono"
                style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-40)' }}
              >
                {state.error}
              </p>
            )}
          </div>
        )}

        {state.status === 'ok' && items.length === 0 && (
          <div style={{ marginTop: 48 }}>
            <p style={{ fontSize: 14, color: 'var(--ink-60)' }}>
              No plan yet for today. Generate one from your Skill Atlas.
            </p>
            <button
              onClick={() => handleGenerate(false)}
              disabled={busy === '__generate'}
              className="focus-ring"
              style={{
                marginTop: 16,
                padding: '9px 18px',
                borderRadius: 999,
                background: busy === '__generate' ? 'rgba(255,255,255,0.08)' : '#fff',
                color: busy === '__generate' ? 'var(--ink-60)' : '#000',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {busy === '__generate' ? 'Generating…' : 'Generate plan'}
            </button>
          </div>
        )}

        {state.status === 'ok' && items.length > 0 && (
          <>
            <ul style={{ listStyle: 'none', margin: '56px 0 0', padding: 0 }}>
              {items.map((it) => (
                <TodayRow
                  key={it.id}
                  item={it}
                  busy={busy === it.id}
                  onStart={() => onStartFocus({ planItemId: it.id, pinnedTitle: it.title })}
                  onDismiss={() => handleDismiss(it.id)}
                  onComplete={() => handleComplete(it.id)}
                />
              ))}
            </ul>

            <div style={{ marginTop: 48, display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                onClick={() => onStartFocus()}
                className="focus-ring"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '11px 20px',
                  borderRadius: 999,
                  background: '#fff',
                  color: '#000',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                Start focus <Icon name="arrow" size={12} />
              </button>
              <button
                onClick={() => handleGenerate(true)}
                disabled={busy === '__generate'}
                className="focus-ring mono"
                style={{
                  padding: '9px 14px',
                  borderRadius: 999,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--ink-60)',
                  fontSize: 11,
                  letterSpacing: '.08em',
                }}
              >
                {busy === '__generate' ? 'REGENERATING…' : '⟳ REGENERATE'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface TodayRowProps {
  item: PlanItem;
  busy: boolean;
  onStart: () => void;
  onDismiss: () => void;
  onComplete: () => void;
}

function TodayRow({ item, busy, onStart, onDismiss, onComplete }: TodayRowProps) {
  const faded = item.completed ? 0.4 : 1;
  return (
    <li
      style={{
        padding: '26px 0',
        opacity: busy ? 0.5 : faded,
        transition: 'opacity 120ms linear',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 17,
              color: 'var(--ink)',
              letterSpacing: '-0.005em',
              textDecoration: item.completed ? 'line-through' : 'none',
            }}
          >
            {item.title}
          </div>
          {item.subtitle && (
            <div style={{ fontSize: 13, color: 'var(--ink-40)', marginTop: 8 }}>
              {item.subtitle}
            </div>
          )}
          {item.rationale && (
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--ink-40)',
                marginTop: 6,
                letterSpacing: '.01em',
              }}
            >
              ✦ {item.rationale}
            </div>
          )}
        </div>
        <TodayRowActions
          busy={busy}
          completed={item.completed}
          onStart={onStart}
          onDismiss={onDismiss}
          onComplete={onComplete}
        />
      </div>
    </li>
  );
}

interface ActionsProps {
  busy: boolean;
  completed: boolean;
  onStart: () => void;
  onDismiss: () => void;
  onComplete: () => void;
}

function TodayRowActions({ busy, completed, onStart, onDismiss, onComplete }: ActionsProps) {
  const btn = (label: string, handler: () => void, opacity = 0.6) => (
    <button
      onClick={handler}
      disabled={busy}
      className="focus-ring mono"
      style={{
        padding: '5px 9px',
        fontSize: 10,
        letterSpacing: '.12em',
        color: `rgba(255,255,255,${opacity})`,
        borderRadius: 6,
        background: 'transparent',
      }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
      {!completed && btn('FOCUS', onStart, 0.9)}
      {!completed && btn('DONE', onComplete)}
      {btn('SKIP', onDismiss)}
    </div>
  );
}

function errorHeadline(code: Code | null): string {
  switch (code) {
    case Code.Unauthenticated:
      return 'Sign in to see your plan.';
    case Code.Unavailable:
      return 'AI is resting — plan generator is offline.';
    case Code.ResourceExhausted:
      return 'Regenerations limited: try again in a few minutes.';
    default:
      return 'Could not load your plan right now.';
  }
}
