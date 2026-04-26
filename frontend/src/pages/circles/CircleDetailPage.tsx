// /circles/:id — circle detail с членами + создание events для этого circle.
//
// Создание event'а доступно admin'у circle (server-side gate, кнопка
// показывается всем — на 403 покажем error). Пользователь может прикрепить
// editor_room_id или whiteboard_room_id если хочет, чтобы event автоматически
// открывал нужную комнату в Hone (Phase 6.5.3 smart-routing).
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Calendar, ExternalLink, Users } from 'lucide-react'

import { AppShellV2 } from '../../components/AppShell'
import {
  createEvent,
  getCircle,
  leaveCircle,
  listMyEvents,
  type CalendarEvent,
  type Circle,
  type EventRecurrence,
} from '../../lib/queries/circles'

export default function CircleDetailPage() {
  const { circleId } = useParams<{ circleId: string }>()
  const [circle, setCircle] = useState<Circle | null>(null)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    // Дата и время хранятся отдельно — родной datetime-local'ьный пикер
    // плохо открывает время на десктопе, юзеры жаловались. Склеиваем в
    // ISO в момент submit'а через combineDateTime.
    starts_date: '',
    starts_time: '',
    duration_min: 60,
    editor_room_id: '',
    whiteboard_room_id: '',
    recurrence: 'none' as EventRecurrence,
  })
  const [showAdvanced, setShowAdvanced] = useState(false)

  const reload = async () => {
    if (!circleId) return
    try {
      const [c, allEvents] = await Promise.all([getCircle(circleId), listMyEvents()])
      setCircle(c)
      setEvents(allEvents.filter((e) => e.circle_id === circleId))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void reload()
  }, [circleId])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!circleId || !form.title.trim() || !form.starts_date || !form.starts_time) return
    setSubmitting(true)
    try {
      await createEvent({
        circle_id: circleId,
        title: form.title.trim(),
        description: form.description.trim(),
        starts_at: combineDateTime(form.starts_date, form.starts_time),
        duration_min: Number(form.duration_min) || 60,
        editor_room_id: form.editor_room_id.trim() || undefined,
        whiteboard_room_id: form.whiteboard_room_id.trim() || undefined,
        recurrence: form.recurrence,
      })
      setForm({
        title: '',
        description: '',
        starts_date: '',
        starts_time: '',
        duration_min: 60,
        editor_room_id: '',
        whiteboard_room_id: '',
        recurrence: 'none',
      })
      setShowForm(false)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const onLeave = async () => {
    if (!circleId) return
    if (!confirm('Leave this circle?')) return
    try {
      await leaveCircle(circleId)
      // Cannot navigate from here without router import — redirect via location.
      window.location.href = '/circles'
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <AppShellV2>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8 lg:py-14">
        <Link
          to="/circles"
          className="mb-6 inline-flex items-center gap-1 text-[12px] font-mono uppercase tracking-wider text-text-muted transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-3 w-3" /> All circles
        </Link>

        {error && (
          <div className="mb-6 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-[13px] text-text-secondary">
            {error}
          </div>
        )}

        {circle === null ? (
          <p className="text-[13px] text-text-muted">Loading…</p>
        ) : (
          <>
            <header className="mb-8">
              <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl">
                {circle.name}
              </h1>
              {circle.description && (
                <p className="mt-2 text-[14px] text-text-secondary">{circle.description}</p>
              )}
              <div className="mt-3 flex items-center gap-4 text-[12px] font-mono uppercase tracking-wider text-text-muted">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {circle.member_count || circle.members?.length || 1} members
                </span>
                <button
                  onClick={() => void onLeave()}
                  className="text-text-muted transition-colors hover:text-text-primary"
                >
                  Leave
                </button>
              </div>
            </header>

            {circle.members && circle.members.length > 0 && (
              <section className="mb-10">
                <div className="mb-3 text-[11px] uppercase tracking-wider text-text-muted">
                  Members
                </div>
                <div className="flex flex-wrap gap-2">
                  {circle.members.map((m) => (
                    <span
                      key={m.user_id}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-1 px-3 py-1 text-[12px] text-text-secondary"
                    >
                      {m.username || m.user_id.slice(0, 6)}
                      {m.role === 'admin' && (
                        <span className="text-[10px] font-mono uppercase text-text-primary">admin</span>
                      )}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-text-muted">
                  Events
                </div>
                <button
                  onClick={() => setShowForm((s) => !s)}
                  className="text-[12px] font-medium text-text-primary transition-colors hover:underline"
                >
                  {showForm ? 'Cancel' : '+ New event'}
                </button>
              </div>

              {showForm && (
                <form
                  onSubmit={onSubmit}
                  className="mb-6 space-y-3 rounded-xl border border-border bg-surface-1 p-5"
                >
                  <input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Friday Read · Chapter 4"
                    className="w-full bg-transparent text-[15px] font-medium text-text-primary outline-none placeholder:text-text-muted"
                  />
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Что обсудим"
                    rows={2}
                    className="w-full resize-none bg-transparent text-[13px] text-text-secondary outline-none placeholder:text-text-muted"
                  />
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <label className="text-[12px] text-text-muted">
                      Date
                      <input
                        type="date"
                        required
                        value={form.starts_date}
                        onChange={(e) => setForm({ ...form, starts_date: e.target.value })}
                        className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[13px] text-text-primary"
                      />
                    </label>
                    <label className="text-[12px] text-text-muted">
                      Time
                      <input
                        type="time"
                        required
                        step={300}
                        value={form.starts_time}
                        onChange={(e) => setForm({ ...form, starts_time: e.target.value })}
                        className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[13px] text-text-primary"
                      />
                    </label>
                    <label className="text-[12px] text-text-muted">
                      Duration (min)
                      <input
                        type="number"
                        min={5}
                        step={5}
                        value={form.duration_min}
                        onChange={(e) => setForm({ ...form, duration_min: Number(e.target.value) })}
                        className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[13px] text-text-primary"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider">
                    <span className="text-text-muted">quick</span>
                    {datetimePresets().map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() =>
                          setForm({ ...form, starts_date: p.date, starts_time: p.time })
                        }
                        className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-text-secondary hover:border-text-primary hover:text-text-primary"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="font-mono text-[11px] uppercase tracking-wider text-text-muted hover:text-text-primary"
                  >
                    {showAdvanced ? 'Hide advanced' : 'Advanced ▾'}
                  </button>
                  {showAdvanced && (
                    <div className="space-y-3 border-t border-border pt-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="text-[12px] text-text-muted">
                          Editor room id (optional)
                          <input
                            value={form.editor_room_id}
                            onChange={(e) => setForm({ ...form, editor_room_id: e.target.value })}
                            placeholder="UUID комнаты-редактора"
                            className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-[11px] text-text-primary"
                          />
                          <span className="mt-1 block font-mono text-[10px] text-text-muted">
                            из URL <code className="text-text-secondary">/editor/&lt;id&gt;</code> — UUID после слэша
                          </span>
                        </label>
                        <label className="text-[12px] text-text-muted">
                          Whiteboard room id (optional)
                          <input
                            value={form.whiteboard_room_id}
                            onChange={(e) =>
                              setForm({ ...form, whiteboard_room_id: e.target.value })
                            }
                            placeholder="UUID доски"
                            className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-[11px] text-text-primary"
                          />
                          <span className="mt-1 block font-mono text-[10px] text-text-muted">
                            из URL <code className="text-text-secondary">/whiteboard/&lt;id&gt;</code>
                          </span>
                        </label>
                      </div>
                      <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[11px] text-text-secondary">
                        Если укажешь — на карточке event'а появятся кнопки «Open editor» / «Open whiteboard» с прямой ссылкой на эту комнату.
                      </p>
                      <label className="block text-[12px] text-text-muted">
                        Recurrence
                        <select
                          value={form.recurrence}
                          onChange={(e) =>
                            setForm({ ...form, recurrence: e.target.value as EventRecurrence })
                          }
                          className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[13px] text-text-primary"
                        >
                          <option value="none">One-off</option>
                          <option value="weekly_friday">Weekly · Friday</option>
                        </select>
                      </label>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={
                        submitting ||
                        !form.title.trim() ||
                        !form.starts_date ||
                        !form.starts_time
                      }
                      className="rounded-lg bg-text-primary px-4 py-2 text-[13px] font-semibold text-bg disabled:opacity-50"
                    >
                      {submitting ? 'Saving…' : 'Create event'}
                    </button>
                  </div>
                </form>
              )}

              {events.length === 0 ? (
                <p className="text-[13px] text-text-muted">
                  Пока ни одного. Создай событие сверху.
                </p>
              ) : (
                <ul className="space-y-3">
                  {events.map((ev) => (
                    <li
                      key={ev.id}
                      className="rounded-lg border border-border bg-surface-1 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[15px] font-semibold text-text-primary">
                            {ev.title}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-text-muted">
                            <Calendar className="h-3 w-3" />
                            {new Date(ev.starts_at).toLocaleString()}
                            <span>·</span>
                            <span>{ev.duration_min} min</span>
                            {ev.recurrence === 'weekly_friday' && <span>· weekly</span>}
                          </div>
                          {ev.description && (
                            <p className="mt-2 text-[13px] text-text-secondary">
                              {ev.description}
                            </p>
                          )}
                          {(ev.editor_room_id || ev.whiteboard_room_id) && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {ev.editor_room_id && (
                                <Link
                                  to={`/editor/${ev.editor_room_id}`}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-2 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-primary hover:bg-surface-3"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Editor
                                </Link>
                              )}
                              {ev.whiteboard_room_id && (
                                <Link
                                  to={`/whiteboard/${ev.whiteboard_room_id}`}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-2 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-primary hover:bg-surface-3"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Whiteboard
                                </Link>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">
                          {(ev.participants?.length ?? 0)} going
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AppShellV2>
  )
}

// combineDateTime — склеивает значения <input type="date"> + <input
// type="time"> в локальный ISO для бэка. `new Date(date+T+time)` без
// зоны парсится как local time → toISOString() конвертит в UTC.
function combineDateTime(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString()
}

// datetimePresets — три быстрые кнопки чтобы юзер не возился с
// календарём. Сегодня вечер / завтра утро / ближайшая пятница 19:00.
function datetimePresets(): Array<{ label: string; date: string; time: string }> {
  const now = new Date()
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const today = new Date(now)
  const tomorrow = new Date(now.getTime() + 24 * 3600_000)
  const friday = new Date(now)
  // 5 = Friday в JS Date.getDay (0=Sun..6=Sat). Если уже пятница после
  // 19:00 — берём следующую.
  const offset = (5 - now.getDay() + 7) % 7 || (now.getHours() >= 19 ? 7 : 0)
  friday.setDate(now.getDate() + offset)
  return [
    { label: 'tonight 19:00', date: fmt(today), time: '19:00' },
    { label: 'tomorrow 10:00', date: fmt(tomorrow), time: '10:00' },
    { label: 'friday 19:00', date: fmt(friday), time: '19:00' },
  ]
}
