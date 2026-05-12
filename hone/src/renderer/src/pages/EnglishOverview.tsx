// EnglishOverviewPage — hub overview для English-loop'а (Reading +
// Writing + Listening). Раньше эти 3 страницы существовали отдельно
// без общей точки входа — Sergey справедливо заметил «слишком всё
// разрозненно». Overview даёт scan-view: сколько vocab due / recent
// reading materials / streak / quick links.
//
// 2026-05-12: v2 visual language — hairline-only cards (был filled
// rgba(255,255,255,0.02)), letter-spacing 0.08em canonical, motion-press
// + focus-ring + token-based transitions.

import { useState } from 'react';

import { listVocabDue, listReadingMaterials, type VocabEntry, type ReadingMaterial } from '../api/reading';
import { trackEvent } from '../api/events';
import type { PaletteAction } from '../components/Palette';
import { useDataState } from '../hooks/useDataState';

interface Props {
  onOpen: (id: PaletteAction) => void;
}

const monoFont = "'JetBrains Mono', ui-monospace, monospace";

const captionMonoTiny: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
};

export function EnglishOverviewPage({ onOpen }: Props) {
  // CI1 (Phase A W2): unified fetch state via useDataState. Previously both
  // catches silently fell back to empty arrays — юзер не видел разницу между
  // «реально пусто» и «backend упал». Now ErrorStripe появляется если что-то
  // не загрузилось, retry refetch'ит обе.
  const [reload, setReload] = useState(0);
  const vocabState = useDataState<VocabEntry[]>(() => listVocabDue(), [reload]);
  const readingState = useDataState<ReadingMaterial[]>(() => listReadingMaterials(), [reload]);

  const vocabDue = vocabState.data;
  const reading = readingState.data;
  const dueCount = vocabDue?.length ?? 0;
  const libraryCount = reading?.length ?? 0;

  const firstError =
    (vocabState.status === 'error' && vocabState.error) ||
    (readingState.status === 'error' && readingState.error) ||
    null;

  return (
    <div
      className="motion-page-in"
      style={{ position: 'absolute', inset: 0, paddingTop: 96, overflowY: 'auto' }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px 64px' }}>
        <header style={{ marginBottom: 32 }}>
          <div style={{ ...captionMonoTiny, marginBottom: 6 }}>ENGLISH HUB</div>
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--type-h1-size)',
              lineHeight: 'var(--type-h1-lh)',
              letterSpacing: 'var(--type-h1-ls)',
              fontWeight: 'var(--type-h1-weight)',
              color: 'var(--ink)',
            }}
          >
            English overview
          </h1>
          <p
            style={{
              marginTop: 8,
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-lh)',
              color: 'var(--ink-60)',
            }}
          >
            Reading / Writing / Listening собраны в один loop. Overview — что требует внимания
            сегодня.
          </p>
        </header>

        {firstError && (
          <div className="data-loader-error" style={{ marginBottom: 16 }}>
            <div className="data-loader-error-stripe" />
            <div className="data-loader-error-body">
              <div className="data-loader-error-label">Не удалось загрузить English-данные</div>
              <div className="data-loader-error-detail">{firstError.message}</div>
              <button
                type="button"
                className="data-loader-error-retry focus-ring motion-press"
                onClick={() => setReload((n) => n + 1)}
              >
                retry
              </button>
            </div>
          </div>
        )}

        <div
          className="motion-stagger"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 24,
          }}
        >
          <StatCard
            label="Vocab due"
            value={dueCount}
            hint="Карточки готовы к review"
            onOpen={() => {
              trackEvent('english_vocab_due_open', { due_count: dueCount });
              onOpen('reading');
            }}
          />
          <StatCard label="Library" value={libraryCount} hint="Материалов в Reading" onOpen={() => onOpen('reading')} />
        </div>

        <Section
          title="Vocab due для review"
          empty={dueCount === 0 ? 'Очередь пуста — реши пару карточек чтобы пополнить SRS.' : null}
        >
          {(vocabDue ?? []).slice(0, 8).map((v) => (
            <Row key={v.word} left={v.word} right={v.translation} />
          ))}
        </Section>

        <Section
          title="Недавние материалы"
          empty={libraryCount === 0 ? 'Библиотека пуста. Открой Reading и hotkey R чтобы добавить.' : null}
        >
          {(reading ?? []).slice(0, 6).map((m) => (
            <Row key={m.id} left={m.title} right={`${m.totalChars} chars`} onClick={() => onOpen('reading')} />
          ))}
        </Section>

        <div className="flex-wrap-row" style={{ marginTop: 24, gap: 8 }}>
          <QuickAction label="📖 Reading" hint="hotkey R" onClick={() => onOpen('reading')} />
          <QuickAction label="✍ Writing" hint="hotkey W" onClick={() => onOpen('writing')} />
          <QuickAction label="🎧 Listening" hint="hotkey L" onClick={() => onOpen('listening')} />
          <QuickAction label="🎙 Speaking" hint="hotkey K" onClick={() => onOpen('speaking')} />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  onOpen,
}: {
  label: string;
  value: number;
  hint: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="focus-ring motion-press"
      style={{
        padding: 16,
        background: 'transparent',
        border: '1px solid var(--hair-2)',
        borderRadius: 'var(--radius-outer)',
        textAlign: 'left',
        cursor: 'pointer',
        minWidth: 0,
        transition:
          'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
        e.currentTarget.style.borderColor = 'var(--hair-2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'var(--hair-2)';
      }}
    >
      <div style={{ ...captionMonoTiny, fontSize: 9 }}>{label}</div>
      <div
        style={{
          marginTop: 6,
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: '-0.018em',
          color: 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-40)' }}>{hint}</div>
    </button>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: string | null;
  children: React.ReactNode;
}) {
  const arr = Array.isArray(children) ? children : [children];
  const hasChildren = arr.some((c) => c != null && c !== false);
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ ...captionMonoTiny, marginBottom: 10 }}>{title}</div>
      {hasChildren ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {children}
        </ul>
      ) : (
        <div
          style={{
            padding: '12px 14px',
            fontSize: 12,
            color: 'var(--ink-40)',
            background: 'transparent',
            border: '1px solid var(--hair)',
            borderRadius: 'var(--radius-inner)',
          }}
        >
          {empty ?? '—'}
        </div>
      )}
    </section>
  );
}

function Row({ left, right, onClick }: { left: string; right: string; onClick?: () => void }) {
  const Comp = onClick ? 'button' : 'li';
  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '8px 12px',
    background: 'transparent',
    border: '1px solid var(--hair)',
    borderRadius: 'var(--radius-inner)',
    textAlign: 'left',
    cursor: onClick ? 'pointer' : 'default',
    color: 'var(--ink-90)',
    width: '100%',
    minWidth: 0,
    transition:
      'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
  };
  const onEnter = onClick
    ? (e: React.MouseEvent<HTMLElement>) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
        e.currentTarget.style.borderColor = 'var(--hair-2)';
      }
    : undefined;
  const onLeave = onClick
    ? (e: React.MouseEvent<HTMLElement>) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'var(--hair)';
      }
    : undefined;
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={onClick ? 'focus-ring motion-press' : undefined}
      style={baseStyle}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>{left}</span>
      <span style={{ fontFamily: monoFont, fontSize: 11, color: 'var(--ink-40)', flexShrink: 0 }}>{right}</span>
    </Comp>
  );
}

function QuickAction({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring motion-press"
      style={{
        padding: '8px 14px',
        background: 'transparent',
        border: '1px solid var(--hair-2)',
        borderRadius: 999,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        color: 'var(--ink)',
        fontSize: 13,
        transition:
          'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
        e.currentTarget.style.borderColor = 'var(--hair-2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'var(--hair-2)';
      }}
    >
      {label}
      <span style={{ fontFamily: monoFont, fontSize: 9, color: 'var(--ink-40)' }}>{hint}</span>
    </button>
  );
}
