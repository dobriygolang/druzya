// /circles — list + create. Единственное web-creation место для community-
// слоя (bible §9). Hone только показывает + RSVP.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Users } from 'lucide-react'

import { AppShellV2 } from '../../components/AppShell'
import {
  createCircle,
  listMyCircles,
  type Circle,
} from '../../lib/queries/circles'

export default function CirclesPage() {
  const navigate = useNavigate()
  const [circles, setCircles] = useState<Circle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })

  const reload = async () => {
    try {
      setCircles(await listMyCircles())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setCreating(true)
    try {
      const c = await createCircle({ name: form.name.trim(), description: form.description.trim() })
      navigate(`/circles/${c.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <AppShellV2>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8 lg:py-14">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl">
            Circles
          </h1>
          <p className="mt-2 text-[14px] text-text-muted">
            Сообщества по интересам. Внутри circle создаются events — Hone
            показывает их в календаре и пингует участников.
          </p>
        </div>

        <form
          onSubmit={onCreate}
          className="mb-10 rounded-xl border border-border bg-surface-1 p-5"
        >
          <div className="mb-2 text-[11px] uppercase tracking-wider text-text-muted">
            New circle
          </div>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Book Club Fridays"
            className="w-full bg-transparent text-[16px] font-medium text-text-primary outline-none placeholder:text-text-muted"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Что обсуждаем (опционально)"
            rows={2}
            className="mt-2 w-full resize-none bg-transparent text-[13px] text-text-secondary outline-none placeholder:text-text-muted"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="submit"
              disabled={creating || !form.name.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[13px] font-semibold text-bg disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>

        {error && (
          <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
            {error}
          </div>
        )}

        <div className="mb-3 text-[11px] uppercase tracking-wider text-text-muted">
          My circles
        </div>
        {circles === null ? (
          <p className="text-[13px] text-text-muted">Loading…</p>
        ) : circles.length === 0 ? (
          <p className="text-[13px] text-text-muted">
            Пока ни одного. Создай первый сверху.
          </p>
        ) : (
          <ul className="grid gap-3">
            {circles.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-border bg-surface-1 p-4 transition-colors hover:border-accent/40"
              >
                <Link to={`/circles/${c.id}`} className="block">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[15px] font-semibold text-text-primary">
                        {c.name}
                      </div>
                      {c.description && (
                        <div className="mt-1 text-[13px] text-text-secondary">
                          {c.description}
                        </div>
                      )}
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-text-muted">
                      <Users className="h-3 w-3" />
                      {c.member_count || 1}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShellV2>
  )
}
