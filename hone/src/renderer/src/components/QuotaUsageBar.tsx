// QuotaUsageBar — компактный «3 / 10» индикатор с прогресс-полоской.
//
// Используется:
//   - Sidebar в Notes / SharedBoards / CodeRooms (variant="compact")
//   - Settings → Subscription (variant="full" с подписью)
//
// Визуально: тонкая полоска под цифрой usage. На 80%+ — accent цвет,
// на 100% — danger. -1 в quota = unlimited (не отображаем bar, только «3»).
import { useQuotaStore, type QuotaPolicy, type QuotaUsage } from '../stores/quota';

export type QuotaResource = 'synced_notes' | 'active_shared_boards' | 'active_shared_rooms' | 'ai_this_month';

const LABELS: Record<QuotaResource, string> = {
  synced_notes: 'Synced notes',
  active_shared_boards: 'Shared boards',
  active_shared_rooms: 'Shared rooms',
  ai_this_month: 'AI calls this month',
};

// Compact-mode prefix — короткий лейбл рядом с цифрой, чтоб юзер понимал
// что quota меряет ТОЛЬКО SHARED rooms/boards, а не все. Раньше показывалось
// «2 OVER LIMIT 1» рядом с sidebar в котором 6 комнат — выглядело как баг,
// хотя 4 из 6 были private (не считались в quota).
const COMPACT_PREFIX: Record<QuotaResource, string> = {
  synced_notes: 'SYNCED',
  active_shared_boards: 'SHARED',
  active_shared_rooms: 'SHARED',
  ai_this_month: 'AI',
};

interface QuotaUsageBarProps {
  resource: QuotaResource;
  variant?: 'compact' | 'full';
}

export function QuotaUsageBar({ resource, variant = 'compact' }: QuotaUsageBarProps) {
  const policy = useQuotaStore((s) => s.policy);
  const usage = useQuotaStore((s) => s.usage);

  const used = readUsage(usage, resource);
  const limit = readPolicyLimit(policy, resource);
  const isUnlimited = limit < 0;
  const pct = isUnlimited ? 0 : limit === 0 ? 0 : Math.min(100, (used / limit) * 100);

  const color =
    pct >= 100
      ? '#ff6a6a'
      : pct >= 80
      ? '#ffaa55'
      : 'var(--ink-60)';

  // Over-limit state: показываем «N · LIMIT 1» с явным индикатором что
  // юзер за пределами free-tier'а. Раньше отображалось просто «2 / 1» —
  // выглядело как UI bug. Это легитимный over-quota state (легаси rooms
  // или enforce'мент пропускал какую-то ветку), и UX должен дать понять
  // что upgrade нужен.
  const overLimit = !isUnlimited && limit > 0 && used > limit;

  if (variant === 'compact') {
    return (
      <div
        className="mono"
        title={
          isUnlimited
            ? `${LABELS[resource]}: ${used} (unlimited)`
            : overLimit
              ? `${LABELS[resource]}: ${used} (over limit ${limit} — upgrade)`
              : `${LABELS[resource]}: ${used} / ${limit}`
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          fontSize: 9,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: color,
        }}
      >
        <span>
          <span style={{ opacity: 0.45, marginRight: 6 }}>{COMPACT_PREFIX[resource]}</span>
          {used}
          {!isUnlimited && !overLimit && <span style={{ opacity: 0.5 }}>{` / ${limit}`}</span>}
          {overLimit && <span style={{ opacity: 0.7 }}>{` · OVER LIMIT ${limit}`}</span>}
        </span>
        {!isUnlimited && (
          <div
            aria-hidden
            style={{
              flex: 1,
              height: 2,
              borderRadius: 1,
              background: 'rgba(255,255,255,0.06)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                width: `${pct}%`,
                background: color,
                transition: 'width 220ms ease, background-color 220ms ease',
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // full variant
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-90)' }}>
        <span>{LABELS[resource]}</span>
        <span className="mono" style={{ color }}>
          {used}
          {!isUnlimited && !overLimit && <span style={{ opacity: 0.5 }}>{` / ${limit}`}</span>}
          {overLimit && <span style={{ opacity: 0.7 }}>{` · over limit ${limit}`}</span>}
          {isUnlimited && <span style={{ opacity: 0.5 }}> (unlimited)</span>}
        </span>
      </div>
      {!isUnlimited && (
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
              width: `${pct}%`,
              background: color,
              transition: 'width 220ms ease, background-color 220ms ease',
            }}
          />
        </div>
      )}
    </div>
  );
}

function readUsage(u: QuotaUsage, r: QuotaResource): number {
  switch (r) {
    case 'synced_notes': return u.synced_notes;
    case 'active_shared_boards': return u.active_shared_boards;
    case 'active_shared_rooms': return u.active_shared_rooms;
    case 'ai_this_month': return u.ai_this_month;
  }
}

function readPolicyLimit(p: QuotaPolicy, r: QuotaResource): number {
  switch (r) {
    case 'synced_notes': return p.synced_notes;
    case 'active_shared_boards': return p.active_shared_boards;
    case 'active_shared_rooms': return p.active_shared_rooms;
    case 'ai_this_month': return p.ai_monthly;
  }
}
