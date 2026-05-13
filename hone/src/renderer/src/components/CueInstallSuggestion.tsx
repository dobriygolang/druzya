// CueInstallSuggestion — subtle banner showing once after the user has
// completed a focus session AND we know they don't have Cue installed.
//
// B/W only. Hairline borders. Single red dot = subtle highlight of the
// download CTA on hover. The DMG link opens via shell.openExternal —
// we don't bundle the actual binary, the download lives on
// druz9.online's GitHub release CDN.

import { useCallback } from 'react';

import { useT } from '@d9-i18n';

const DISMISS_KEY = 'hone:cue-install-suggestion:dismissed';
const CUE_DOWNLOAD_URL = 'https://druz9.online/cue/download';

export function dismissCueSuggestion(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* localStorage unavailable in some Electron contexts */
  }
}

export function wasCueSuggestionDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CueInstallSuggestion({ open, onClose }: Props) {
  const t = useT();
  const handleDismiss = useCallback(() => {
    dismissCueSuggestion();
    onClose();
  }, [onClose]);

  const handleInstall = useCallback(() => {
    // shell.openExternal via the hone preload bridge. Falls back to
    // window.open if the bridge is absent (web-mode preview / Vite dev).
    const bridge = (window as unknown as { hone?: { openExternal?: (url: string) => void } }).hone;
    if (bridge?.openExternal) {
      bridge.openExternal(CUE_DOWNLOAD_URL);
    } else {
      window.open(CUE_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
    }
    // We DO NOT auto-dismiss — user may want to keep the toast open
    // until they finish downloading. Explicit «×» click is the only
    // dismissal signal.
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Cue suggestion"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 60,
        maxWidth: 360,
        padding: '16px 18px',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 12,
        background: 'rgba(10,10,10,0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        color: 'rgba(255,255,255,0.95)',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 10,
          letterSpacing: '0.22em',
          color: 'rgba(255,255,255,0.4)',
          textTransform: 'uppercase',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 99,
            background: '#FF3B30',
          }}
        />
        {t('hone.cue_install.eyebrow')}
      </div>
      <div style={{ marginBottom: 10, color: '#fff' }}>
        {t('hone.cue_install.title')}
      </div>
      <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 14 }}>
        {t('hone.cue_install.body')}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={handleDismiss}
          style={{
            background: 'transparent',
            border: 0,
            color: 'rgba(255,255,255,0.5)',
            fontSize: 12,
            cursor: 'pointer',
            padding: '6px 10px',
          }}
        >
          {t('hone.cue_install.cta.dismiss')}
        </button>
        <button
          type="button"
          onClick={handleInstall}
          style={{
            background: '#fff',
            color: '#000',
            border: 0,
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 500,
            padding: '6px 14px',
            cursor: 'pointer',
          }}
        >
          {t('hone.cue_install.cta.install')}
        </button>
      </div>
    </div>
  );
}
