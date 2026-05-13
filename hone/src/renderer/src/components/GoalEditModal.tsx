// Mirrors web GoalWizardModal step 2 only: kind selection assumed (юзер
// уже создал цель в web), здесь только refine target_company / target_text /
// target_date. Full multi-step wizard живёт в web — Hone shows «edit in web»
// link для full create flow.
//
// Hidden когда no active goal — caller (Coach / Today) проверяет.
import { useEffect, useState } from 'react';

import { useT } from '@d9-i18n';

import { Modal } from './primitives/Modal';
import { motion as motionTokens } from '../lib/design-tokens';
import {
  type PrimaryGoal,
  type PrimaryGoalKind,
} from '../api/intelligence';
import { useGoalStore } from '../stores/goal';

const TOP_TIER_COMPANIES = [
  'Google',
  'Yandex',
  'Wildberries',
  'Ozon',
  'Tinkoff',
  'VK',
  'Meta',
  'Amazon',
] as const;

const ENGLISH_TARGETS = ['TOEFL 100+', 'IELTS 7+', 'CEFR B2+', 'CEFR C1+'] as const;

const KIND_LABEL: Record<PrimaryGoalKind, string> = {
  GOAL_KIND_TOP_TIER_CO: 'Senior at Top-Tier Co',
  GOAL_KIND_ANY_SENIOR: 'Senior at any Co',
  GOAL_KIND_ML_OFFER: 'ML Engineer offer',
  GOAL_KIND_ENGLISH_TARGET: 'English target',
  GOAL_KIND_CUSTOM: 'Custom',
};

interface Props {
  goal: PrimaryGoal;
  onClose: () => void;
}

export function GoalEditModal({ goal, onClose }: Props) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [company, setCompany] = useState(goal.target_company ?? '');
  const [englishTarget, setEnglishTarget] = useState(goal.target_text ?? '');
  const [customText, setCustomText] = useState(goal.target_text ?? '');
  const [date, setDate] = useState(goal.target_date ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useGoalStore((s) => s.update);

  function close() {
    setOpen(false);
    window.setTimeout(onClose, motionTokens.dur.medium);
  }

  // Cmd+Enter — submit; ESC handled by Modal primitive.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, englishTarget, customText, date]);

  async function onSave() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await update({
        id: goal.id,
        kind: goal.kind,
        target_company: goal.kind === 'GOAL_KIND_TOP_TIER_CO' ? company : '',
        target_level: goal.target_level ?? '',
        target_text:
          goal.kind === 'GOAL_KIND_ENGLISH_TARGET'
            ? englishTarget
            : goal.kind === 'GOAL_KIND_CUSTOM'
            ? customText.trim()
            : '',
        target_date: date,
      });
      close();
    } catch (e) {
      setError((e as Error)?.message ?? 'failed to save');
      setBusy(false);
    }
  }

  const canSave = (() => {
    if (goal.kind === 'GOAL_KIND_TOP_TIER_CO') return !!company;
    if (goal.kind === 'GOAL_KIND_ENGLISH_TARGET') return !!englishTarget;
    if (goal.kind === 'GOAL_KIND_CUSTOM') return customText.trim().length >= 4;
    return true;
  })();

  return (
    <Modal open={open} onClose={close} size="md" title="Edit goal">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={chipRow}>
          <span style={tagChip}>{KIND_LABEL[goal.kind]}</span>
          <span style={{ ...dim, fontSize: 11 }}>
            {t('hone.goal.full_wizard_hint')}
          </span>
        </div>

        {goal.kind === 'GOAL_KIND_TOP_TIER_CO' && (
          <Field label={t('hone.goal.field.company')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TOP_TIER_COMPANIES.map((c) => {
                const active = company === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCompany(c)}
                    aria-pressed={active}
                    style={{
                      ...pillBtn,
                      ...(active ? pillActive : {}),
                    }}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {goal.kind === 'GOAL_KIND_ENGLISH_TARGET' && (
          <Field label={t('hone.goal.field.goal')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ENGLISH_TARGETS.map((tgt) => {
                const active = englishTarget === tgt;
                return (
                  <button
                    key={tgt}
                    type="button"
                    onClick={() => setEnglishTarget(tgt)}
                    aria-pressed={active}
                    style={{
                      ...pillBtn,
                      ...(active ? pillActive : {}),
                    }}
                  >
                    {tgt}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {goal.kind === 'GOAL_KIND_CUSTOM' && (
          <Field label={t('hone.goal.field.description')}>
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              rows={3}
              maxLength={400}
              style={textareaStyle}
            />
            <span style={{ ...dim, fontSize: 10, alignSelf: 'flex-end' }}>
              {customText.length}/400
            </span>
          </Field>
        )}

        <Field label={t('hone.goal.field.deadline')}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={inputStyle}
          />
        </Field>

        {error && (
          <div role="alert" style={errorStyle}>
            {error}
          </div>
        )}

        <footer style={footerStyle}>
          <button type="button" onClick={close} style={ghostBtn}>
            {t('common.action.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={!canSave || busy}
            style={{
              ...primaryBtn,
              opacity: !canSave || busy ? 0.5 : 1,
              cursor: !canSave || busy ? 'default' : 'pointer',
            }}
          >
            {busy ? 'saving…' : 'save'}
          </button>
        </footer>
      </div>
    </Modal>
  );
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <label style={fieldLabel}>{label}</label>
    {children}
  </div>
);

const monoFont = '"JetBrains Mono", ui-monospace, monospace';

const dim: React.CSSProperties = { color: 'rgba(255,255,255,0.5)' };

const chipRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const tagChip: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  padding: '3px 8px',
  background: '#111',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 4,
  color: 'rgba(255,255,255,0.7)',
};

const fieldLabel: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'rgba(255,255,255,0.5)',
};

const pillBtn: React.CSSProperties = {
  fontSize: 12,
  padding: '6px 10px',
  background: '#111',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 4,
  color: 'rgba(255,255,255,0.7)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const pillActive: React.CSSProperties = {
  background: 'rgba(255,255,255,0.10)',
  borderColor: 'rgba(255,255,255,0.30)',
  color: 'rgba(255,255,255,0.92)',
};

const textareaStyle: React.CSSProperties = {
  resize: 'none',
  background: '#111',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 4,
  padding: '8px 10px',
  color: 'rgba(255,255,255,0.92)',
  fontSize: 13,
  fontFamily: 'inherit',
};

const inputStyle: React.CSSProperties = {
  background: '#111',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 4,
  padding: '6px 10px',
  color: 'rgba(255,255,255,0.92)',
  fontSize: 13,
  fontFamily: 'inherit',
};

const errorStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'rgba(255,255,255,0.85)',
  background: 'rgba(255,59,48,0.08)',
  border: '1px solid rgba(255,59,48,0.35)',
  borderLeft: '2px solid #FF3B30',
  borderRadius: 4,
  padding: '6px 10px',
  fontFamily: monoFont,
  letterSpacing: '0.02em',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 8,
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.07)',
  color: 'rgba(255,255,255,0.7)',
  fontSize: 12,
  padding: '6px 14px',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const primaryBtn: React.CSSProperties = {
  background: '#fff',
  color: '#000',
  fontSize: 12,
  fontWeight: 500,
  padding: '6px 14px',
  borderRadius: 6,
  border: 0,
  fontFamily: 'inherit',
};
