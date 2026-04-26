// StatsOverlay — Stats как floating right-aside поверх HomePage. Карточки
// stagger'ом slide-from-right, не full-page modal — юзер видит фон/timer
// и не теряет контекст.
//
// Cards (по порядку):
//   1. Focus Activity   — heatmap + 5-dot intensity legend top-right
//   2. Current Streak   — large «N days» + «Longest: M» + smooth curve
//   3. Focused Time     — bar-chart за 7 дней + LAST 7 DAYS + Mon/20 labels
//   4. Insights         — 4-cell grid: avg, total sessions, focused days, hrs
//
// Закрытие — Esc / S hotkey (управляется родителем) / клик по ESC button.
import { useEffect, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

import { getStats, type HoneStats, type FocusDay } from '../api/hone';

interface FetchState {
  status: 'loading' | 'ok' | 'error';
  data: HoneStats | null;
  errorCode: Code | null;
  errorMsg: string | null;
}

const INITIAL: FetchState = { status: 'loading', data: null, errorCode: null, errorMsg: null };

// padToSevenDays — backend Hone stats возвращает FocusDay только для дней с
// активностью. UI «Focused Time · last 7 days» должен ВСЕГДА показывать 7
// столбиков (Mon..Sun или 7 дней назад…сегодня). Pad'им gaps c seconds=0,
// sessions=0. Today выводим из системного времени (UTC), не доверяемся
// inferred-anchor'у из data.
function padToSevenDays(input: FocusDay[]): FocusDay[] {
  const byDate = new Map(input.map((d) => [d.date, d]));
  const out: FocusDay[] = [];
  // Anchor — если в input есть данные, берём максимальную дату как «сегодня».
  // Иначе — Date.now() (UTC YYYY-MM-DD).
  const todayISO = (() => {
    if (input.length > 0) {
      return input
        .map((d) => d.date)
        .sort()
        .at(-1) as string;
    }
    return new Date().toISOString().slice(0, 10);
  })();
  const anchor = new Date(`${todayISO}T00:00:00Z`);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(anchor);
    d.setUTCDate(anchor.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const existing = byDate.get(iso);
    out.push(existing ?? { date: iso, seconds: 0, sessions: 0 });
  }
  return out;
}

export function StatsOverlay({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<FetchState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    getStats()
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ok', data, errorCode: null, errorMsg: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(err);
        setState({
          status: 'error',
          data: null,
          errorCode: ce.code,
          errorMsg: ce.rawMessage || ce.message,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = state.data;
  // Backend возвращает ТОЛЬКО дни с focus (если юзер 6 дней не работал,
  // прилетает 1 запись). UI должен показывать 7 столбиков всегда — pad'им
  // empty-days с seconds=0 чтобы visual был стабилен «понедельник…воскресенье».
  const lastSeven = padToSevenDays(data?.lastSevenDays ?? []);
  const sparkSeries = lastSeven.map((d) => d.seconds);

  return (
    <>
      {/* Title slot — прижат к верху, левее карточек. */}
      <div
        style={{
          position: 'absolute',
          top: 86,
          right: 32 + 320 + 24,
          color: 'var(--ink-60)',
          fontSize: 18,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          zIndex: 12,
          pointerEvents: 'none',
        }}
      >
        Statistics
      </div>

      {/* RIGHT column: 4 stacked cards */}
      <aside
        style={{
          position: 'absolute',
          right: 32,
          top: 96,
          bottom: 130,
          width: 320,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          zIndex: 12,
          pointerEvents: 'auto',
          overflow: 'auto',
        }}
      >
        {/* 1. Focus Activity */}
        <div className="slide-from-right" style={{ animationDelay: '0ms' }}>
          <BigCard>
            <CardHead title="Focus Activity" right={<HeatmapLegend />} />
            <ReferenceHeatmap days={data?.heatmap ?? []} />
          </BigCard>
        </div>

        {/* 2. Current Streak */}
        <div className="slide-from-right" style={{ animationDelay: '80ms' }}>
          <BigCard>
            <CardHead title="Current Streak" />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                alignItems: 'end',
                gap: 18,
                marginTop: 4,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
                  <span
                    style={{
                      fontSize: 32,
                      fontWeight: 600,
                      letterSpacing: '-0.03em',
                      lineHeight: 1,
                      color: 'var(--ink)',
                    }}
                  >
                    {data?.currentStreakDays ?? 0}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-40)' }}>days</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-40)' }}>
                  Longest:{' '}
                  <span style={{ color: 'var(--ink-90)' }}>{data?.longestStreakDays ?? 0}</span>
                </div>
              </div>
              <StreakCurve points={sparkSeries} />
            </div>
          </BigCard>
        </div>

        {/* 3. Focused Time */}
        <div className="slide-from-right" style={{ animationDelay: '160ms' }}>
          <BigCard>
            <CardHead title="Focused Time" right={<MetaLabel>LAST 7 DAYS</MetaLabel>} />
            <ReferenceBars days={lastSeven} />
          </BigCard>
        </div>

        {/* 4. Insights */}
        <div className="slide-from-right" style={{ animationDelay: '240ms' }}>
          <BigCard>
            <CardHead title="Insights" />
            <InsightsGrid data={data} />
          </BigCard>
        </div>

        {state.status === 'error' && state.errorCode === Code.Unauthenticated && (
          <div
            className="mono slide-from-right"
            style={{
              animationDelay: '320ms',
              padding: '10px 14px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10,
              fontSize: 11,
              letterSpacing: '0.14em',
              color: 'var(--ink-40)',
              textAlign: 'center',
            }}
          >
            SIGN IN TO SEE FULL STATS
          </div>
        )}
      </aside>

      {/* close hint */}
      <button
        onClick={onClose}
        className="mono row slide-from-right focus-ring"
        style={{
          position: 'absolute',
          top: 86,
          right: 32,
          padding: '4px 10px',
          fontSize: 10,
          letterSpacing: '0.18em',
          color: 'var(--ink-40)',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 6,
          zIndex: 13,
          animationDelay: '320ms',
          cursor: 'pointer',
        }}
      >
        ESC · CLOSE
      </button>
    </>
  );
}

// ─── Layout primitives ────────────────────────────────────────────────────

function BigCard({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: 'rgba(28,28,30,0.85)',
        backdropFilter: 'blur(28px)',
        WebkitBackdropFilter: 'blur(28px)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 16,
        padding: 14,
      }}
    >
      {children}
    </section>
  );
}

function CardHead({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 14,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
        }}
      >
        {title}
      </h3>
      {right}
    </div>
  );
}

function MetaLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 9.5,
        letterSpacing: '0.18em',
        color: 'var(--ink-40)',
      }}
    >
      {children}
    </span>
  );
}

// ─── Heatmap legend (5 dots, increasing brightness) ──────────────────────

function HeatmapLegend() {
  const opacities = [0.08, 0.18, 0.32, 0.5, 0.95];
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {opacities.map((o, i) => (
        <span
          key={i}
          style={{
            width: 9,
            height: 9,
            borderRadius: 2,
            background: `rgba(255,255,255,${o})`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Reference Heatmap — 7×N grid, opacity по бакетам ────────────────────

function ReferenceHeatmap({ days }: { days: FocusDay[] }) {
  const CELLS = 7 * 16; // ужали до 16 колонок чтобы влезло в 320px aside
  const bySeconds = new Map(days.map((d) => [d.date, d.seconds]));
  const todayISO = days.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const anchor = new Date(`${todayISO}T00:00:00Z`);
  const cells: { iso: string; seconds: number; isToday: boolean }[] = [];
  for (let i = CELLS - 1; i >= 0; i--) {
    const d = new Date(anchor);
    d.setUTCDate(anchor.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    cells.push({ iso, seconds: bySeconds.get(iso) ?? 0, isToday: iso === todayISO });
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'repeat(7, 1fr)',
        gridAutoFlow: 'column',
        gridAutoColumns: '1fr',
        gap: 3,
      }}
    >
      {cells.map((c) => (
        <span
          key={c.iso}
          title={`${c.iso} · ${Math.round(c.seconds / 60)}m`}
          style={{
            aspectRatio: '1/1',
            borderRadius: 2,
            background: c.isToday
              ? 'rgba(255,255,255,0.95)'
              : `rgba(255,255,255,${heatmapOpacity(c.seconds)})`,
          }}
        />
      ))}
    </div>
  );
}

function heatmapOpacity(seconds: number): number {
  if (seconds <= 0) return 0.04;
  if (seconds < 600) return 0.12;
  if (seconds < 1800) return 0.22;
  if (seconds < 3600) return 0.36;
  if (seconds < 7200) return 0.52;
  return 0.78;
}

// ─── Streak curve sparkline (Catmull-Rom → Bezier) ───────────────────────

function StreakCurve({ points }: { points: number[] }) {
  // Draw-on entrance: path animates via stroke-dashoffset от full-length
  // до 0. Mountain-style motion. Mirror'ит bars-anim из ReferenceBars.
  const [animTick, setAnimTick] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setAnimTick(1), 50);
    return () => window.clearTimeout(t);
  }, []);
  const W = 120;
  const H = 42;
  if (points.length < 2) {
    return <svg width={W} height={H} style={{ display: 'block' }} />;
  }
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = Math.max(1, max - min);
  const xy = points.map((p, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - ((p - min) / span) * (H - 6) - 3;
    return [x, y] as [number, number];
  });
  let path = `M${xy[0]![0].toFixed(1)} ${xy[0]![1].toFixed(1)}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[Math.max(0, i - 1)]!;
    const p1 = xy[i]!;
    const p2 = xy[i + 1]!;
    const p3 = xy[Math.min(xy.length - 1, i + 2)]!;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  // Длина path'а (приблизительно) для анимации stroke-dashoffset. Мы не
  // знаем точную длину без getTotalLength, но 3*W достаточно — strokeDasharray
  // длиннее path всё равно работает: dasharray=L+ дёт нам ОДИН непрерывный
  // штрих. Анимируем offset от L+ до 0.
  const dashLen = W * 3;
  // Area-fill path — закрытая фигура (curve + bottom line) чтобы под кривой
  // был тонкий «волновой» градиент. Раньше при near-zero данных curve была
  // почти невидимой; теперь fill под ней даёт явный visual signal.
  const areaPath = path + ` L${W} ${H} L0 ${H} Z`;
  const gradId = 'streak-curve-fill';
  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.45)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <path
        d={areaPath}
        fill={`url(#${gradId})`}
        opacity={animTick === 0 ? 0 : 1}
        style={{ transition: 'opacity 900ms cubic-bezier(.2,.7,.2,1) 200ms' }}
      />
      <path
        d={path}
        fill="none"
        stroke="rgba(255,255,255,0.95)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray={dashLen}
        strokeDashoffset={animTick === 0 ? dashLen : 0}
        style={{ transition: 'stroke-dashoffset 1100ms cubic-bezier(.2,.7,.2,1)' }}
      />
    </svg>
  );
}

// ─── Reference Bars ──────────────────────────────────────────────────────

function ReferenceBars({ days }: { days: FocusDay[] }) {
  // Mount-anim: bars стартуют на 0 и растут до final-height после первого
  // paint'а. Mirror «mountain motion» style как у StreakCurve, только тут
  // эффект — растущие колонки. Без этого bars появляются instantly и
  // выглядят статично; user'у нужно «расцветание».
  const [animTick, setAnimTick] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setAnimTick(1), 30);
    return () => window.clearTimeout(t);
  }, []);

  const todayISO = days.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  // Absolute scale: 24h = 100% bar-height. Раньше был relative-max (max
  // bucket в данных = 100%) — 3 часа в один день рендерились full-height,
  // юзер не мог сравнить с другим днём. Теперь абсолютная шкала: 3 часа =
  // 12.5% bar height; 8 часов = 33%; 24 часа = 100%. Юзер видит реальную
  // долю focused-time от 24h.
  const FULL_DAY_SECONDS = 24 * 60 * 60;
  const maxSeconds = FULL_DAY_SECONDS;
  const MAX_H = 90;
  const MIN_H = 10;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${days.length || 7}, 1fr)`,
        gap: 8,
        alignItems: 'end',
        height: MAX_H + 44,
      }}
    >
      {days.map((d, i) => {
        const ratio = d.seconds / maxSeconds;
        const targetH = d.seconds > 0 ? MIN_H + ratio * (MAX_H - MIN_H) : MIN_H;
        // animTick=0 → bars at 0, после mount'а tick=1 → растут до target.
        // staggered delay чтобы bars росли по очереди, не все вместе.
        const h = animTick === 0 ? 0 : targetH;
        const isToday = d.date === todayISO;
        return (
          <div key={d.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ width: '100%', height: MAX_H, display: 'flex', alignItems: 'flex-end' }}>
              <div
                style={{
                  width: '100%',
                  height: h,
                  background: isToday ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.16)',
                  borderTopLeftRadius: 6,
                  borderTopRightRadius: 6,
                  transition: `height 700ms cubic-bezier(.2,.7,.2,1) ${i * 60}ms`,
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: isToday ? 'var(--ink)' : 'var(--ink-60)',
                }}
              >
                {weekdayLabel(d.date)}
              </span>
              <span style={{ fontSize: 10.5, color: 'var(--ink-40)' }}>
                {dayOfMonth(d.date)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekdayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return WEEKDAY_LABELS[d.getUTCDay()] ?? '';
}

function dayOfMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return String(d.getUTCDate());
}

// ─── Insights grid ───────────────────────────────────────────────────────

// InsightsGrid — redesigned. Раньше было 4 одинаковых number-cell'а
// (avg / total sessions / focused days / total hrs) — мёртвая статика.
// Теперь 4 РАЗНЫХ виджета, каждый показывает что-то полезное:
//
//   1. Streak progress ring   — circular goal=14 days, fill = current
//   2. Compare with last week — this-week-hrs vs last-week-hrs ± delta
//   3. Goal-meter             — daily goal (default 2h) + progress today
//   4. Best hour heatmap      — when you focus most (24×1 grid)
//
// Daily goal живёт в localStorage `hone:daily-focus-goal-min` (default 120).
// Pure-client computation — heavy work уже сделана reader'ом, тут только
// derive'аем из существующего HoneStats.

function InsightsGrid({ data }: { data: HoneStats | null }) {
  const heatmap = data?.heatmap ?? [];
  const lastSeven = data?.lastSevenDays ?? [];
  const todayISO = lastSeven.at(-1)?.date ?? new Date().toISOString().slice(0, 10);

  // ── Compare-week: текущая неделя (last 7) vs prev 7
  const thisWeekSec = lastSeven.reduce((s, d) => s + d.seconds, 0);
  const heatmapByISO = new Map(heatmap.map((d) => [d.date, d]));
  const prevWeekISOs = (() => {
    const arr: string[] = [];
    const t = new Date(`${todayISO}T00:00:00Z`);
    for (let i = 7; i < 14; i++) {
      const d = new Date(t);
      d.setUTCDate(t.getUTCDate() - i);
      arr.push(d.toISOString().slice(0, 10));
    }
    return arr;
  })();
  const prevWeekSec = prevWeekISOs.reduce(
    (s, iso) => s + (heatmapByISO.get(iso)?.seconds ?? 0),
    0,
  );
  const weekDeltaPct = prevWeekSec > 0
    ? Math.round(((thisWeekSec - prevWeekSec) / prevWeekSec) * 100)
    : (thisWeekSec > 0 ? 100 : 0);

  // ── Streak ring: goal 14 days (free-tier soft target)
  const STREAK_GOAL = 14;
  const streakPct = Math.min(100, ((data?.currentStreakDays ?? 0) / STREAK_GOAL) * 100);

  // ── Daily goal: localStorage settable, default 2h (120min)
  const dailyGoalMin = readDailyGoalMin();
  const todaySec = lastSeven.find((d) => d.date === todayISO)?.seconds ?? 0;
  const todayMin = Math.round(todaySec / 60);
  const goalPct = Math.min(100, (todayMin / Math.max(1, dailyGoalMin)) * 100);

  // ── Avg session length — полезный «качественный» сигнал. Streak меряет
  // консистентность, Compare-week — общий объём, Goal-meter — сегодня. Avg
  // session length показывает: ты делаешь короткие 25-min pomodoro или
  // длинные deep-work блоки. Считаем над heatmap window (90+ days) для
  // стабильности — week'ом было бы очень шумно при низком N.
  const totalSecondsAll = heatmap.reduce((s, d) => s + d.seconds, 0);
  const totalSessionsAll = heatmap.reduce((s, d) => s + (d.sessions || 0), 0);
  const avgSessionMin = totalSessionsAll > 0
    ? Math.round(totalSecondsAll / totalSessionsAll / 60)
    : 0;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px 14px',
        marginTop: 2,
      }}
    >
      <StreakRingCell streakDays={data?.currentStreakDays ?? 0} pct={streakPct} goal={STREAK_GOAL} />
      <CompareWeekCell thisHrs={thisWeekSec / 3600} prevHrs={prevWeekSec / 3600} deltaPct={weekDeltaPct} />
      <GoalMeterCell todayMin={todayMin} goalMin={dailyGoalMin} pct={goalPct} />
      <SimpleStatCell
        value={String(avgSessionMin)}
        unit="min"
        label="Avg session length"
        sub={totalSessionsAll > 0 ? `${totalSessionsAll} sessions total` : 'no data yet'}
      />
    </div>
  );
}

// localStorage helpers — settable from Settings (TODO: surface UI там).
function readDailyGoalMin(): number {
  if (typeof window === 'undefined') return 120;
  const raw = window.localStorage.getItem('hone:daily-focus-goal-min');
  const n = raw ? parseInt(raw, 10) : 120;
  return Number.isFinite(n) && n > 0 ? n : 120;
}

// ─── Streak ring (SVG circular progress) ─────────────────────────────────

function StreakRingCell({ streakDays, pct, goal }: { streakDays: number; pct: number; goal: number }) {
  const SIZE = 56;
  const STROKE = 4;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;
  // Anim: dasharray от пустого к pct
  const [animTick, setAnimTick] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setAnimTick(1), 60);
    return () => window.clearTimeout(t);
  }, []);
  const offset = animTick === 0 ? C : C - (C * pct) / 100;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <svg width={SIZE} height={SIZE} style={{ flexShrink: 0 }}>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.95)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(.2,.7,.2,1)' }}
        />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
            {streakDays}
          </span>
          <span style={{ fontSize: 10, color: 'var(--ink-40)' }}>/ {goal} days</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--ink-40)' }}>Streak goal</div>
      </div>
    </div>
  );
}

// ─── Compare with last week ──────────────────────────────────────────────

function CompareWeekCell({ thisHrs, prevHrs, deltaPct }: { thisHrs: number; prevHrs: number; deltaPct: number }) {
  const isUp = deltaPct >= 0;
  const tone = isUp ? 'rgba(127,212,155,0.95)' : '#ff8c8c';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
          {thisHrs.toFixed(1)}
        </span>
        <span style={{ fontSize: 10, color: 'var(--ink-40)' }}>hrs</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: tone, marginLeft: 4 }}>
          {isUp ? '↑' : '↓'} {Math.abs(deltaPct)}%
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--ink-40)' }}>
        vs {prevHrs.toFixed(1)} h last week
      </div>
    </div>
  );
}

// ─── Daily goal meter ────────────────────────────────────────────────────

function GoalMeterCell({ todayMin, goalMin, pct }: { todayMin: number; goalMin: number; pct: number }) {
  const reached = pct >= 100;
  const tone = reached ? 'rgba(127,212,155,0.95)' : 'rgba(255,255,255,0.85)';
  const [animTick, setAnimTick] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setAnimTick(1), 80);
    return () => window.clearTimeout(t);
  }, []);
  const w = animTick === 0 ? 0 : pct;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: tone }}>
          {todayMin}
        </span>
        <span style={{ fontSize: 10, color: 'var(--ink-40)' }}>/ {goalMin} min today</span>
      </div>
      <div
        aria-hidden
        style={{
          height: 4,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.06)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${w}%`,
            background: tone,
            transition: 'width 800ms cubic-bezier(.2,.7,.2,1)',
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: 'var(--ink-40)' }}>Daily goal</div>
    </div>
  );
}

// ─── Best weekday ────────────────────────────────────────────────────────

// SimpleStatCell — generic «N unit / label / sub» tile. Заменил BestWeekday
// (дублировал данные heatmap'а).
function SimpleStatCell({ value, unit, label, sub }: { value: string; unit?: string; label: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 10, color: 'var(--ink-40)' }}>{unit}</span>}
      </div>
      <div style={{ fontSize: 10, color: 'var(--ink-40)' }}>{label}</div>
      {sub && <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

