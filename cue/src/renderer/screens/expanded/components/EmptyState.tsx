// EmptyState — hero card with brand mark + persona label + shortcut
// list shown when the conversation is empty.

import { useT } from '@d9-i18n';
import { BrandMark, Kbds } from '../../../components/d9';
import { usePersonaStore } from '../../../stores/persona';

export function EmptyState() {
  const t = useT();
  // The hero BrandMark is now always black (post-Cue rebrand), so we
  // only need the persona label for the subtitle — no gradient lookup.
  const persona = usePersonaStore((s) => s.active);
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: '0 20px',
      }}
    >
      <BrandMark
        size={76}
        style={{
          borderRadius: 22,
          boxShadow:
            'inset 0 0.5px 0 rgba(255,255,255,0.3), ' +
            '0 4px 20px -2px rgba(0,0,0,0.4), ' +
            '0 0 40px -8px rgba(0,0,0,0.4)',
        }}
      />
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--d9-font-display)',
            fontStyle: 'italic',
            fontSize: 26,
            color: 'var(--d9-ink)',
            letterSpacing: '-0.01em',
            lineHeight: 1.1,
          }}
        >
          {t('cue.empty.tagline')}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--d9-ink-mute)',
            marginTop: 6,
            letterSpacing: '-0.005em',
          }}
        >
          {t('cue.empty.persona_suffix', { persona: persona.label })}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 320 }}>
        {([
          [t('cue.empty.shortcut.all_commands'), ['⌘', 'K']],
          [t('cue.empty.shortcut.explain_view'), ['⌘', '⏎']],
          [t('cue.empty.shortcut.screenshot_area'), ['⌘', '⇧', 'S']],
          [t('cue.empty.shortcut.switch_persona'), ['⌥', '1']],
          [t('cue.empty.shortcut.hide_window'), ['⌘', '⇧', 'D']],
        ] as Array<[string, string[]]>).map(([label, keys]) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: 'var(--pad-inline) 10px',
              borderRadius: 9,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '0.5px solid var(--d9-hairline)',
            }}
          >
            <span
              style={{
                fontSize: 12.5,
                color: 'var(--d9-ink-dim)',
                letterSpacing: '-0.005em',
                flex: 1,
              }}
            >
              {label}
            </span>
            <Kbds keys={keys} size="sm" sep="" />
          </div>
        ))}
      </div>
    </div>
  );
}
