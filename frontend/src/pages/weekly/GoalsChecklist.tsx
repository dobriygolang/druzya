import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus, X } from 'lucide-react'

// ============================================================================
// 8. <GoalsChecklist weekISO /> — localStorage backed
// ============================================================================

type Goal = { id: string; text: string; done: boolean }

export function GoalsChecklist({ weekISO }: { weekISO: string }) {
  const { t } = useTranslation('wave14')
  const storageKey = `druz9.weekly.goals.${weekISO}`
  const [goals, setGoals] = useState<Goal[]>([])
  const [draft, setDraft] = useState('')
  const [hydrated, setHydrated] = useState(false)

  // Hydration из localStorage. Делаем в effect чтобы SSR-safe (хотя у нас
  // CSR-only сейчас — на всякий) и чтобы useState не дёргался при рендере.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as Goal[]
        if (Array.isArray(parsed)) setGoals(parsed.slice(0, 5))
      }
    } catch {
      // повреждённый JSON в localStorage — игнорим, начинаем с пустого
    }
    setHydrated(true)
  }, [storageKey])

  // Persist — только после первой гидратации, чтобы не затереть данные
  // пустым массивом до того как успели прочитать.
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(goals))
    } catch {
      // quota / private mode — silent fail, всё равно в памяти живёт
    }
  }, [goals, storageKey, hydrated])

  function add() {
    const t = draft.trim()
    if (!t || goals.length >= 5) return
    setGoals((g) => [...g, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: t, done: false }])
    setDraft('')
  }
  function toggle(id: string) {
    setGoals((g) => g.map((it) => (it.id === id ? { ...it, done: !it.done } : it)))
  }
  function remove(id: string) {
    setGoals((g) => g.filter((it) => it.id !== id))
  }

  const canAdd = draft.trim().length > 0 && goals.length < 5

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-surface-2 p-5 sm:p-7">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-text-primary">{t('weekly_extra.goals_next_week')}</h2>
        <span className="font-mono text-[11px] tracking-[0.08em] text-text-muted">{goals.length}/5</span>
      </div>
      <div className="flex flex-col gap-2">
        {goals.map((g) => (
          <div
            key={g.id}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2"
          >
            <button
              type="button"
              onClick={() => toggle(g.id)}
              className={`grid h-5 w-5 place-items-center rounded border transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)] ${
                g.done ? 'border-border-strong bg-text-primary/10' : 'border-border bg-transparent'
              }`}
              aria-label={g.done ? t('weekly_extra.uncheck') : t('weekly_extra.check_done')}
            >
              {g.done && <Check className="h-3 w-3 text-text-primary" />}
            </button>
            <span
              className={`flex-1 text-sm ${g.done ? 'text-text-muted line-through' : 'text-text-primary'}`}
            >
              {g.text}
            </span>
            <button
              type="button"
              onClick={() => remove(g.id)}
              className="grid h-9 w-9 place-items-center rounded text-text-muted transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)] hover:text-text-primary"
              style={{ ['--hover-red' as string]: 'var(--red)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--red)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = ''
              }}
              aria-label={t('weekly_extra.delete')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {goals.length === 0 && (
          <span className="text-[12px] text-text-muted">{t('weekly_extra.goals_hint')}</span>
        )}
      </div>
      {goals.length < 5 && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            placeholder={t('weekly_extra.goal_placeholder')}
            maxLength={100}
            className="flex-1 border-0 border-b border-solid bg-transparent px-1 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)] focus:outline-none"
            style={{ borderBottomColor: 'var(--hair-2)' }}
            onFocus={(e) => {
              e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderBottomColor = 'var(--hair-2)'
            }}
          />
          <button
            type="button"
            onClick={add}
            disabled={!canAdd}
            className="grid h-9 w-9 place-items-center rounded-lg bg-text-primary text-bg transition-opacity duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t('weekly_extra.add_goal')}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  )
}
