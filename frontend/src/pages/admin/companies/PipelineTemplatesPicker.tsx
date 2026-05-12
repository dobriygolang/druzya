// PipelineTemplatesPicker — modal picker for pre-built pipeline templates.
//
// R7 Phase 1 — admin selects «Standard 3-stage» / «Yandex-like» /
// «Ozon-like» / «Product Manager» / «Blank» и одним кликом заменяет
// current pipeline. Confirmation step ставит цена в UX (template apply
// destructive — drop existing stages config).
//
// B/W only. Selected card = inverted (black bg, white text).
//
// 2026-05-12: migrated inline dialog to foundation Modal primitive
// (focus trap, ESC, scroll lock, smooth in/out). Selected card now
// shows 1.5×24px red signal stripe.

import { useState } from 'react'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/primitives/Modal'
import { ErrorBox, PanelSkeleton } from '../shared'
import {
  useApplyTemplateMutation,
  useStageTemplatesQuery,
  type StageTemplate,
} from '../../../lib/queries/adminCompanyPipeline'
import { mockAdminErrorMessage } from '../../../lib/queries/mockAdmin'

type Props = {
  companyId: string
  onClose: () => void
  onApplied?: () => void
}

export function PipelineTemplatesPicker({ companyId, onClose, onApplied }: Props) {
  const templates = useStageTemplatesQuery()
  const apply = useApplyTemplateMutation()
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const onApply = async () => {
    if (!selectedSlug) return
    setErr(null)
    try {
      await apply.mutateAsync({ companyId, templateSlug: selectedSlug })
      onApplied?.()
      onClose()
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Шаблоны пайплайна"
      description="Замени текущий пайплайн готовой схемой. Существующие этапы перезапишутся."
    >
      <div className="flex flex-col gap-4" style={{ maxHeight: '70vh' }}>
        <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
          {templates.isPending && <PanelSkeleton rows={4} />}
          {templates.error && (
            <ErrorBox message={mockAdminErrorMessage(templates.error)} />
          )}
          {templates.data && (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {templates.data.map((t) => (
                <TemplateCard
                  key={t.slug}
                  tpl={t}
                  active={selectedSlug === t.slug}
                  onSelect={() => setSelectedSlug(t.slug)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--hair-2)] pt-3">
          {err && (
            <p
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 12px',
                border: '1px solid rgba(255, 59, 48, 0.4)',
                borderRadius: 'var(--radius-inner)',
                fontSize: 12,
                color: 'var(--red)',
                background: 'transparent',
                margin: 0,
              }}
            >
              <span aria-hidden="true" style={{ display: 'inline-block', width: 1.5, minHeight: 16, background: 'var(--red)', marginTop: 4, flex: '0 0 auto' }} />
              {err}
            </p>
          )}
          {!confirming ? (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Отмена
              </Button>
              <Button
                size="sm"
                disabled={!selectedSlug}
                onClick={() => setConfirming(true)}
              >
                Выбрать
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-mono text-[11px] text-text-muted">
                Применить шаблон{' '}
                <span className="text-text-primary">«{selectedSlug}»</span>?
                Текущие этапы будут перезаписаны.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirming(false)}
                >
                  Назад
                </Button>
                <Button size="sm" loading={apply.isPending} onClick={onApply}>
                  Применить
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function TemplateCard({
  tpl,
  active,
  onSelect,
}: {
  tpl: StageTemplate
  active: boolean
  onSelect: () => void
}) {
  return (
    <li style={{ position: 'relative' }}>
      {active && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: -2,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 1.5,
            height: 24,
            background: 'var(--red)',
            zIndex: 1,
          }}
        />
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={`flex w-full flex-col gap-2 rounded-lg border px-3 py-2.5 text-left transition-[color,background,border-color] duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] ${
          active
            ? 'border-text-primary bg-text-primary text-bg'
            : 'border-border bg-surface-1 hover:border-border-strong'
        }`}
      >
        <div className="flex items-baseline justify-between">
          <span
            className={`font-display text-sm font-bold ${active ? 'text-bg' : 'text-text-primary'}`}
          >
            {tpl.name}
          </span>
          <span
            className={`font-mono text-[9px] uppercase ${active ? 'text-bg/70' : 'text-text-muted'}`}
          >
            {tpl.is_builtin ? 'builtin' : 'custom'}
          </span>
        </div>
        <span
          className={`font-mono text-[11px] ${active ? 'text-bg/80' : 'text-text-secondary'}`}
        >
          {tpl.description || '—'}
        </span>
        <div className="flex flex-wrap gap-1">
          {tpl.stages_json.length === 0 ? (
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                active ? 'border-bg/50 text-bg/80' : 'border-border text-text-muted'
              }`}
            >
              пусто
            </span>
          ) : (
            tpl.stages_json.map((s, i) => (
              <span
                key={`${tpl.slug}-${i}-${s.kind}`}
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase ${
                  active
                    ? 'border-bg/50 text-bg'
                    : 'border-border text-text-secondary'
                }`}
              >
                {s.kind}
              </span>
            ))
          )}
        </div>
      </button>
    </li>
  )
}
