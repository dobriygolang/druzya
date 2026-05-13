// «recently active» dot + aggregate counts (no other-student names,
// no event titles). Hidden entirely when student has zero tutors.
//
// Position на TodayPage: ниже primary goal / above the cards grid.
// B/W rule: status dot is `bg-text-primary/70` (white) for active,
// `bg-text-muted/40` for stale. Никаких green/red — accent reserved.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { Avatar } from './Avatar';
import { useMyTutorsActivityQuery, type MyTutorActivitySummary } from '../lib/queries/tutor';

// «Recently active» threshold — within 24h shows the bright dot.
const ACTIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
// «Inactive» threshold — past 14d shows «Last active Nd ago» footer text.
const INACTIVE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;

export function MyTutorsCard() {
  const q = useMyTutorsActivityQuery(7);
  const items = q.data?.items ?? [];

  // Edge case: zero tutors → hide entirely (anti-empty-state rule).
  // Loading state also renders nothing — the surface is non-critical
  // so a flash-of-skeleton would be more disruptive than the eventual
  // pop-in. Coach next-action card carries the page weight otherwise.
  if (q.isPending) return null;
  if (q.isError || items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          your tutors · {items.length}
        </h2>
        <Link
          to="/profile"
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted hover:text-text-primary"
        >
          manage
        </Link>
      </header>
      <ul className="flex flex-col gap-1.5">
        {items.map((it) => (
          <li key={it.tutor_user_id}>
            <TutorRow item={it} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TutorRow({ item }: { item: MyTutorActivitySummary }) {
  const now = useMemo(() => Date.now(), []);
  const lastActiveMs = item.last_active_at ? Date.parse(item.last_active_at) : NaN;
  const isFresh = Number.isFinite(lastActiveMs) && now - lastActiveMs < ACTIVE_THRESHOLD_MS;
  const isInactive =
    !Number.isFinite(lastActiveMs) || now - lastActiveMs > INACTIVE_THRESHOLD_MS;

  const initials = (item.tutor_display_name || item.tutor_username || '?')
    .trim()
    .charAt(0)
    .toUpperCase();

  const name = item.tutor_display_name || item.tutor_username || 'tutor';

  return (
    <Link
      to={`/tutor/${encodeURIComponent(item.tutor_user_id)}`}
      className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-2"
    >
      <div className="relative flex-shrink-0">
        <Avatar
          size="sm"
          src={item.tutor_avatar_url || undefined}
          initials={initials}
          alt={name}
        />
        {/* Status dot — subtle, top-right corner. B/W only. */}
        <span
          aria-hidden="true"
          className={`absolute -right-0.5 -top-0.5 block h-2 w-2 rounded-full ring-2 ring-surface-1 ${
            isFresh ? 'bg-text-primary' : 'bg-text-muted/40'
          }`}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium text-text-primary">{name}</span>
        <span className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {formatSubtitle(item, lastActiveMs, isInactive)}
        </span>
      </div>
    </Link>
  );
}

function formatSubtitle(
  item: MyTutorActivitySummary,
  lastActiveMs: number,
  isInactive: boolean,
): string {
  const parts: string[] = [];
  if (item.active_student_count_other > 0) {
    parts.push(
      `${item.active_student_count_other} other ${
        item.active_student_count_other === 1 ? 'student' : 'students'
      }`,
    );
  }
  if (Number.isFinite(lastActiveMs)) {
    parts.push(`last active ${relativeTime(Date.now() - lastActiveMs)}`);
  } else {
    parts.push('no events yet');
  }
  if (isInactive && Number.isFinite(lastActiveMs)) {
    // Already prefixed with «last active Nd ago» — no extra suffix needed.
  }
  return parts.join(' · ');
}

function relativeTime(deltaMs: number): string {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return 'just now';
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
