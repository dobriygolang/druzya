import { useEffect, useState } from 'react';

import {
  listDevices,
  revokeDevice,
  type Device,
} from '../../../api/storage';

// DevicesSection — list active devices + revoke. Регистрация текущего
// устройства происходит автоматически в App-bootstrap'е (см. отдельную
// задачу — пока здесь только просмотр + revoke).
export function DevicesSection() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [errored, setErrored] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setDevices(null);
    setErrored(false);
    void listDevices()
      .then((d) => {
        if (live) setDevices(d);
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
        Device list unavailable right now.
      </div>
    );
  }
  if (!devices) {
    return <div style={{ fontSize: 13, color: 'var(--ink-40)' }}>Loading…</div>;
  }
  if (devices.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-60)' }}>
        No devices registered yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {devices.map((d) => (
        <DeviceRow key={d.id} device={d} onRevoke={() => setTick((t) => t + 1)} />
      ))}
    </div>
  );
}

function DeviceRow({ device, onRevoke }: { device: Device; onRevoke: () => void }) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      await revokeDevice(device.id);
      onRevoke();
    } catch {
      setBusy(false);
    }
  };
  const seen = new Date(device.lastSeenAt);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--ink-10)',
        background: 'var(--surface)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-90)' }}>{device.name}</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-40)', marginTop: 2 }}>
          {device.platform.toUpperCase()}
          {device.appVersion ? ` · v${device.appVersion}` : ''}
          {' · last seen '}
          {Number.isFinite(seen.getTime()) ? seen.toLocaleString() : '—'}
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="focus-ring"
        style={{
          padding: '5px 10px',
          fontSize: 12,
          background: 'transparent',
          border: '1px solid var(--ink-20)',
          borderRadius: 6,
          color: 'var(--ink-60)',
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? '…' : 'Revoke'}
      </button>
    </div>
  );
}
