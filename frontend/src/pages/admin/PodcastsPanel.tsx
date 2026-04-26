// ─── Podcasts CMS panel ─────────────────────────────────────────────────

import { useState, type FormEvent } from 'react'
import { Headphones, Trash2, Upload } from 'lucide-react'
import { Button } from '../../components/Button'
import {
  formatDuration,
  useCreateCategoryMutation,
  useCreatePodcastMutation,
  useDeletePodcastMutation,
  usePodcastCategoriesQuery,
  usePodcastsQuery,
} from '../../lib/queries/podcasts'
import { ErrorBox, PanelSkeleton } from './shared'
import { CategoryModal } from './PodcastCategoryModal'

export function PodcastsPanel() {
  const podcasts = usePodcastsQuery()
  const categories = usePodcastCategoriesQuery()
  const createMut = useCreatePodcastMutation()
  const deleteMut = useDeletePodcastMutation()
  const createCatMut = useCreateCategoryMutation()

  const [showCatModal, setShowCatModal] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // Controlled form state.
  const [title, setTitle] = useState('')
  const [host, setHost] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [episodeNum, setEpisodeNum] = useState('')
  const [durationSec, setDurationSec] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [isPublished, setIsPublished] = useState(true)
  const [audio, setAudio] = useState<File | null>(null)

  function resetForm() {
    setTitle('')
    setHost('')
    setDescription('')
    setCategoryId('')
    setEpisodeNum('')
    setDurationSec('')
    setCoverUrl('')
    setIsPublished(true)
    setAudio(null)
    setProgress(null)
    setFormError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!title.trim()) {
      setFormError('Название обязательно.')
      return
    }
    if (!audio) {
      setFormError('Выберите аудиофайл (mp3, m4a, opus…).')
      return
    }
    setProgress(0)
    try {
      await createMut.mutateAsync({
        title: title.trim(),
        host: host.trim() || undefined,
        description: description.trim() || undefined,
        categoryId: categoryId || undefined,
        episodeNum: episodeNum ? Number(episodeNum) : undefined,
        durationSec: durationSec ? Number(durationSec) : undefined,
        coverUrl: coverUrl.trim() || undefined,
        isPublished,
        audio,
        onProgress: (f) => setProgress(f),
      })
      resetForm()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось загрузить подкаст.'
      setFormError(msg)
      setProgress(null)
    }
  }

  return (
    <div className="flex flex-col gap-5 px-4 py-5 sm:px-7">
      <section className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-text-primary">Загрузить подкаст</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowCatModal(true)}
            icon={<Headphones className="h-3.5 w-3.5" />}
          >
            Категории
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Название *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Ведущий</span>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Описание</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Категория</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            >
              <option value="">Не выбрана</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Эпизод #</span>
            <input
              value={episodeNum}
              onChange={(e) => setEpisodeNum(e.target.value)}
              type="number"
              min="1"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Длительность (auto)
            </span>
            <input
              value={durationSec}
              readOnly
              placeholder="загрузи файл — длительность подставится сама"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-muted"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">URL обложки</span>
            <input
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              type="url"
              className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary"
            />
          </label>
          <label className="flex items-center gap-2 self-end">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-text-secondary">Опубликовать сразу</span>
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Аудиофайл *</span>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                setAudio(f)
                if (!f) {
                  setDurationSec('')
                  return
                }
                // Decode locally so the admin doesn't have to type the
                // duration. URL.createObjectURL → <audio> → loadedmetadata
                // gives us file.duration with no upload round-trip.
                const url = URL.createObjectURL(f)
                const probe = document.createElement('audio')
                probe.preload = 'metadata'
                probe.src = url
                const cleanup = () => URL.revokeObjectURL(url)
                probe.addEventListener(
                  'loadedmetadata',
                  () => {
                    const d = probe.duration
                    if (Number.isFinite(d) && d > 0) {
                      setDurationSec(String(Math.round(d)))
                    }
                    cleanup()
                  },
                  { once: true },
                )
                probe.addEventListener('error', cleanup, { once: true })
              }}
              required
              className="text-sm text-text-secondary"
            />
            {audio && (
              <span className="font-mono text-[10px] text-text-muted">
                {audio.name} · {(audio.size / 1024 / 1024).toFixed(1)} MB
              </span>
            )}
          </label>
          {progress !== null && (
            <div className="md:col-span-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full bg-text-primary transition-[width] duration-100"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <span className="font-mono text-[10px] text-text-muted">
                Загрузка: {Math.round(progress * 100)}%
              </span>
            </div>
          )}
          {formError && (
            <p className="md:col-span-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {formError}
            </p>
          )}
          <div className="md:col-span-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetForm}
              disabled={createMut.isPending}
            >
              Очистить
            </Button>
            <Button
              type="submit"
              size="sm"
              // Block submit until the local <audio> probe finishes
              // populating durationSec — иначе бэк-fallback на ffprobe
              // отработает, но юзер увидит пустую длительность в карточке
              // пока не reload'нёт страницу.
              disabled={createMut.isPending || !!audio && !durationSec}
              icon={<Upload className="h-3.5 w-3.5" />}
              title={
                audio && !durationSec
                  ? 'Подожди пока длительность извлечётся из файла'
                  : undefined
              }
            >
              {createMut.isPending
                ? 'Загружаем…'
                : audio && !durationSec
                  ? 'Читаю длительность…'
                  : 'Загрузить'}
            </Button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-2 font-display text-sm font-bold text-text-secondary">
          Опубликованные эпизоды ({podcasts.data?.length ?? 0})
        </h2>
        {podcasts.isPending && <PanelSkeleton rows={3} />}
        {podcasts.error && <ErrorBox message="Не удалось загрузить список подкастов" />}
        {podcasts.data && podcasts.data.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-surface-1 px-4 py-10 text-center font-mono text-[12px] text-text-muted">
            Пока ни одного эпизода. Используйте форму выше.
          </div>
        )}
        {podcasts.data && podcasts.data.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px]">
              <thead className="bg-surface-1">
                <tr className="text-left font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted">
                  <th className="px-3 py-2.5">НАЗВАНИЕ</th>
                  <th className="px-3 py-2.5">КАТЕГОРИЯ</th>
                  <th className="px-3 py-2.5">ВЕДУЩИЙ</th>
                  <th className="px-3 py-2.5">ДЛИТ.</th>
                  <th className="px-3 py-2.5">СТАТУС</th>
                  <th className="px-3 py-2.5 text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {podcasts.data.map((p) => (
                  <tr key={p.id} className="border-t border-border bg-bg hover:bg-surface-1">
                    <td className="px-3 py-3">
                      <div className="flex flex-col">
                        <span className="text-[13px] font-semibold text-text-primary">{p.title}</span>
                        {p.episode_num !== undefined && (
                          <span className="font-mono text-[10px] text-text-muted">Эпизод #{p.episode_num}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-text-secondary">
                      {p.category?.name ?? '—'}
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-text-secondary">{p.host ?? '—'}</td>
                    <td className="px-3 py-3 font-mono text-[12px] text-text-secondary">
                      {formatDuration(p.duration_sec)}
                    </td>
                    <td className="px-3 py-3">
                      {p.is_published ? (
                        <span className="rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-success">
                          PUBLISHED
                        </span>
                      ) : (
                        <span className="rounded-full bg-warn/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-warn">
                          DRAFT
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleteMut.isPending}
                        onClick={() => {
                          if (window.confirm(`Удалить «${p.title}»? Файл из MinIO тоже удалится.`)) {
                            deleteMut.mutate(p.id)
                          }
                        }}
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                      >
                        Удалить
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showCatModal && (
        <CategoryModal
          categories={categories.data ?? []}
          onClose={() => setShowCatModal(false)}
          onCreate={async (input) => {
            await createCatMut.mutateAsync(input)
          }}
          busy={createCatMut.isPending}
        />
      )}
    </div>
  )
}

