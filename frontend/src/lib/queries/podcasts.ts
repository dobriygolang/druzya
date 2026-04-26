// queries/podcasts.ts — runtime-запросы каталога подкастов для /podcasts.
//
// Источник правды — backend services/podcast/ports/cms_handler.go (новый
// chi-direct REST surface). Бэк также сохраняет легаси Connect-эндпоинт
// PUT /podcast/{id}/progress для синхронизации прослушивания.
//
// Канонический ответ GET /api/v1/podcast:
//
//   {
//     "items": [
//       {
//         "id": "uuid",
//         "title": "string",
//         "description": "string",
//         "host": "string",
//         "category_id": "uuid?",
//         "category": { id, slug, name, color, sort_order } | null,
//         "episode_num": 1,
//         "duration_sec": 1234,
//         "audio_url": "https://signed.minio.url/...",
//         "cover_url": "https://...",
//         "is_published": true,
//         "published_at": "RFC3339",
//         "created_at": "RFC3339",
//         "updated_at": "RFC3339"
//       }
//     ]
//   }
//
// Старый mock-handler (`{episodes,sections}`) больше не релевантен — CMS
// эндпоинт всегда возвращает items[]. Для обратной совместимости с
// тестами сохраняем normalisePodcastCatalog.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_BASE, ApiError, readAccessToken } from '../apiClient'

/** Категория подкаста (соответствует domain.PodcastCategory на бэке). */
export interface PodcastCategory {
  id: string
  slug: string
  name: string
  color: string
  sort_order: number
}

/** Канонический Podcast — выровнен с domain.CMSPodcast / cmsPodcastDTO. */
export interface Podcast {
  id: string
  title: string
  description: string
  host?: string
  category_id?: string
  category?: PodcastCategory | null
  episode_num?: number
  duration_sec: number
  audio_url: string
  cover_url?: string
  is_published?: boolean
  /** Прослушанная позиция — заполняется только проигрывателем (не приходит с бэка в CMS-shape). */
  progress_sec: number
  /** Завершён ли эпизод — заполняется проигрывателем. */
  completed: boolean
  /** Legacy: некоторые старые экраны фильтруют по section, оставлен для совместимости. */
  section?: string
  /** ISO-timestamp публикации. */
  published_at?: string
}

interface CanonicalCatalog {
  items: Podcast[]
}

interface CategoriesResponse {
  items: PodcastCategory[]
}

interface LegacyEpisode {
  id: string
  title: string
  section: string
  duration_min: number
  published_at: string
  description: string
  cover?: string | null
  listened?: boolean
}

interface LegacyCatalog {
  episodes: LegacyEpisode[]
  sections?: unknown
}

function isCanonical(payload: unknown): payload is CanonicalCatalog {
  return typeof payload === 'object' && payload !== null && Array.isArray((payload as CanonicalCatalog).items)
}

function isLegacy(payload: unknown): payload is LegacyCatalog {
  return typeof payload === 'object' && payload !== null && Array.isArray((payload as LegacyCatalog).episodes)
}

/** Нормализует ответ бэка в канон. Бросает при unknown shape. */
export function normalisePodcastCatalog(raw: unknown): Podcast[] {
  if (isCanonical(raw)) {
    return raw.items.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description ?? '',
      host: p.host ?? '',
      category_id: p.category_id ?? undefined,
      category: p.category ?? undefined,
      episode_num: p.episode_num,
      duration_sec: p.duration_sec ?? 0,
      audio_url: p.audio_url ?? '',
      cover_url: p.cover_url ?? '',
      is_published: p.is_published,
      progress_sec: p.progress_sec ?? 0,
      completed: Boolean(p.completed),
      section: p.section ?? p.category?.slug ?? '',
      published_at: p.published_at,
    }))
  }
  if (isLegacy(raw)) {
    return raw.episodes.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      section: e.section,
      duration_sec: Math.max(0, Math.round(e.duration_min * 60)),
      audio_url: '',
      progress_sec: 0,
      completed: Boolean(e.listened),
      published_at: e.published_at,
    }))
  }
  return []
}

/** GET /api/v1/podcast (с опциональным фильтром по категории). */
export function usePodcastsQuery(opts: { categoryId?: string } = {}) {
  return useQuery({
    queryKey: ['podcasts', 'catalog', opts.categoryId ?? null],
    queryFn: async () => {
      const path = opts.categoryId
        ? `/podcast?category_id=${encodeURIComponent(opts.categoryId)}`
        : '/podcast'
      const raw = await api<unknown>(path)
      return normalisePodcastCatalog(raw)
    },
    staleTime: 5 * 60_000,
  })
}

/** GET /api/v1/podcast/categories. */
export function usePodcastCategoriesQuery() {
  return useQuery({
    queryKey: ['podcasts', 'categories'],
    queryFn: async () => {
      const raw = await api<CategoriesResponse>('/podcast/categories')
      return raw.items ?? []
    },
    staleTime: 5 * 60_000,
  })
}

/** GET /api/v1/podcast/:id. */
export function usePodcastQuery(id: string | null | undefined) {
  return useQuery({
    queryKey: ['podcasts', 'one', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const raw = await api<Podcast>(`/podcast/${encodeURIComponent(id as string)}`)
      const [normalised] = normalisePodcastCatalog({ items: [raw] })
      return normalised
    },
  })
}

// ── мутации (admin upload) ────────────────────────────────────────────────

/** Параметры POST /admin/podcast — multipart/form-data. */
export interface CreatePodcastInput {
  title: string
  description?: string
  host?: string
  categoryId?: string
  episodeNum?: number
  durationSec?: number
  coverUrl?: string
  isPublished?: boolean
  audio: File
  /** onProgress(0..1) — необязателен; вызывается на каждом upload событии. */
  onProgress?: (fraction: number) => void
}

/**
 * uploadPodcast — императивный multipart POST. Используем XHR (а не fetch),
 * чтобы получить нативный progress-event (fetch до сих пор без upload-progress).
 */
function uploadPodcast(input: CreatePodcastInput): Promise<Podcast> {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append('title', input.title)
    if (input.description) fd.append('description', input.description)
    if (input.host) fd.append('host', input.host)
    if (input.categoryId) fd.append('category_id', input.categoryId)
    if (typeof input.episodeNum === 'number') fd.append('episode_num', String(input.episodeNum))
    if (typeof input.durationSec === 'number') fd.append('duration_sec', String(input.durationSec))
    if (input.coverUrl) fd.append('cover_url', input.coverUrl)
    if (typeof input.isPublished === 'boolean') fd.append('is_published', String(input.isPublished))
    fd.append('audio', input.audio)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/admin/podcast`)
    const token = readAccessToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.withCredentials = true
    xhr.upload.onprogress = (ev) => {
      if (input.onProgress && ev.lengthComputable && ev.total > 0) {
        input.onProgress(ev.loaded / ev.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as Podcast
          const [normalised] = normalisePodcastCatalog({ items: [parsed] })
          resolve(normalised)
        } catch (e) {
          reject(new ApiError(xhr.status, `parse: ${(e as Error).message}`))
        }
      } else {
        reject(new ApiError(xhr.status, xhr.responseText || xhr.statusText))
      }
    }
    xhr.onerror = () => reject(new ApiError(0, 'network'))
    xhr.send(fd)
  })
}

export function useCreatePodcastMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePodcastInput) => uploadPodcast(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['podcasts'] })
    },
  })
}

/** POST /admin/podcast/categories. */
export function useCreateCategoryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { slug: string; name: string; color?: string; sort_order?: number }) => {
      const res = await api<PodcastCategory>('/admin/podcast/categories', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      return res
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['podcasts', 'categories'] })
    },
  })
}

/** DELETE /admin/podcast/:id. */
export function useDeletePodcastMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api<void>(`/admin/podcast/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['podcasts'] })
    },
  })
}

/**
 * PUT /api/v1/podcast/{id}/progress — отправляем listened seconds.
 * Throttled из аудио-плеера каждые 10s.
 *
 * Хук версия патчит React-query cache на success — без этого при
 * возврате на страницу в течение gcTime (5мин) видишь stale
 * progress_sec=0, а seek в плеере не делается. Раньше функция была
 * императивной и никак не сообщала кэшу о новом значении.
 */
export function useUpdatePodcastProgressMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { podcastId: string; progressSec: number; completed?: boolean }) => {
      const body: Record<string, unknown> = {
        progress_sec: Math.max(0, Math.floor(input.progressSec)),
      }
      if (input.completed) body.completed = true
      await api(`/podcast/${encodeURIComponent(input.podcastId)}/progress`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      return { input }
    },
    onSuccess: ({ input }) => {
      const sec = Math.max(0, Math.floor(input.progressSec))
      // Patch the single-podcast cache so the next mount of the
      // player seeks to the right offset without a full refetch.
      qc.setQueryData<Podcast>(['podcasts', 'one', input.podcastId], (prev) =>
        prev ? { ...prev, progress_sec: sec, ...(input.completed ? { completed: true } : {}) } : prev,
      )
      // Patch the list caches too — same rule.
      qc.setQueriesData<Podcast[]>({ queryKey: ['podcasts', 'catalog'] }, (prev) =>
        prev
          ? prev.map((p) =>
              p.id === input.podcastId
                ? { ...p, progress_sec: sec, ...(input.completed ? { completed: true } : {}) }
                : p,
            )
          : prev,
      )
    },
  })
}

/** Императивный fallback для legacy call sites. Новый код должен брать
 * useUpdatePodcastProgressMutation чтобы кэш чинился. */
export async function updatePodcastProgress(input: {
  podcastId: string
  progressSec: number
  completed?: boolean
}): Promise<void> {
  const body: Record<string, unknown> = { progress_sec: Math.max(0, Math.floor(input.progressSec)) }
  if (input.completed) body.completed = true
  await api(`/podcast/${encodeURIComponent(input.podcastId)}/progress`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/** Человекочитаемая длительность: 42 min или 1h 12m. */
export function formatDuration(durationSec: number): string {
  const total = Math.max(0, Math.round(durationSec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h}ч ${m}м`
  return `${m} мин`
}

/** Человекочитаемая дата публикации (RU). */
export function formatPublished(iso?: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}
