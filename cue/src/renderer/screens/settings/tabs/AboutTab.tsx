// About tab — version, electron-updater state, feedback / website links.

import { useEffect, useState } from 'react';

import { Button, StatusDot } from '../../../components/primitives';
import { eventChannels, type UpdateStatus } from '@shared/ipc';
import { Row, SectionTitle } from '../lib/shared';

export function AboutTab() {
  const [version, setVersion] = useState('…');
  useEffect(() => {
    void window.druz9.app.version().then(setVersion).catch(() => setVersion('—'));
  }, []);

  return (
    <>
      <SectionTitle title="О программе" subtitle="Cue" />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Row
          title="Версия"
          control={
            <span style={{ fontFamily: 'var(--d9-font-mono)', fontSize: 12 }}>{version}</span>
          }
        />
        <UpdateRow />
        <Row
          title="Обратная связь"
          hint="Telegram-канал проекта"
          control={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void window.druz9.shell.openExternal('https://t.me/druz9_community')}
            >
              Написать
            </Button>
          }
        />
        <Row
          title="Сайт"
          hint="druz9.online"
          control={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void window.druz9.shell.openExternal('https://druz9.online')}
            >
              Открыть
            </Button>
          }
        />
      </div>
    </>
  );
}

/**
 * UpdateRow — surfaces electron-updater state and lets the user force a
 * check or install a downloaded update. Silent when auto-update is
 * disabled (dev build or no feed URL).
 */
function UpdateRow() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' });

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const s = await window.druz9.updater.status();
      if (!disposed) setStatus(s);
    })();
    const unsub = window.druz9.on<UpdateStatus>(eventChannels.updateStatus, (s) => {
      if (!disposed) setStatus(s);
    });
    return () => {
      disposed = true;
      unsub();
    };
  }, []);

  const [checking, setChecking] = useState(false);
  const onCheck = async () => {
    setChecking(true);
    try {
      await window.druz9.updater.check();
    } finally {
      // Let the push events land naturally; release our local spinner.
      setTimeout(() => setChecking(false), 600);
    }
  };

  return (
    <Row
      title="Обновления"
      hint={describe(status)}
      control={
        status.kind === 'ready' ? (
          <Button size="sm" variant="primary" onClick={() => void window.druz9.updater.install()}>
            Установить и перезапустить
          </Button>
        ) : status.kind === 'checking' || status.kind === 'downloading' || checking ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--pad-inline)',
              fontSize: 12,
              color: 'var(--d9-ink-dim)',
              fontFamily: 'var(--d9-font-mono)',
            }}
          >
            <StatusDot state="thinking" size={8} />
            {status.kind === 'downloading' ? `${status.percent}%` : 'проверка…'}
          </span>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void onCheck()}>
            Проверить
          </Button>
        )
      }
    />
  );
}

function describe(s: UpdateStatus): string {
  switch (s.kind) {
    case 'idle':
      return 'Обновления не проверялись';
    case 'checking':
      return 'Проверяю…';
    case 'available':
      return `Доступна версия ${s.version} — скачивается`;
    case 'downloading':
      return `Скачивание ${s.percent}%`;
    case 'ready':
      return `Версия ${s.version} готова к установке`;
    case 'not-available':
      return 'У тебя последняя версия';
    case 'error':
      return `Ошибка: ${s.message.slice(0, 80)}`;
  }
}
