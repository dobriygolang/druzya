// Appearance tab — window transparency slider, preset chips, and a
// read-only note on auto window-size persistence.

import { useEffect } from 'react';

import { useT } from '@d9-i18n';
import { RangeSlider } from '../../../components/d9';
import { useAppearanceStore } from '../../../stores/appearance';
import { Row, SectionTitle } from '../lib/shared';

export function AppearanceTab() {
  const t = useT();
  const opacity = useAppearanceStore((s) => s.expandedOpacity);
  const bootstrap = useAppearanceStore((s) => s.bootstrap);
  const setOpacity = useAppearanceStore((s) => s.setExpandedOpacity);
  useEffect(() => {
    let unsub: (() => void) | null = null;
    void bootstrap().then((u) => {
      unsub = u;
    });
    return () => {
      if (unsub) unsub();
    };
  }, [bootstrap]);

  // Transparency presets — three calibrated alpha levels covering the
  // common cases (see / hide background). Quick taps for users who don't
  // want to fiddle the slider; slider still works as a fine-tune.
  const PRESETS: ReadonlyArray<{ key: string; label: string; value: number }> = [
    { key: 'subtle',   label: 'Subtle',   value: 85 },
    { key: 'balanced', label: 'Balanced', value: 75 },
    { key: 'bold',     label: 'Bold',     value: 65 },
  ];

  return (
    <>
      <SectionTitle
        title={t('cue.settings.appearance.section.title')}
        subtitle={t('cue.settings.appearance.section.subtitle')}
      />
      <Row
        title={t('cue.settings.appearance.opacity.title')}
        hint={t('cue.settings.appearance.opacity.hint')}
        control={
          <RangeSlider
            value={opacity}
            min={0}
            max={100}
            onChange={(v) => void setOpacity(v)}
            suffix="%"
          />
        }
      />
      <Row
        title={t('cue.settings.appearance.presets.title')}
        hint={t('cue.settings.appearance.presets.hint')}
        control={
          <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            {PRESETS.map((p) => {
              const active = opacity === p.value;
              return (
                <button
                  key={p.key}
                  onClick={() => void setOpacity(p.value)}
                  className="focus-ring motion-press"
                  aria-pressed={active}
                  style={{
                    padding: '4px 10px',
                    background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
                    border: `1px solid ${active ? 'rgba(255,255,255,0.30)' : 'var(--d9-hairline-b)'}`,
                    color: active ? 'var(--d9-ink)' : 'var(--d9-ink-mute)',
                    borderRadius: 4,
                    fontSize: 10.5,
                    fontFamily: 'var(--d9-font-mono)',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        }
      />
      <Row
        title={t('cue.settings.appearance.window_size.title')}
        hint={t('cue.settings.appearance.window_size.hint')}
        control={
          <span
            style={{
              fontFamily: 'var(--d9-font-mono)',
              fontSize: 10.5,
              color: 'var(--d9-ink-ghost)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {t('cue.settings.appearance.window_size.auto')}
          </span>
        }
      />
    </>
  );
}
