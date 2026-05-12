// TutorDirectoryPane — Phase K T1 (P0) 2026-05-12.
//
// Tutor-side panel inside /tutor/directory tab. Two sections:
//   1. Profile editor — visible toggle + bio + chips + optional fields.
//   2. Pending applications — accept / decline.
//
// Identity rule: free per identity. NO rate input, NO pricing UI.
import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from './Button'
import { Card } from './Card'
import { ApiError } from '../lib/apiClient'
import {
  TUTOR_EXPERTISE_TAGS,
  TUTOR_EXPERTISE_TAG_LABELS,
  TUTOR_LANGUAGE_CODES,
  TUTOR_LANGUAGE_LABELS,
  useAcceptApplicationMutation,
  useDeclineApplicationMutation,
  useMyDirectoryProfileQuery,
  usePendingApplicationsQuery,
  useUpsertDirectoryProfileMutation,
  type TutorExpertiseTag,
  type TutorLanguageCode,
} from '../lib/queries/tutor'

export function TutorDirectoryPane() {
  return (
    <div className="flex flex-col gap-8">
      <ProfileEditor />
      <PendingApplications />
    </div>
  )
}

function ProfileEditor() {
  const q = useMyDirectoryProfileQuery()
  const upsert = useUpsertDirectoryProfileMutation()
  const [visible, setVisible] = useState(false)
  const [bio, setBio] = useState('')
  const [tags, setTags] = useState<TutorExpertiseTag[]>([])
  const [langs, setLangs] = useState<TutorLanguageCode[]>([])
  const [tz, setTz] = useState('')
  const [availability, setAvailability] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [github, setGithub] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)

  // Seed local form state from server profile on first load.
  useEffect(() => {
    const p = q.data?.profile
    if (!p) return
    setVisible(p.visible)
    setBio(p.bio_md ?? '')
    setTags((p.expertise_tags ?? []).filter(isExpertiseTag))
    setLangs((p.languages ?? []).filter(isLanguageCode))
    setTz(
      p.timezone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone ??
        '',
    )
    setAvailability(p.availability_md ?? '')
    setLinkedin(p.linkedin_url ?? '')
    setGithub(p.github_url ?? '')
  }, [q.data])

  const verified = useMemo(() => Boolean(q.data?.profile?.verified_at), [q.data])

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    if (upsert.isPending) return
    upsert.mutate(
      {
        visible,
        bio_md: bio,
        expertise_tags: tags,
        languages: langs,
        timezone: tz.trim(),
        availability_md: availability,
        linkedin_url: linkedin.trim(),
        github_url: github.trim(),
      },
      {
        onSuccess: () => {
          setSavedAt(new Date().toLocaleTimeString())
        },
      },
    )
  }

  if (q.isLoading) {
    return (
      <Card className="flex h-32 items-center justify-center p-6 text-text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </Card>
    )
  }

  const cannotEnableVisible = visible && bio.trim() === ''

  return (
    <Card className="flex flex-col gap-5 p-6">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          Profile · directory
        </span>
        <h2 className="text-lg font-semibold">Твой публичный профиль</h2>
        <p className="text-sm text-text-secondary">
          Когда «Видимый» включён, твой профиль появляется в{' '}
          <code className="font-mono text-[12px]">/tutors/discover</code> и
          студенты могут отправлять заявки. Без денег и часовых ставок —
          identity-led.
        </p>
      </header>

      <form className="flex flex-col gap-5" onSubmit={handleSave}>
        {/* Visible toggle */}
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
            className="h-4 w-4 accent-text-primary"
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium text-text-primary">
              Видимый в директории
            </span>
            <span className="font-mono text-[11px] text-text-muted">
              Студенты увидят аватар, имя, био и тэги.
            </span>
          </span>
          {verified && (
            <span className="ml-auto inline-flex h-5 items-center rounded-full bg-text-primary/10 px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-primary">
              verified
            </span>
          )}
        </label>

        {/* Bio */}
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            Bio (markdown)
          </span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={2000}
            rows={5}
            placeholder="Senior Go-инженер из Алматы. Готовлю к собесам в FAANG-tier..."
            className="resize-y rounded-md border border-border-strong bg-transparent p-3 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
          />
          <span className="self-end font-mono text-[10px] text-text-muted">
            {bio.length}/2000
          </span>
        </label>

        {/* Expertise chips */}
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            Экспертиза
          </span>
          <div className="flex flex-wrap gap-2">
            {TUTOR_EXPERTISE_TAGS.map((t) => {
              const active = tags.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() =>
                    setTags((prev) =>
                      prev.includes(t)
                        ? prev.filter((x) => x !== t)
                        : [...prev, t],
                    )
                  }
                  className={`inline-flex h-8 items-center rounded-full border px-3 text-[12px] transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] ${
                    active
                      ? 'border-text-primary bg-text-primary text-bg'
                      : 'border-border-strong bg-transparent text-text-primary hover:bg-text-primary/5'
                  }`}
                >
                  {TUTOR_EXPERTISE_TAG_LABELS[t]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Language chips */}
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            Язык преподавания
          </span>
          <div className="flex flex-wrap gap-2">
            {TUTOR_LANGUAGE_CODES.map((l) => {
              const active = langs.includes(l)
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() =>
                    setLangs((prev) =>
                      prev.includes(l)
                        ? prev.filter((x) => x !== l)
                        : [...prev, l],
                    )
                  }
                  className={`inline-flex h-8 items-center rounded-full border px-3 text-[12px] transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] ${
                    active
                      ? 'border-text-primary bg-text-primary text-bg'
                      : 'border-border-strong bg-transparent text-text-primary hover:bg-text-primary/5'
                  }`}
                >
                  {TUTOR_LANGUAGE_LABELS[l]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Timezone */}
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            Часовой пояс
          </span>
          <input
            type="text"
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            placeholder="Europe/Moscow"
            className="rounded-md border border-border-strong bg-transparent p-2 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
          />
        </label>

        {/* Availability */}
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            Когда доступен (markdown)
          </span>
          <textarea
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
            rows={3}
            placeholder="Будни 18:00–21:00 MSK, выходные по договорённости"
            className="resize-y rounded-md border border-border-strong bg-transparent p-3 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
          />
        </label>

        {/* Verification hints */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
              LinkedIn URL
            </span>
            <input
              type="url"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="https://linkedin.com/in/..."
              className="rounded-md border border-border-strong bg-transparent p-2 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
              GitHub URL
            </span>
            <input
              type="url"
              value={github}
              onChange={(e) => setGithub(e.target.value)}
              placeholder="https://github.com/..."
              className="rounded-md border border-border-strong bg-transparent p-2 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
            />
          </label>
        </div>

        {/* TODO(verification): admin sets verified_at via DB update. Future
            iteration may add a SetVerified RPC / interview application
            review flow. Not blocking for T1 MVP. */}

        {upsert.isError && (
          <p className="font-mono text-[12px] text-danger">
            {(upsert.error as ApiError | null)?.message ?? 'Save failed.'}
          </p>
        )}

        {cannotEnableVisible && (
          <p className="font-mono text-[12px] text-text-muted">
            Чтобы стать видимым, заполни bio.
          </p>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          {savedAt ? (
            <span className="font-mono text-[11px] text-text-muted">
              Saved · {savedAt}
            </span>
          ) : (
            <span />
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={cannotEnableVisible}
            loading={upsert.isPending}
          >
            Сохранить
          </Button>
        </div>
      </form>
    </Card>
  )
}

function PendingApplications() {
  const q = usePendingApplicationsQuery()
  const accept = useAcceptApplicationMutation()
  const decline = useDeclineApplicationMutation()

  const items = q.data?.items ?? []

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Pending applications</h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          {items.length} pending
        </span>
      </header>
      {q.isLoading && (
        <div className="flex h-20 items-center justify-center text-text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      {!q.isLoading && items.length === 0 && (
        <Card className="p-6">
          <p className="text-sm text-text-secondary">
            Пока нет новых заявок. Когда студенты найдут твой профиль в{' '}
            <code className="font-mono text-[12px]">/tutors/discover</code>{' '}
            и нажмут Apply, они появятся здесь.
          </p>
        </Card>
      )}
      <ul className="flex flex-col gap-3">
        {items.map((a) => {
          const display =
            a.student_display_name || a.student_username || 'без имени'
          const initial = display.trim().slice(0, 1).toUpperCase() || '?'
          return (
            <Card key={a.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4">
              {a.student_avatar_url ? (
                <img
                  src={a.student_avatar_url}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-text-primary/10 text-sm font-semibold text-text-primary">
                  {initial}
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-text-primary">
                      {display}
                    </span>
                    {a.student_username && (
                      <span className="font-mono text-[11px] text-text-muted">
                        @{a.student_username}
                      </span>
                    )}
                  </div>
                  {a.created_at && (
                    <span className="font-mono text-[10px] text-text-muted">
                      {new Date(a.created_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {a.message && (
                  <p className="whitespace-pre-wrap text-sm text-text-secondary">
                    {a.message}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={accept.isPending && accept.variables === a.id}
                    onClick={() => accept.mutate(a.id)}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={decline.isPending && decline.variables === a.id}
                    onClick={() => decline.mutate(a.id)}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            </Card>
          )
        })}
      </ul>
    </section>
  )
}

function isExpertiseTag(s: string): s is TutorExpertiseTag {
  return (TUTOR_EXPERTISE_TAGS as readonly string[]).includes(s)
}
function isLanguageCode(s: string): s is TutorLanguageCode {
  return (TUTOR_LANGUAGE_CODES as readonly string[]).includes(s)
}
