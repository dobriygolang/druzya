// About tab — version, electron-updater state, feedback / website links.

import { useEffect, useState } from 'react';

import { useT } from '@d9-i18n';
import { Button, StatusDot } from '../../../components/primitives';
import { eventChannels, type UpdateStatus } from '@shared/ipc';
import { Row, SectionTitle } from '../lib/shared';

export function AboutTab() {
  const t = useT();
  const [version, setVersion] = useState('…');
  useEffect(() => {
    void window.druz9.app.version().then(setVersion).catch(() => setVersion('—'));
  }, []);

  return (
    <>
      <SectionTitle title={t('cue.settings.about.section.title')} subtitle={t('cue.settings.about.section.subtitle')} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Row
          title={t('cue.settings.about.version.title')}
          control={
            <span style={{ fontFamily: 'var(--d9-font-mono)', fontSize: 12 }}>{version}</span>
          }
        />
        <UpdateRow />
        <Row
          title={t('cue.settings.about.feedback.title')}
          hint={t('cue.settings.about.feedback.hint')}
          control={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void window.druz9.shell.openExternal('https://t.me/druz9_community')}
            >
              {t('cue.settings.about.feedback.cta')}
            </Button>
          }
        />
        <Row
          title={t('cue.settings.about.site.title')}
          hint={t('cue.settings.about.site.hint')}
          control={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void window.druz9.shell.openExternal('https://druz9.online')}
            >
              {t('cue.settings.about.site.cta')}
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
  const t = useT();
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
      title={t('cue.settings.about.updates.title')}
      hint={describe(t, status)}
      control={
        status.kind === 'ready' ? (
          <Button size="sm" variant="primary" onClick={() => void window.druz9.updater.install()}>
            {t('cue.settings.about.updates.install_cta')}
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
            {status.kind === 'downloading' ? `${status.percent}%` : t('cue.settings.about.updates.checking')}
          </span>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void onCheck()}>
            {t('cue.settings.about.updates.check_cta')}
          </Button>
        )
      }
    />
  );
}

function describe(t: ReturnType<typeof useT>, s: UpdateStatus): string {
  switch (s.kind) {
    case 'idle':
      return t('cue.settings.about.updates.status.idle');
    case 'checking':
      return t('cue.settings.about.updates.status.checking');
    case 'available':
      return t('cue.settings.about.updates.status.available', { version: s.version });
    case 'downloading':
      return t('cue.settings.about.updates.status.downloading', { percent: s.percent });
    case 'ready':
      return t('cue.settings.about.updates.status.ready', { version: s.version });
    case 'not-available':
      return t('cue.settings.about.updates.status.not_available');
    case 'error':
      return t('cue.settings.about.updates.status.error', { message: s.message.slice(0, 80) });
  }
}
