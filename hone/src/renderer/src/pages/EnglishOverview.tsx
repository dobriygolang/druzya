// EnglishOverviewPage — hub overview для English-loop'а (Reading +
// Writing + Listening). Раньше эти 3 страницы существовали отдельно
// без общей точки входа — Sergey справедливо заметил «слишком всё
// разрозненно». Overview даёт scan-view: сколько vocab due / recent
// reading materials / streak / quick links.

import { useEffect, useState } from 'react';

import { listVocabDue, listReadingMaterials, type VocabEntry, type ReadingMaterial } from '../api/reading';
import type { PaletteAction } from '../components/Palette';

interface Props {
  onOpen: (id: PaletteAction) => void;
}

export function EnglishOverviewPage({ onOpen }: Props) {
  const [vocabDue, setVocabDue] = useState<VocabEntry[] | null>(null);
  const [reading, setReading] = useState<ReadingMaterial[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listVocabDue().then((v) => { if (!cancelled) setVocabDue(v); }).catch(() => { if (!cancelled) setVocabDue([]); });
    void listReadingMaterials().then((r) => { if (!cancelled) setReading(r); }).catch(() => { if (!cancelled) setReading([]); });
    return () => { cancelled = true; };
  }, []);

  const dueCount = vocabDue?.length ?? 0;
  const libraryCount = reading?.length ?? 0;

  return (
    <div className="fadein" style={{ position: 'absolute', inset: 0, paddingTop: 96, animationDuration: '320ms', overflowY: 'auto' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px 64px' }}>
        <header style={{ marginBottom: 32 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--ink-40)', marginBottom: 4 }}>
            ENGLISH HUB
          </div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
            English overview
          </h1>
          <p style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-40)' }}>
            Reading / Writing / Listening собраны в один loop. Overview — что
            требует внимания сегодня.
          </p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>
          <StatCard label="Vocab due" value={dueCount} hint="Карточки готовы к review" onOpen={() => onOpen('reading')} />
          <StatCard label="Library" value={libraryCount} hint="Материалов в Reading" onOpen={() => onOpen('reading')} />
        </div>

        <Section title="Vocab due для review" empty={dueCount === 0 ? 'Очередь пуста — реши пару карточек чтобы пополнить SRS.' : null}>
          {(vocabDue ?? []).slice(0, 8).map((v) => (
            <Row key={v.word} left={v.word} right={v.translation} />
          ))}
        </Section>

        <Section title="Недавние материалы" empty={libraryCount === 0 ? 'Библиотека пуста. Открой Reading и hotkey R чтобы добавить.' : null}>
          {(reading ?? []).slice(0, 6).map((m) => (
            <Row key={m.id} left={m.title} right={`${m.totalChars} chars`} onClick={() => onOpen('reading')} />
          ))}
        </Section>

        <div style={{ marginTop: 24, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <QuickAction label="📖 Reading" hint="hotkey R" onClick={() => onOpen('reading')} />
          <QuickAction label="✍ Writing" hint="hotkey W" onClick={() => onOpen('writing')} />
          <QuickAction label="🎧 Listening" hint="hotkey L" onClick={() => onOpen('listening')} />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, hint, onOpen }: { label: string; value: number; hint: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="focus-ring"
      style={{
        padding: 16,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12,
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <div className="mono" style={{ fontSize: 9, letterSpacing: '0.18em', color: 'var(--ink-40)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 28, fontWeight: 500, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-40)' }}>{hint}</div>
    </button>
  );
}

function Section({ title, empty, children }: { title: string; empty?: string | null; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  const hasChildren = arr.some((c) => c != null && c !== false);
  return (
    <section style={{ marginBottom: 24 }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--ink-40)', textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </div>
      {hasChildren ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {children}
        </ul>
      ) : (
        <div style={{ padding: 12, fontSize: 12, color: 'var(--ink-40)', background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
          {empty ?? '—'}
        </div>
      )}
    </section>
  );
}

function Row({ left, right, onClick }: { left: string; right: string; onClick?: () => void }) {
  const Comp = onClick ? 'button' : 'li';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 8,
        textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default',
        color: 'var(--ink-90)',
      }}
    >
      <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{left}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-40)', flexShrink: 0 }}>{right}</span>
    </Comp>
  );
}

function QuickAction({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring"
      style={{
        padding: '8px 14px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 999,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        color: 'var(--ink)',
        fontSize: 13,
      }}
    >
      {label}
      <span className="mono" style={{ fontSize: 9, color: 'var(--ink-40)' }}>{hint}</span>
    </button>
  );
}
