import { useEffect, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'

// ============================================================================
// 8. <GoalsChecklist weekISO /> — localStorage backed
// ============================================================================

type Goal = { id: string; text: string; done: boolean }

export function GoalsChecklist({ weekISO }: { weekISO: string }) {
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
        <h2 className="font-display text-lg font-bold text-text-primary">Цели на следующую неделю</h2>
        <span className="font-mono text-[11px] text-text-muted">{goals.length}/5</span>
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
              className={`grid h-5 w-5 place-items-center rounded border ${
                g.done ? 'border-success bg-success/20' : 'border-border bg-transparent'
              }`}
              aria-label={g.done ? 'Снять отметку' : 'Отметить выполненной'}
            >
              {g.done && <Check className="h-3 w-3 text-success" />}
            </button>
            <span
              className={`flex-1 text-sm ${g.done ? 'text-text-muted line-through' : 'text-text-primary'}`}
            >
              {g.text}
            </span>
            <button
              type="button"
              onClick={() => remove(g.id)}
              className="grid h-6 w-6 place-items-center rounded text-text-muted hover:text-danger"
              aria-label="Удалить"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {goals.length === 0 && (
          <span className="text-[12px] text-text-muted">Добавь до 5 целей — они сохранятся локально.</span>
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
            placeholder="Например: 5 LeetCode medium"
            maxLength={100}
            className="flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={add}
            disabled={!canAdd}
            className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Добавить цель"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  )
}
