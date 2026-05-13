// IdentityCard — single column в 3-pane ecosystem comparison. Используется
// в IdentityIntroModal (first-run) и Settings → Ecosystem section.
//
// Iconography — monochrome SVG inline, 1.5px stroke, currentColor.
// B/W only design rule из CLAUDE.md.
//
// Copy moved to i18n: taglineRu/En + features are translation keys looked
// up at render time so the card swaps language when locale changes.

import { useT, type Dict } from '@d9-i18n';

export type ProductKey = 'hone' | 'web' | 'cue';

export interface ProductInfo {
  key: ProductKey;
  /** Short display name. Lowercase / casual — matches Hone copy voice. */
  name: string;
  /** i18n key for RU one-liner (primary positioning sentence). */
  taglineRuKey: keyof Dict;
  /** i18n key for EN one-liner (secondary descriptor). */
  taglineEnKey: keyof Dict;
  /** i18n keys for feature pills — 4-5 short keywords. */
  featureKeys: ReadonlyArray<keyof Dict>;
  /** Whether this is the current process — "you are here" indicator. */
  current?: boolean;
  /** CTA button i18n key. Omit для current product = no CTA. */
  ctaLabelKey?: keyof Dict;
  /** Click handler — обычно открывает cross-app link. */
  onCta?: () => void;
}

/**
 * Source-of-truth для positioning copy. Импортируется обоими: модалью и
 * Settings ecosystem section. Strings живут в i18n под `hone.identity.*`.
 */
export const PRODUCTS: Record<ProductKey, Omit<ProductInfo, 'current' | 'onCta'>> = {
  hone: {
    key: 'hone',
    name: 'Hone',
    taglineRuKey: 'hone.identity.hone.tagline_ru',
    taglineEnKey: 'hone.identity.hone.tagline_en',
    featureKeys: [
      'hone.identity.hone.feature.ai_plan',
      'hone.identity.hone.feature.notes',
      'hone.identity.hone.feature.taskboard',
      'hone.identity.hone.feature.english',
      'hone.identity.hone.feature.pomodoro',
    ],
  },
  web: {
    key: 'web',
    name: 'druz9.online',
    taglineRuKey: 'hone.identity.web.tagline_ru',
    taglineEnKey: 'hone.identity.web.tagline_en',
    featureKeys: [
      'hone.identity.web.feature.mock',
      'hone.identity.web.feature.atlas',
      'hone.identity.web.feature.codex',
      'hone.identity.web.feature.coach',
      'hone.identity.web.feature.whiteboard',
    ],
    ctaLabelKey: 'hone.identity.web.cta',
  },
  cue: {
    key: 'cue',
    name: 'Cue',
    taglineRuKey: 'hone.identity.cue.tagline_ru',
    taglineEnKey: 'hone.identity.cue.tagline_en',
    featureKeys: [
      'hone.identity.cue.feature.invisible',
      'hone.identity.cue.feature.transcript',
      'hone.identity.cue.feature.hints',
      'hone.identity.cue.feature.prep',
    ],
    ctaLabelKey: 'hone.identity.cue.cta',
  },
};

// ── icons ───────────────────────────────────────────────────────────────
// Monochrome 1.5px stroke SVGs, currentColor. 32×32 viewBox чтобы у glyph'а
// был воздух — visually rectangular icons выглядят кривовато при 24×24.

function HoneIcon({ size = 32 }: { size?: number }): JSX.Element {
  // Focus circle + tomato/pomodoro mark. Concentric ring = «hone in».
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="16" cy="16" r="11" />
      <circle cx="16" cy="16" r="6" />
      <path d="M16 5v3" />
      <path d="M16 24v3" />
    </svg>
  );
}

function WebIcon({ size = 32 }: { size?: number }): JSX.Element {
  // Connected-nodes graph — captures Atlas + practice pipeline metaphor.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="8" cy="9" r="2.5" />
      <circle cx="24" cy="9" r="2.5" />
      <circle cx="16" cy="22" r="2.5" />
      <path d="M10 10.5l4.5 9.5" />
      <path d="M22 10.5l-4.5 9.5" />
      <path d="M10.5 9h11" />
    </svg>
  );
}

function CueIcon({ size = 32 }: { size?: number }): JSX.Element {
  // Waveform + listening dot — captures «live transcript / ambient AI».
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 16v0" />
      <path d="M10 13v6" />
      <path d="M14 10v12" />
      <path d="M18 13v6" />
      <path d="M22 11v10" />
      <path d="M26 14v4" />
    </svg>
  );
}

export function ProductIcon({ k, size = 32 }: { k: ProductKey; size?: number }): JSX.Element {
  switch (k) {
    case 'hone':
      return <HoneIcon size={size} />;
    case 'web':
      return <WebIcon size={size} />;
    case 'cue':
      return <CueIcon size={size} />;
  }
}

// ── card ────────────────────────────────────────────────────────────────

interface IdentityCardProps {
  info: ProductInfo;
}

export function IdentityCard({ info }: IdentityCardProps): JSX.Element {
  const t = useT();
  const isCurrent = info.current === true;
  return (
    <div
      style={{
        // Flex item — min 220, grows up to fill row. На narrow viewport'ах
        // overflow wraps, и каждый card occupies full width.
        flex: '1 1 220px',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '20px 18px',
        background: isCurrent ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)',
        border: isCurrent
          ? '1px solid rgba(255,255,255,0.22)'
          : '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* "you are here" indicator — 1.5px white stripe top edge для current
          product. B/W rule: white indicator, never bg/fill. */}
      {isCurrent && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 1.5,
            background: 'rgba(255,255,255,0.85)',
          }}
        />
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          minWidth: 0,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            flexShrink: 0,
            width: 40,
            height: 40,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            color: 'rgba(255,255,255,0.92)',
          }}
        >
          <ProductIcon k={info.key} size={22} />
        </div>
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: '#fff',
                letterSpacing: '-0.005em',
              }}
            >
              {info.name}
            </span>
            {isCurrent && (
              <span
                className="mono"
                style={{
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'rgba(255,255,255,0.65)',
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.08)',
                }}
              >
                {t('hone.identity.you_are_here')}
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4, lineHeight: 1.4 }}>
            {t(info.taglineRuKey)}
          </div>
          <div
            className="mono"
            style={{
              fontSize: 10.5,
              color: 'rgba(255,255,255,0.4)',
              marginTop: 2,
              letterSpacing: '0.02em',
            }}
          >
            {t(info.taglineEnKey)}
          </div>
        </div>
      </div>

      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        {info.featureKeys.map((fk) => (
          <li
            key={fk}
            style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.72)',
              lineHeight: 1.45,
              paddingLeft: 12,
              position: 'relative',
            }}
          >
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                top: '0.55em',
                width: 4,
                height: 4,
                borderRadius: 999,
                background: 'rgba(255,255,255,0.4)',
              }}
            />
            {t(fk)}
          </li>
        ))}
      </ul>

      {info.ctaLabelKey && info.onCta && !isCurrent && (
        <button
          type="button"
          onClick={info.onCta}
          className="focus-ring"
          style={{
            marginTop: 'auto',
            padding: '7px 12px',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 5,
            color: 'rgba(255,255,255,0.92)',
            fontSize: 11.5,
            letterSpacing: '0.04em',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
            transition: 'border-color var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.32)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)';
          }}
        >
          {t(info.ctaLabelKey)} →
        </button>
      )}
    </div>
  );
}

