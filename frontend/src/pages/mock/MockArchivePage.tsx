// MockArchivePage — archive of the user's past mock-interview sessions.
//
// Before this page the user had no way to revisit prior mocks — the
// "start → finish → close report" flow lost the link to the report card.
// `/mock/archive` now lists paginated sessions (date, section, difficulty,
// duration, status); a click opens `/mock/:id/result` (existing surface).
//
// Server endpoint: GET /api/v1/mock/sessions (ai_mock service,
// MockServer.ListSessions). Summary rows only — heavy fields (messages,
// report, stress) live behind the existing per-id endpoints.

import { Link } from 'react-router-dom'
import { useState } from 'react'

import { AppShellV2 } from '../../components/AppShell'
import {
  useMockSessionsListQuery,
  type MockSessionSummary,
} from '../../lib/queries/mock'
import { DataLoader } from '../../components/DataLoader'

const PAGE_SIZE = 20

export default function MockArchivePage() {
  const [page, setPage] = useState(0)
  const offset = page * PAGE_SIZE
  const query = useMockSessionsListQuery(PAGE_SIZE, offset)

  return (
    <AppShellV2>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            ARCHIVE
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-text-primary">
            Past mock sessions
          </h1>
          <p className="mt-2 max-w-prose text-sm text-text-secondary">
            History of your AI interviews. Click any row to open the report
            with scores and the stress profile.
          </p>
        </header>

        <DataLoader
          state={query}
          section="mock-archive"
          empty={(d) => d.sessions.length === 0 && page === 0}
          emptyContent={<EmptyState />}
        >
          {(data) => {
            const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
            return (
              <>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1">
                  {data.sessions.map((s) => (
                    <SessionRow key={s.id} session={s} />
                  ))}
                </ul>
                {totalPages > 1 && (
                  <nav
                    aria-label="Pagination"
                    className="mt-4 flex items-center justify-between"
                  >
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="rounded-full border border-border bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ← Prev
                    </button>
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                      Page {page + 1} of {totalPages} · {data.total} total
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page + 1 >= totalPages}
                      className="rounded-full border border-border bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next →
                    </button>
                  </nav>
                )}
              </>
            )
          }}
        </DataLoader>
      </div>
    </AppShellV2>
  )
}

function SessionRow({ session }: { session: MockSessionSummary }) {
  const date = formatRowDate(session.created_at ?? session.started_at)
  const sectionLabel = humaniseSection(session.section)
  const difficultyLabel = humaniseDifficulty(session.difficulty)
  const statusLabel = humaniseStatus(session.status)
  // If session is not yet finished, click goes back to the live session
  // surface (`/mock/:id`); otherwise to the result/report page.
  const isFinished = Boolean(session.finished_at)
  const href = isFinished ? `/mock/${session.id}/result` : `/mock/${session.id}`

  return (
    <li>
      <Link
        to={href}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 truncate font-display text-[13.5px] font-semibold text-text-primary">
            {session.task_title || `${sectionLabel} · ${difficultyLabel}`}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-text-muted">
            {date} · {sectionLabel} · {difficultyLabel} · {session.duration_min} min
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-transparent px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-text-secondary">
          {statusLabel}
        </span>
      </Link>
    </li>
  )
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-transparent px-6 py-12 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        ARCHIVE IS EMPTY
      </p>
      <p className="mt-3 text-sm text-text-secondary">
        Past mock sessions show up here after your first AI interview. Start
        one — coach will remember the result and the archive begins to grow.
      </p>
      <Link
        to="/mock"
        className="mt-5 inline-block rounded-full border border-text-primary bg-text-primary px-4 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-bg transition-opacity hover:opacity-90"
      >
        Start mock →
      </Link>
    </div>
  )
}

// Wire sends ISO timestamps. Empty / unparseable → '—'.
function formatRowDate(iso: string | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const d = new Date(t)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const day = d.getDate()
  const month = months[d.getMonth()]
  const year = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${day} ${month} ${year} · ${hh}:${mm}`
}

// Proto enum string → human label. Wire может прислать «SECTION_ALGORITHMS»,
// "algorithms" или lower-case. Берём чётко известные значения, иначе lower.
function humaniseSection(s: string): string {
  const key = s.replace(/^SECTION_/, '').toLowerCase()
  switch (key) {
    case 'algorithms': return 'Algorithms'
    case 'system_design': return 'System Design'
    case 'behavioral': return 'Behavioral'
    case 'coding': return 'Coding'
    case 'english_hr': return 'English HR'
    case 'ml': return 'ML'
    default: return key || '—'
  }
}

function humaniseDifficulty(s: string): string {
  const key = s.replace(/^DIFFICULTY_/, '').toLowerCase()
  switch (key) {
    case 'easy': return 'Easy'
    case 'medium': return 'Medium'
    case 'hard': return 'Hard'
    default: return key || '—'
  }
}

function humaniseStatus(s: string): string {
  const key = s.replace(/^MOCK_STATUS_/, '').toLowerCase()
  switch (key) {
    case 'live':
    case 'in_progress':
      return 'live'
    case 'finished':
    case 'completed':
      return 'finished'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    default: return key || '—'
  }
}
