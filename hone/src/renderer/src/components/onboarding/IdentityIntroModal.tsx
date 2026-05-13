// Проблема (из docs/feature analysis): юзер не понимает что Hone делает
// vs web druz9.online vs Cue. Identity overlap → cannibalization risk.
// Юзер открывает Hone, ищет «AI mock», не находит и думает «не работает».
//
// Решение: после auth — однократный 3-pane modal с positioning trio.
// Каждый product получает:
//   - icon (monochrome SVG, 1.5px stroke)
//   - 1-line RU + 1-line EN positioning
//   - 4-5 feature pills
//   - CTA (open external link) — кроме «current» Hone-card
//
// Storage:
//   - localStorage.hone:identity-intro-shown:v1 = '1'
//   - Settings → Ecosystem → «Show intro again» очищает flag + re-opens.
//
// Trigger в App.tsx:
//   После status === 'signed_in' AND OnboardingModal завершён, если flag
//   не выставлен — setIsOpen(true). Один modal за раз: identity-intro
//   ждёт пока OnboardingModal закроется (он уже использует hone:onboarded:v2).

import { useState } from 'react';

import { Modal } from '../primitives/Modal';
import { motion as motionTokens } from '../../lib/design-tokens';
import { openCueInstall, openDruz9Web } from '../../lib/cross-app-links';
import { IdentityCard, PRODUCTS, type ProductInfo } from './IdentityCard';

export const IDENTITY_INTRO_STORAGE_KEY = 'hone:identity-intro-shown:v1';

/**
 * Должен ли показаться intro modal? Single source-of-truth для App-mount
 * check'а и Settings «show again» (последний очищает flag).
 */
export function shouldShowIdentityIntro(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(IDENTITY_INTRO_STORAGE_KEY) !== '1';
  } catch {
    // localStorage недоступен (private mode) — показываем как fallback.
    // Это лучше чем silent skip: юзер всё равно увидит intro однажды
    // и сможет dismiss.
    return true;
  }
}

/** Mark intro as shown. */
export function markIdentityIntroShown(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(IDENTITY_INTRO_STORAGE_KEY, '1');
  } catch {
    /* quota / private mode — degrade gracefully */
  }
}

/** Reset flag — Settings «Show intro again». */
export function resetIdentityIntroShown(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(IDENTITY_INTRO_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

interface IdentityIntroModalProps {
  onClose: () => void;
}

export function IdentityIntroModal({ onClose }: IdentityIntroModalProps): JSX.Element {
  const [open, setOpen] = useState(true);

  function close(): void {
    markIdentityIntroShown();
    setOpen(false);
    // Wait for Modal exit-anim before parent unmount.
    window.setTimeout(onClose, motionTokens.dur.medium);
  }

  const products: ProductInfo[] = [
    { ...PRODUCTS.hone, current: true },
    {
      ...PRODUCTS.web,
      onCta: () => {
        openDruz9Web();
      },
    },
    {
      ...PRODUCTS.cue,
      onCta: () => {
        openCueInstall();
      },
    },
  ];

  return (
    <Modal open={open} onClose={close} size="lg">
      <div style={{ paddingBottom: 18, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.4)',
            marginBottom: 6,
          }}
        >
          welcome to druz9
        </div>
        <h2
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '-0.012em',
            margin: '0 0 6px',
            color: '#fff',
          }}
        >
          Три surface'а, одна экосистема
        </h2>
        <p
          style={{
            fontSize: 13,
            color: 'rgba(255,255,255,0.6)',
            margin: 0,
            lineHeight: 1.5,
            maxWidth: 580,
          }}
        >
          Hone — для тихой ежедневной работы. <strong style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>druz9.online</strong> — для практики и мок-собеседований.
          {' '}<strong style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>Cue</strong> — невидимый copilot во время живого собеседования.
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          padding: '20px 0 4px',
          // align-items stretch — все 3 cards выравниваются по высоте даже
          // когда features-list разной длины.
          alignItems: 'stretch',
        }}
      >
        {products.map((p) => (
          <IdentityCard key={p.key} info={p} />
        ))}
      </div>

      <div
        style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.02em',
            flex: '1 1 220px',
            lineHeight: 1.5,
          }}
        >
          Tip: открыть этот intro снова можно из Settings → Ecosystem.
        </span>
        <button
          type="button"
          onClick={close}
          className="mono focus-ring"
          style={{
            padding: '7px 18px',
            background: '#fff',
            color: '#000',
            border: 'none',
            borderRadius: 5,
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontWeight: 600,
          }}
        >
          got it
        </button>
      </div>
    </Modal>
  );
}
