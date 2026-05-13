// UX:
//   Step 1 — pick kind (5 cards): Senior@TopTier / Senior@Any / ML offer /
//            English / Custom.
//   Step 2 — refine based on kind:
//            top_tier_co → 8 company chips (Google/Yandex/...) + date picker
//            any_senior  → date picker only
//            ml_offer    → date picker only
//            english_target → 4 target chips (TOEFL/IELTS/CEFR B2+/C1+) + date
//            custom      → free-text textarea + date
//   Step 3 — confirm preview.
//
// B/W rule: red — только в один 1.5px stripe over active card. Никаких
// red bg/border. Стиль mirror'ит онбординг Welcome page.

import { useState } from 'react'
import { ChevronRight, ArrowLeft } from 'lucide-react'

import { Button } from './Button'
import { Modal } from './primitives/Modal'
import {
  setGoal,
  goalKindToBackend,
  goalKindFromBackend,
  TOP_TIER_COMPANIES,
  ENGLISH_TARGETS,
  type GoalKind,
  type TopTierCompany,
  type EnglishTarget,
  type UserGoal,
} from '../lib/goal'
import { cn } from '../lib/cn'
import {
  useCreatePrimaryGoalMutation,
  useUpdatePrimaryGoalMutation,
  useActivePrimaryGoalQuery,
} from '../lib/queries/primaryGoal'
import {
  useGoalPresetsQuery,
  type GoalPreset,
} from '../lib/queries/goalPresets'
import { readAccessToken } from '../lib/apiClient'

interface Props {
  initial?: UserGoal | null
  onClose: () => void
}

interface KindCard {
  id: GoalKind
  label: string
  hint: string
}

const KIND_CARDS: KindCard[] = [
  {
    id: 'top_tier_co',
    label: 'Senior at Top-Tier Co',
    hint: 'Google · Yandex · Wildberries · Ozon · Tinkoff · VK · Meta · Amazon',
  },
  {
    id: 'any_senior',
    label: 'Senior at any Co',
    hint: 'Generic senior IT track — без конкретного работодателя',
  },
  {
    id: 'ml_offer',
    label: 'ML Engineer offer',
    hint: 'ML / DS позиция в любой компании',
  },
  {
    id: 'english_target',
    label: 'English fluency',
    hint: 'TOEFL 100+ · IELTS 7+ · CEFR B2/C1',
  },
  {
    id: 'custom',
    label: 'Custom',
    hint: 'Опиши цель свободным текстом — AI распарсит позже',
  },
]

export function GoalWizardModal({ initial, onClose }: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [kind, setKind] = useState<GoalKind | null>(initial?.kind ?? null)
  const [company, setCompany] = useState<TopTierCompany | null>(
    initial?.targetCompany ?? null,
  )
  const [englishTarget, setEnglishTarget] = useState<EnglishTarget | null>(
    (initial?.targetText as EnglishTarget) ?? null,
  )
  const [customText, setCustomText] = useState<string>(
    initial?.kind === 'custom' ? initial.targetText ?? '' : '',
  )
  const [date, setDate] = useState<string>(initial?.targetDate ?? '')

  // Backend sync — write-through когда юзер authenticated. localStorage
  // остаётся offline cache. Phase C: backend становится source of truth,
  // localStorage holds last-known-good для instant render.
  const createMut = useCreatePrimaryGoalMutation()
  const updateMut = useUpdatePrimaryGoalMutation()
  const activeQ = useActivePrimaryGoalQuery()
  const isAuthed = !!readAccessToken()

  // Admin-curated presets для quick-start pills (silent skip if backend
  // unavailable — useGoalPresetsQuery returns [] on error).
  const presetsQ = useGoalPresetsQuery()
  const topPresets = (presetsQ.data ?? []).slice(0, 5)

  // Pre-fill кnown fields + jump к step 2 для refinement (target_date
  // computed below if default_target_days set).
  const applyPreset = (p: GoalPreset) => {
    const k = goalKindFromBackend(p.kind)
    setKind(k)
    if (k === 'top_tier_co' && p.target_company) {
      // Pull company name into typed union if it matches whitelist; иначе
      // оставляем выбор юзеру (custom strings frontend пока не хранит для
      // top_tier_co — admin может опечататься).
      const match = TOP_TIER_COMPANIES.find(
        (c) => c.toLowerCase() === p.target_company.toLowerCase(),
      )
      if (match) setCompany(match)
    }
    if (k === 'english_target' && p.target_text) {
      const match = ENGLISH_TARGETS.find((t) => t === p.target_text)
      if (match) setEnglishTarget(match)
    }
    if (k === 'custom' && p.target_text) {
      setCustomText(p.target_text)
    }
    if (p.default_target_days && p.default_target_days > 0) {
      const d = new Date()
      d.setDate(d.getDate() + p.default_target_days)
      setDate(d.toISOString().slice(0, 10))
    }
    setStep(2)
  }

  const canProceedFromStep1 = kind !== null
  const canSubmit = (() => {
    if (!kind) return false
    if (kind === 'top_tier_co') return company !== null
    if (kind === 'english_target') return englishTarget !== null
    if (kind === 'custom') return customText.trim().length >= 4
    // any_senior / ml_offer — only kind required
    return true
  })()

  const onSubmit = () => {
    if (!kind || !canSubmit) return
    const now = Date.now()
    const goal: UserGoal = {
      kind,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    }
    if (kind === 'top_tier_co' && company) goal.targetCompany = company
    if (kind === 'english_target' && englishTarget) goal.targetText = englishTarget
    if (kind === 'custom') goal.targetText = customText.trim()
    if (date) goal.targetDate = date
    setGoal(goal)

    // Write-through к backend (best-effort). Если юзер anonymous OR
    // backend unreachable — silent fallback на localStorage-only path.
    if (isAuthed) {
      const backendBody = {
        kind: goalKindToBackend(kind),
        target_company: goal.targetCompany ?? '',
        target_level: goal.targetLevel ?? '',
        target_text: goal.targetText ?? '',
        target_date: goal.targetDate ?? '',
      }
      const existing = activeQ.data
      if (existing) {
        updateMut.mutate({ id: existing.id, ...backendBody })
      } else {
        createMut.mutate(backendBody)
      }
    }

    onClose()
  }

  return (
    <Modal open onClose={onClose} size="lg" title={step === 1 ? 'Какая твоя цель?' : 'Детали и срок'}>
      <div className="flex flex-col gap-5">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          GOAL · STEP {step}/2
        </span>

        {step === 1 && topPresets.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Quick start
            </span>
            <div className="flex flex-wrap gap-2">
              {topPresets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary transition-colors"
                >
                  {p.title}
                </button>
              ))}
            </div>
            <span className="font-mono text-[10px] text-text-muted">
              Или собери цель с нуля ниже.
            </span>
          </div>
        )}

        {step === 1 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {KIND_CARDS.map((card) => {
              const active = kind === card.id
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setKind(card.id)}
                  aria-pressed={active}
                  className={cn(
                    'relative flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all',
                    active
                      ? 'border-text-primary bg-text-primary/10'
                      : 'border-border bg-surface-2 hover:border-border-strong',
                  )}
                >
                  {/* B/W rule: red ONLY as 1.5px top stripe on active card */}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-0 right-0 top-0 h-[1.5px] rounded-t-lg"
                      style={{ background: '#FF3B30' }}
                    />
                  )}
                  <span className="text-[14px] font-bold text-text-primary">
                    {card.label}
                  </span>
                  <span className="text-[11.5px] text-text-muted">{card.hint}</span>
                </button>
              )
            })}
          </div>
        )}

        {step === 2 && kind !== null && (
          <div className="flex flex-col gap-5">
            {kind === 'top_tier_co' && (
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  Компания
                </label>
                <div className="flex flex-wrap gap-2">
                  {TOP_TIER_COMPANIES.map((c) => {
                    const active = company === c
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCompany(c)}
                        aria-pressed={active}
                        className={cn(
                          'rounded-md border px-3 py-1.5 text-[13px] transition-colors',
                          active
                            ? 'border-text-primary bg-text-primary/10 font-semibold text-text-primary'
                            : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong',
                        )}
                      >
                        {c}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {kind === 'english_target' && (
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  Цель
                </label>
                <div className="flex flex-wrap gap-2">
                  {ENGLISH_TARGETS.map((t) => {
                    const active = englishTarget === t
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setEnglishTarget(t)}
                        aria-pressed={active}
                        className={cn(
                          'rounded-md border px-3 py-1.5 text-[13px] transition-colors',
                          active
                            ? 'border-text-primary bg-text-primary/10 font-semibold text-text-primary'
                            : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong',
                        )}
                      >
                        {t}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {kind === 'custom' && (
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  Опиши цель
                </label>
                <textarea
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="Например: SDET в финтехе с фокусом на Python + automation tests"
                  rows={3}
                  maxLength={400}
                  className="resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
                />
                <span className="self-end font-mono text-[10px] text-text-muted">
                  {customText.length}/400 · AI распарсит позже
                </span>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label
                htmlFor="goal-target-date"
                className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted"
              >
                Срок (опционально)
              </label>
              <input
                id="goal-target-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary focus:border-text-primary focus:outline-none"
              />
              <span className="text-[11px] text-text-muted">
                Без даты AI будет планировать как «когда готов». Дата задаёт темп — F3 predictions будут считать недели до ready.
              </span>
            </div>
          </div>
        )}

        <footer className="flex items-center justify-between gap-3">
          {step === 2 ? (
            <Button variant="ghost" onClick={() => setStep(1)} icon={<ArrowLeft className="h-4 w-4" />}>
              Назад
            </Button>
          ) : (
            <span />
          )}
          {step === 1 ? (
            <Button
              onClick={() => setStep(2)}
              disabled={!canProceedFromStep1}
              icon={<ChevronRight className="h-4 w-4" />}
            >
              Продолжить
            </Button>
          ) : (
            <Button onClick={onSubmit} disabled={!canSubmit}>
              Сохранить цель
            </Button>
          )}
        </footer>
      </div>
    </Modal>
  )
}
