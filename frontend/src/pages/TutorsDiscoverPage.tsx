// Public-ish (auth-gated) discovery surface: students browse visible
// tutor profiles, filter by expertise/language chip, и apply.
//
// Identity rule: free per identity, no rates / payments. The page never
// renders pricing UI; «Apply» dispatches a free pending application.
//
// Route: /tutors/discover.
// Backend: ListDirectoryTutors RPC at /api/v1/tutor/directory.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ApiError } from '../lib/apiClient'
import {
  TUTOR_EXPERTISE_TAGS,
  TUTOR_EXPERTISE_TAG_LABELS,
  TUTOR_LANGUAGE_CODES,
  TUTOR_LANGUAGE_LABELS,
  useApplyToTutorMutation,
  useDirectoryTutorsQuery,
  type TutorDirectoryEntry,
  type TutorExpertiseTag,
  type TutorLanguageCode,
} from '../lib/queries/tutor'

export default function TutorsDiscoverPage() {
  const { t } = useTranslation('pages')
  const [tags, setTags] = useState<TutorExpertiseTag[]>([])
  const [langs, setLangs] = useState<TutorLanguageCode[]>([])
  const [activeTutor, setActiveTutor] = useState<TutorDirectoryEntry | null>(
    null,
  )

  const { data, isLoading, error } = useDirectoryTutorsQuery(
    { expertise_tags: tags, languages: langs },
    50,
  )

  const items = useMemo(() => data?.items ?? [], [data])

  const toggleTag = (t: TutorExpertiseTag) => {
    setTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    )
  }
  const toggleLang = (l: TutorLanguageCode) => {
    setLangs((prev) =>
      prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l],
    )
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10 sm:px-8 sm:py-14">
        <header className="flex flex-col gap-2">
          <Link
            to="/today"
            className="font-mono text-[12px] tracking-[0.08em] text-text-muted transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary"
          >
            {t('tutors_discover.back_home')}
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            {t('tutors_discover.eyebrow')}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t('tutors_discover.title')}
          </h1>
          <p className="max-w-2xl text-sm text-text-secondary">
            {t('tutors_discover.subtitle')}
          </p>
        </header>

        {/* Filter chips */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
              {t('tutors_discover.filter_expertise')}
            </span>
            {TUTOR_EXPERTISE_TAGS.map((t) => {
              const active = tags.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
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

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
              {t('tutors_discover.filter_language')}
            </span>
            {TUTOR_LANGUAGE_CODES.map((l) => {
              const active = langs.includes(l)
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => toggleLang(l)}
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
            {(tags.length > 0 || langs.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setTags([])
                  setLangs([])
                }}
                className="ml-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted hover:text-text-primary"
              >
                {t('tutors_discover.filter_reset')}
              </button>
            )}
          </div>
        </section>

        {/* List */}
        <section className="flex flex-col gap-4">
          {isLoading && (
            <div className="flex h-32 items-center justify-center text-text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {error && (
            <Card className="flex flex-col gap-2 p-6">
              <p className="text-sm text-text-primary">
                {t('tutors_discover.load_failed')}
              </p>
              <p className="font-mono text-[12px] text-text-muted">
                {error instanceof ApiError ? error.message : String(error)}
              </p>
            </Card>
          )}
          {!isLoading && !error && items.length === 0 && (
            <Card className="flex flex-col gap-2 p-6">
              <p className="text-sm text-text-primary">
                {t('tutors_discover.empty_filters')}
              </p>
              <p className="text-sm text-text-secondary">
                {t('tutors_discover.empty_hint')}
              </p>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {items.map((entry) => (
              <TutorCard
                key={entry.user_id}
                entry={entry}
                onApply={() => setActiveTutor(entry)}
              />
            ))}
          </div>
        </section>
      </div>

      {activeTutor && (
        <ApplyModal
          tutor={activeTutor}
          onClose={() => setActiveTutor(null)}
        />
      )}
    </div>
  )
}

function TutorCard({
  entry,
  onApply,
}: {
  entry: TutorDirectoryEntry
  onApply: () => void
}) {
  const { t } = useTranslation('pages')
  const display = entry.display_name || entry.username || t('tutors_discover.no_name')
  const initial = display.trim().slice(0, 1).toUpperCase() || '?'
  const bioFirstLine = (entry.bio_md || '').split('\n')[0].trim()
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        {entry.avatar_url ? (
          <img
            src={entry.avatar_url}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-text-primary/10 text-base font-semibold text-text-primary">
            {initial}
          </div>
        )}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-text-primary">
              {display}
            </span>
            {entry.verified && (
              <span
                title={t('tutors_discover.verified_title')}
                className="inline-flex h-4 items-center rounded-full bg-text-primary/10 px-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-text-primary"
              >
                verified
              </span>
            )}
          </div>
          {entry.username && (
            <span className="font-mono text-[11px] tracking-[0.04em] text-text-muted">
              @{entry.username}
            </span>
          )}
        </div>
      </div>

      {bioFirstLine && (
        <p className="line-clamp-3 text-sm text-text-secondary">
          {bioFirstLine}
        </p>
      )}

      {(entry.expertise_tags?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entry.expertise_tags.slice(0, 5).map((t) => (
            <span
              key={t}
              className="inline-flex h-6 items-center rounded-full border border-border-strong px-2 text-[11px] text-text-secondary"
            >
              {(TUTOR_EXPERTISE_TAG_LABELS as Record<string, string>)[t] ?? t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          {(entry.languages || []).join(' · ')}
          {entry.timezone ? ` · ${entry.timezone}` : ''}
        </span>
        <Button variant="primary" size="sm" onClick={onApply}>
          {t('tutors_discover.apply_btn')}
        </Button>
      </div>
    </Card>
  )
}

function ApplyModal({
  tutor,
  onClose,
}: {
  tutor: TutorDirectoryEntry
  onClose: () => void
}) {
  const { t } = useTranslation('pages')
  const [message, setMessage] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const mutation = useApplyToTutorMutation()

  const display = tutor.display_name || tutor.username || t('tutors_discover.no_name')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mutation.isPending) return
    mutation.mutate(
      { tutor_user_id: tutor.user_id, message: message.trim() },
      {
        onSuccess: () => setSubmitted(true),
      },
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-modal-title"
      className="fixed inset-0 z-40 flex items-end justify-center bg-bg/80 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl border border-border-strong bg-bg p-6 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {submitted ? (
          <div className="flex flex-col gap-4">
            <h2 id="apply-modal-title" className="text-lg font-semibold">
              {t('tutors_discover.application_sent_title')}
            </h2>
            <p className="text-sm text-text-secondary">
              {t('tutors_discover.application_sent_body')}
            </p>
            <Button variant="primary" onClick={onClose}>
              {t('tutors_discover.close_btn')}
            </Button>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div>
              <h2 id="apply-modal-title" className="text-lg font-semibold">
                {t('tutors_discover.apply_to', { name: display })}
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                {t('tutors_discover.apply_subtitle')}
              </p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
                {t('tutors_discover.message_label')}
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={500}
                rows={5}
                placeholder={t('tutors_discover.message_placeholder')}
                className="resize-none rounded-md border border-border-strong bg-transparent p-3 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
              />
              <span className="self-end font-mono text-[10px] text-text-muted">
                {message.length}/500
              </span>
            </label>

            {mutation.isError && (
              <p className="font-mono text-[12px] text-danger">
                {(mutation.error as ApiError | null)?.message ??
                  t('tutors_discover.submit_failed')}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={mutation.isPending}
              >
                {t('tutors_discover.cancel_btn')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={mutation.isPending}
              >
                {t('tutors_discover.submit_btn')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
