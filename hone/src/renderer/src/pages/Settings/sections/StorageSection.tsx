import { useEffect, useState } from 'react';

import {
  getStorageQuota,
  formatBytes,
  tierLabel,
  archiveOldestNotes,
  type StorageQuota,
} from '../../../api/storage';

// StorageSection — usage-bar plus tier badge. Один fetch на mount;
// данные с бэкенда отстают до часа (cron — см. backend services/storage.go),
// поэтому realtime refresh не имеет смысла. Если backend упал или юзер
// не залогинен — показываем neutral placeholder, не фейлим страницу.
export function StorageSection() {
  const [data, setData] = useState<StorageQuota | null>(null);
  const [errored, setErrored] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null);
    setErrored(false);
    void getStorageQuota()
      .then((q) => {
        if (live) setData(q);
      })
      .catch(() => {
        if (live) setErrored(true);
      });
    return () => {
      live = false;
    };
  }, [tick]);

  if (errored) {
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-60)' }}>
        Storage usage unavailable right now.
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-40)' }}>Loading…</div>
    );
  }

  const pct = data.quotaBytes > 0 ? Math.min(100, (data.usedBytes / data.quotaBytes) * 100) : 0;
  const overSoft = pct >= 80;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--ink-90)' }}>
          {formatBytes(data.usedBytes)}{' '}
          <span style={{ color: 'var(--ink-40)' }}>
            / {formatBytes(data.quotaBytes)}
          </span>
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.08em',
            padding: '3px 8px',
            borderRadius: 999,
            border: '1px solid var(--ink-20)',
            color: 'var(--ink-60)',
          }}
        >
          {tierLabel(data.tier).toUpperCase()}
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: 'var(--ink-10)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: overSoft ? 'rgba(255,140,90,0.85)' : 'var(--ink-90)',
            transition: 'width var(--motion-dur-medium) var(--motion-ease-standard), background-color var(--motion-dur-medium) var(--motion-ease-standard)',
          }}
        />
      </div>
      {/* Archive control — особенно полезно при overSoft. Не блокируем при
          ниже-cap'е: юзер может профилактически чистить старое. */}
      <ArchiveControl onDone={() => setTick((t) => t + 1)} />
      {data.tier === 'free' && (
        <button
          type="button"
          onClick={() => {
            // X2 (P0) — actionable теперь. Раньше декларативный banner →
            // юзер читал и забывал. Открываем UpgradeModal с context'ом
            // cross_device_sync чтобы Stripe attribution знала источник.
            void import('../../../components/UpgradeModal').then(({ requestUpgrade }) => {
              requestUpgrade({
                feature: 'cross_device_sync',
                label: 'cross-device sync',
                benefit:
                  'Pro syncs notes, whiteboards and coach memory across desktop and other devices — 10 GB on Seeker, 100 GB on Ascended.',
              });
            });
          }}
          className="focus-ring"
          style={{
            marginTop: 14,
            width: '100%',
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid var(--ink-10)',
            background: 'var(--surface)',
            textAlign: 'left',
            color: 'inherit',
            cursor: 'pointer',
            font: 'inherit',
            transition:
              'border-color var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--ink-20)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--ink-10)';
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 4,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--ink-90)' }}>
              Sync across devices · Pro
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink-40)' }}>See plans →</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.45 }}>
            Free tier keeps data on this device only. Upgrade to sync notes,
            whiteboards and coach memory between desktop and other devices.
          </div>
        </button>
      )}
    </div>
  );
}

// ArchiveControl — единственная кнопка «Archive 10 oldest notes».
// Без подтверждения: archive ≠ delete (recoverable), и UX-друже­люб­нее
// сразу выполнить. Если юзер кликнул случайно — open Notes → восстановить.
function ArchiveControl({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const n = await archiveOldestNotes(10);
      setMsg(n === 0 ? 'No active notes to archive.' : `Archived ${n} note${n === 1 ? '' : 's'}.`);
      onDone();
    } catch {
      setMsg('Archive failed — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="focus-ring"
        style={{
          padding: '6px 12px',
          fontSize: 12.5,
          background: 'transparent',
          border: '1px solid var(--ink-20)',
          borderRadius: 8,
          color: 'var(--ink-90)',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.5 : 1,
          transition: 'opacity var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard)',
        }}
      >
        {busy ? 'Archiving…' : 'Archive 10 oldest notes'}
      </button>
      {msg ? <span style={{ fontSize: 12, color: 'var(--ink-60)' }}>{msg}</span> : null}
    </div>
  );
}
