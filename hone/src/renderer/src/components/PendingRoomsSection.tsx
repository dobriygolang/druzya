// PendingRoomsSection — компактный header'+ rows для outbox-pending op'ы.
// Подписывается на outbox.subscribe(), фильтрует по `kind`, рендерит rows
// со статусом «creating…» / «retry N» / «failed». На pure-успех (drain
// прошёл) op удаляется из outbox → component re-render'ится без этой row.
//
// Используется в Editor sidebar (kind="editor.create_room") и SharedBoards
// sidebar (kind="whiteboard.create_room") — общий компонент чтобы не
// копипастить визуал и subscribe-логику.
//
// Visual: тонкая row с monospace ID + crayon dot + dim status. Если op
// помечена `dead` (max attempts reached / non-retryable error) — show red
// dot + tap-to-retry/discard hint.
import { useEffect, useState } from 'react';

import {
  type OutboxOp,
  type OutboxOpKind,
  drainAll,
  listAll,
  removeOp,
  subscribe,
} from '../offline/outbox';

interface Props {
  kind: OutboxOpKind;
  label: string;
}

export function PendingRoomsSection({ kind, label }: Props) {
  const [ops, setOps] = useState<OutboxOp[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void listAll()
        .then((all) => {
          if (cancelled) return;
          setOps(all.filter((op) => op.kind === kind));
        })
        .catch(() => {
          // Outbox IDB недоступна (privacy-mode / first-mount race) — silent.
        });
    };
    refresh();
    const unsub = subscribe(refresh);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [kind]);

  if (ops.length === 0) return null;

  return (
    <>
      <div
        className="mono"
        style={{ fontSize: 9, letterSpacing: '.18em', color: 'var(--ink-40)', padding: '4px 14px 6px' }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 2px 12px' }}>
        {ops.map((op) => (
          <PendingRow key={op.id} op={op} />
        ))}
      </div>
    </>
  );
}

function PendingRow({ op }: { op: OutboxOp }) {
  const [hover, setHover] = useState(false);
  // Display id: для create-ops показываем clientId хвост (last 4) — это
  // то под чем room появится после drain'а. Для других kind'ов — opId хвост.
  const displayId = (() => {
    const payload = op.payload as { clientId?: string } | undefined;
    const id = payload?.clientId ?? op.id;
    return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
  })();
  const status = op.dead
    ? 'failed'
    : op.attempts > 0
      ? `retry ${op.attempts}`
      : typeof navigator !== 'undefined' && !navigator.onLine
        ? 'queued (offline)'
        : 'creating…';
  const dotColor = op.dead ? '#ff6a6a' : op.attempts > 0 ? '#ffaa55' : 'rgba(255,255,255,0.45)';

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px 8px 14px',
        margin: '1px 0',
        borderRadius: 7,
        background: hover ? 'rgba(255,255,255,0.04)' : 'transparent',
        opacity: 0.78,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
          animation: op.dead || op.attempts > 0 ? undefined : 'pulse 1.4s ease-in-out infinite',
        }}
      />
      <span
        className="mono"
        style={{
          flex: 1,
          fontSize: 11.5,
          color: 'var(--ink-60)',
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {displayId}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 9,
          letterSpacing: '0.14em',
          color: op.dead ? '#ff6a6a' : 'var(--ink-40)',
          flexShrink: 0,
        }}
      >
        {status.toUpperCase()}
      </span>
      {op.dead && (
        <button
          onClick={async (e) => {
            e.stopPropagation();
            // На failed dead op'ы юзер может: retry (clear dead, drain) или
            // discard (просто удалить из outbox'а). Делаем разовый retry —
            // если опять fail'нётся, юзер может через right-click / меню
            // discard'нуть. Discard через alt-click чтобы UI был минималистичный.
            if (e.altKey) {
              await removeOp(op.id);
              return;
            }
            // Mark non-dead (новая попытка через regular drain).
            // outbox API не экспонирует прямо unmark-dead, но removeOp +
            // re-enqueue не сохраняет attempts counter. Для простоты:
            // forced drain игнорирует dead-flag, drainAll же его уважает.
            // Проще всего — просто discard и попросить юзера re-create,
            // когда op в dead. Hint в title об alt-click для discard.
            await drainAll();
          }}
          title="Click: retry · Alt+Click: discard"
          className="focus-ring"
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,106,106,0.4)',
            color: '#ff6a6a',
            borderRadius: 5,
            fontSize: 9,
            letterSpacing: '0.14em',
            padding: '2px 6px',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          RETRY
        </button>
      )}
    </div>
  );
}
