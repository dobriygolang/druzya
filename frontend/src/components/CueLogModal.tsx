// CueLogModal — F10 manual entry для Cue session log. Без real Cue Electron
//   • CoachMemoryCard latestCue slice показывает recent context
//   • F4 insights detect struggling stages (2+ low-rated sessions)
//   • F3 readiness не affected (Cue не direct activity log — отдельная story)
//
// Form structure:
//   - Company (required) — Yandex / Google / etc, free-text
//   - Persona (optional) — algo-coach / sysdesign-guru / etc
//   - Stages list (dynamic) — каждый stage: kind picker + notes + selfRating
//   - aiSummary (optional, multiline) — что AI вынес из транскрипта
//
// B/W rule: red 1.5px stripe только на active stage card (uniform с other modals).

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from './Button'
import { Modal } from './primitives/Modal'
import { cn } from '../lib/cn'
import {
  logCueSession,
  type CueSessionStage,
  type CueSessionStageEntry,
} from '../lib/cueSessions'
import { useIngestInterviewSessionMutation } from '../lib/queries/interviewSessions'
import { readAccessToken } from '../lib/apiClient'

interface Props {
  onClose: () => void
}

interface StageDraft {
  stage: CueSessionStage
  notes: string
  selfRating: 1 | 2 | 3 | 4 | 5 | undefined
}

function getStageLabels(t: (k: string) => string): Record<CueSessionStage, string> {
  return {
    hr: 'HR / screen',
    algo: 'Algo / coding',
    coding: 'Live coding',
    sysdesign: 'System design',
    behavioral: 'Behavioral',
    other: t('cue_log.other'),
  }
}

const STAGE_OPTIONS: CueSessionStage[] = ['hr', 'algo', 'coding', 'sysdesign', 'behavioral', 'other']

function emptyStage(): StageDraft {
  return { stage: 'algo', notes: '', selfRating: undefined }
}

export function CueLogModal({ onClose }: Props) {
  const { t } = useTranslation('wave14')
  const STAGE_LABEL = useMemo(() => getStageLabels(t), [t])
  const [company, setCompany] = useState('')
  const [persona, setPersona] = useState('')
  const [stages, setStages] = useState<StageDraft[]>([emptyStage()])
  const [aiSummary, setAiSummary] = useState('')
  // F10 write-through. Анонимный юзер → только localStorage; auth → backend +
  // local mirror.
  const ingestMut = useIngestInterviewSessionMutation()
  const isAuthed = !!readAccessToken()

  const canSubmit =
    company.trim().length >= 2 && stages.some((s) => s.notes.trim().length > 0)

  const onAddStage = () => {
    if (stages.length >= 5) return // cap reasonable
    setStages((prev) => [...prev, emptyStage()])
  }

  const onRemoveStage = (idx: number) => {
    setStages((prev) => prev.filter((_, i) => i !== idx))
  }

  const onUpdateStage = (idx: number, patch: Partial<StageDraft>) => {
    setStages((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    const validStages: CueSessionStageEntry[] = stages
      .filter((s) => s.notes.trim().length > 0)
      .map((s) => ({
        stage: s.stage,
        notes: s.notes.trim(),
        selfRating: s.selfRating,
      }))
    if (validStages.length === 0) return
    logCueSession({
      company: company.trim(),
      persona: persona.trim() || undefined,
      stages: validStages,
      aiSummary: aiSummary.trim() || undefined,
      startedAt: Date.now() - 60 * 60 * 1000, // assume ~1h session по умолчанию
    })
    // Backend write-through. Анонимный юзер — silent skip.
    if (isAuthed) {
      ingestMut.mutate({
        company: company.trim(),
        persona: persona.trim() || undefined,
        stages: validStages.map((s) => ({
          stage: s.stage,
          notes: s.notes,
          self_rating: s.selfRating ?? 0,
        })),
        ai_summary: aiSummary.trim() || undefined,
        completed_at: new Date().toISOString(),
      })
    }
    onClose()
  }

  return (
    <Modal open onClose={onClose} size="md" title={t('cue_log.log_interview')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          + CUE SESSION
        </span>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cue-company"
              className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted"
            >
              {t('cue_log.company')}
            </label>
            <input
              id="cue-company"
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Yandex / Google / etc"
              maxLength={64}
              autoFocus
              required
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cue-persona"
              className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted"
            >
              {t('cue_log.persona_optional')}
            </label>
            <input
              id="cue-persona"
              type="text"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="algo-coach / sysdesign-guru"
              maxLength={64}
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              {t('cue_log.stages_count')} {stages.length} / 5
            </label>
            {stages.length < 5 && (
              <button
                type="button"
                onClick={onAddStage}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-border-strong hover:text-text-primary"
              >
                <Plus className="h-3 w-3" /> {t('cue_log.stage')}
              </button>
            )}
          </div>
          {stages.map((stage, idx) => (
            <StageRow
              key={idx}
              draft={stage}
              stageLabels={STAGE_LABEL}
              onChange={(patch) => onUpdateStage(idx, patch)}
              onRemove={stages.length > 1 ? () => onRemoveStage(idx) : undefined}
            />
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="cue-summary"
            className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted"
          >
            {t('cue_log.ai_summary_optional')}
          </label>
          <textarea
            id="cue-summary"
            value={aiSummary}
            onChange={(e) => setAiSummary(e.target.value)}
            rows={2}
            maxLength={400}
            placeholder="Strong algo, weak sysdesign rate-limiting — focus next 2 weeks"
            className="resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
          />
        </div>

        <footer className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('cue_log.cancel')}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {t('cue_log.log')}
          </Button>
        </footer>
      </form>
    </Modal>
  )
}

function StageRow({
  draft,
  stageLabels,
  onChange,
  onRemove,
}: {
  draft: StageDraft
  stageLabels: Record<CueSessionStage, string>
  onChange: (patch: Partial<StageDraft>) => void
  onRemove?: () => void
}) {
  const { t } = useTranslation('wave14')
  return (
    <div className="relative rounded-md border border-border bg-surface-2 p-3">
      {/* Active visual cue: red 1.5px top stripe только если selfRating <=2
          (signals struggling — visual emphasis из B/W rule). */}
      {draft.selfRating !== undefined && draft.selfRating <= 2 && (
        <span
          aria-hidden
          className="absolute left-0 right-0 top-0 h-[1.5px] rounded-t-md"
          style={{ background: '#FF3B30' }}
        />
      )}
      <div className="flex items-center gap-2">
        <select
          value={draft.stage}
          onChange={(e) => onChange({ stage: e.target.value as CueSessionStage })}
          className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-text-primary focus:border-text-primary focus:outline-none"
        >
          {STAGE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {stageLabels[s]}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <RatingPicker
          value={draft.selfRating}
          onChange={(r) => onChange({ selfRating: r })}
        />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('cue_log.delete_stage')}
            className="rounded-md p-1 text-text-muted hover:bg-bg hover:text-text-primary"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <textarea
        value={draft.notes}
        onChange={(e) => onChange({ notes: e.target.value })}
        rows={2}
        maxLength={400}
        placeholder={t('cue_log.stage_placeholder')}
        className="mt-2 w-full resize-none rounded-md border border-border bg-bg px-2.5 py-1.5 text-[12.5px] text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
      />
    </div>
  )
}

function RatingPicker({
  value,
  onChange,
}: {
  value: 1 | 2 | 3 | 4 | 5 | undefined
  onChange: (r: 1 | 2 | 3 | 4 | 5 | undefined) => void
}) {
  const ratings: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5]
  return (
    <div className="flex items-center gap-0.5">
      {ratings.map((r) => {
        const active = value !== undefined && r <= value
        return (
          <button
            key={r}
            type="button"
            onClick={() => onChange(value === r ? undefined : r)}
            aria-label={`${r} / 5`}
            title={`${r} / 5`}
            className={cn(
              'grid h-5 w-5 place-items-center rounded font-mono text-[10px] transition-colors',
              active
                ? 'bg-text-primary text-bg'
                : 'border border-border bg-bg text-text-muted hover:border-border-strong',
            )}
          >
            {r}
          </button>
        )
      })}
    </div>
  )
}
