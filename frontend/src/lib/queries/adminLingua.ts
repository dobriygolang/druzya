// adminLingua.ts — admin-scope react-query hooks для Lingua content CMS.
//
// Bridge между admin panels (`pages/admin/lingua/*`) и существующими
// backend HoneService RPCs (`hone.proto` Reading / Listening / Speaking
// blocks). Никаких новых protos — переиспользуем те же routes, что и
// user-facing Lingua (Agent GG). Разница лишь в scope:
//
//   - User-facing видит materials, scoped к user_id.
//   - Admin-facing видит global view + умеет Archive по любому id.
//
// Server-side admin gate работает через role check; UI mirror'ит решение
// (см. AdminPage.tsx — 403 redirect'ит). Здесь мы лишь дёргаем RPCs,
// гейт делается на server.
//
// Wire shape: proto3 emit camelCase + snake_case в JSON (vanguard transcoder
// принимает оба, отдаёт camelCase по дефолту). Нормализуем через ?? .

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../apiClient'

// ── Reading ────────────────────────────────────────────────────────────

export type ReadingSourceKind = 'paste' | 'url' | 'pdf' | 'epub' | 'book'

export interface ReadingMaterial {
  id: string
  user_id: string
  source_kind: ReadingSourceKind
  source_url: string
  title: string
  body_md: string
  total_chars: number
  archived_at: string // empty when active
  created_at: string
  updated_at: string
  book_chapter: number
  has_book_chapter: boolean
  book_total_chapters: number
  has_book_total: boolean
}

type WireReadingMaterial = {
  id?: string
  userId?: string
  user_id?: string
  sourceKind?: string
  source_kind?: string
  sourceUrl?: string
  source_url?: string
  title?: string
  bodyMd?: string
  body_md?: string
  totalChars?: number
  total_chars?: number
  archivedAt?: string
  archived_at?: string
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
  bookChapter?: number
  book_chapter?: number
  hasBookChapter?: boolean
  has_book_chapter?: boolean
  bookTotalChapters?: number
  book_total_chapters?: number
  hasBookTotal?: boolean
  has_book_total?: boolean
}

function adaptReading(w: WireReadingMaterial): ReadingMaterial {
  return {
    id: w.id ?? '',
    user_id: w.userId ?? w.user_id ?? '',
    source_kind: ((w.sourceKind ?? w.source_kind) as ReadingSourceKind) || 'paste',
    source_url: w.sourceUrl ?? w.source_url ?? '',
    title: w.title ?? '',
    body_md: w.bodyMd ?? w.body_md ?? '',
    total_chars: w.totalChars ?? w.total_chars ?? 0,
    archived_at: w.archivedAt ?? w.archived_at ?? '',
    created_at: w.createdAt ?? w.created_at ?? '',
    updated_at: w.updatedAt ?? w.updated_at ?? '',
    book_chapter: w.bookChapter ?? w.book_chapter ?? 0,
    has_book_chapter: w.hasBookChapter ?? w.has_book_chapter ?? false,
    book_total_chapters: w.bookTotalChapters ?? w.book_total_chapters ?? 0,
    has_book_total: w.hasBookTotal ?? w.has_book_total ?? false,
  }
}

export interface AddReadingMaterialBody {
  source_kind: ReadingSourceKind
  source_url?: string
  title: string
  body_md?: string
  book_chapter?: number
  has_book_chapter?: boolean
  book_total_chapters?: number
  has_book_total?: boolean
}

export const readingKeys = {
  all: ['admin', 'lingua', 'reading'] as const,
  list: () => ['admin', 'lingua', 'reading', 'list'] as const,
}

export function useAdminReadingMaterialsQuery() {
  return useQuery({
    queryKey: readingKeys.list(),
    queryFn: async () => {
      const r = await api<{ items?: WireReadingMaterial[]; nextCursor?: string; next_cursor?: string }>(
        '/hone/reading/materials',
      )
      return (r.items ?? []).map(adaptReading)
    },
    staleTime: 30_000,
  })
}

export function useAddReadingMaterialMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AddReadingMaterialBody) =>
      api<WireReadingMaterial>('/hone/reading/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceKind: body.source_kind,
          sourceUrl: body.source_url ?? '',
          title: body.title,
          bodyMd: body.body_md ?? '',
          bookChapter: body.book_chapter ?? 0,
          hasBookChapter: body.has_book_chapter ?? false,
          bookTotalChapters: body.book_total_chapters ?? 0,
          hasBookTotal: body.has_book_total ?? false,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: readingKeys.list() })
    },
  })
}

export function useArchiveReadingMaterialMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<Record<string, never>>(`/hone/reading/materials/${encodeURIComponent(id)}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: readingKeys.list() })
    },
  })
}

// ── Listening ──────────────────────────────────────────────────────────

export interface ListeningMaterial {
  id: string
  user_id: string
  title: string
  audio_url: string
  transcript_md: string
  archived_at: string
  created_at: string
  updated_at: string
}

type WireListeningMaterial = {
  id?: string
  userId?: string
  user_id?: string
  title?: string
  audioUrl?: string
  audio_url?: string
  transcriptMd?: string
  transcript_md?: string
  archivedAt?: string
  archived_at?: string
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
}

function adaptListening(w: WireListeningMaterial): ListeningMaterial {
  return {
    id: w.id ?? '',
    user_id: w.userId ?? w.user_id ?? '',
    title: w.title ?? '',
    audio_url: w.audioUrl ?? w.audio_url ?? '',
    transcript_md: w.transcriptMd ?? w.transcript_md ?? '',
    archived_at: w.archivedAt ?? w.archived_at ?? '',
    created_at: w.createdAt ?? w.created_at ?? '',
    updated_at: w.updatedAt ?? w.updated_at ?? '',
  }
}

export interface AddListeningMaterialBody {
  title: string
  audio_url: string
  transcript_md: string
}

export interface IngestYouTubeBody {
  url: string
  language_hint?: string
}

export const listeningKeys = {
  all: ['admin', 'lingua', 'listening'] as const,
  list: () => ['admin', 'lingua', 'listening', 'list'] as const,
}

export function useAdminListeningMaterialsQuery() {
  return useQuery({
    queryKey: listeningKeys.list(),
    queryFn: async () => {
      const r = await api<{ items?: WireListeningMaterial[]; nextCursor?: string; next_cursor?: string }>(
        '/hone/listening/materials',
      )
      return (r.items ?? []).map(adaptListening)
    },
    staleTime: 30_000,
  })
}

export function useAddListeningMaterialMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AddListeningMaterialBody) =>
      api<WireListeningMaterial>('/hone/listening/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: body.title,
          audioUrl: body.audio_url,
          transcriptMd: body.transcript_md,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listeningKeys.list() })
    },
  })
}

export function useIngestYouTubeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: IngestYouTubeBody) =>
      api<WireListeningMaterial>('/hone/listening/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: body.url,
          languageHint: body.language_hint ?? '',
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listeningKeys.list() })
    },
  })
}

export function useArchiveListeningMaterialMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<Record<string, never>>(`/hone/listening/materials/${encodeURIComponent(id)}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listeningKeys.list() })
    },
  })
}


export interface SpeakingExercise {
  id: string
  level: string // "B1" | "B2" | "C1"
  topic: string
  prompt: string
  audio_url: string
}

type WireSpeakingExercise = {
  id?: string
  level?: string
  topic?: string
  prompt?: string
  audioUrl?: string
  audio_url?: string
}

function adaptSpeaking(w: WireSpeakingExercise): SpeakingExercise {
  return {
    id: w.id ?? '',
    level: w.level ?? '',
    topic: w.topic ?? '',
    prompt: w.prompt ?? '',
    audio_url: w.audioUrl ?? w.audio_url ?? '',
  }
}

export const speakingKeys = {
  all: ['admin', 'lingua', 'speaking'] as const,
  list: (level: string) => ['admin', 'lingua', 'speaking', level] as const,
}

export function useAdminSpeakingExercisesQuery(level: string = '') {
  return useQuery({
    queryKey: speakingKeys.list(level),
    queryFn: async () => {
      const qs = level ? `?level=${encodeURIComponent(level)}` : ''
      const r = await api<{ items?: WireSpeakingExercise[] }>(`/hone/speaking/exercises${qs}`)
      return (r.items ?? []).map(adaptSpeaking)
    },
    staleTime: 60_000,
  })
}

// useGenerateSpeakingTTSMutation — admin-only. Calls
// POST /api/v1/admin/hone/speaking/exercises/{id}/tts → backend
// synthesises via Cloudflare MeloTTS, uploads to MinIO, persists URL.
// 503 → provider/storage not configured; 5xx → upstream error.
//
// Wire shape: backend accepts proto3 emit camelCase + snake_case. We
// send canonical proto field names (`exerciseId`, `force`); transcoder
// also accepts snake_case for ops calling curl manually.
export interface GenerateSpeakingTTSBody {
  exercise_id: string
  force?: boolean
}

interface WireGenerateSpeakingTTSResp {
  audioUrl?: string
  audio_url?: string
}

export function useGenerateSpeakingTTSMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: GenerateSpeakingTTSBody) => {
      const r = await api<WireGenerateSpeakingTTSResp>(
        `/admin/hone/speaking/exercises/${encodeURIComponent(body.exercise_id)}/tts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            exerciseId: body.exercise_id,
            force: body.force ?? false,
          }),
        },
      )
      return { audio_url: r.audioUrl ?? r.audio_url ?? '' }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: speakingKeys.all })
    },
  })
}

// ── Writing prompts (Phase K Wave 11) ──────────────────────────────────

export interface WritingPrompt {
  id: string
  level: string // "B1" | "B2" | "C1"
  topic: string
  prompt: string
  rubric_md: string
  created_at: string
  updated_at: string
}

type WireWritingPrompt = {
  id?: string
  level?: string
  topic?: string
  prompt?: string
  rubricMd?: string
  rubric_md?: string
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
}

function adaptWritingPrompt(w: WireWritingPrompt): WritingPrompt {
  return {
    id: w.id ?? '',
    level: w.level ?? '',
    topic: w.topic ?? '',
    prompt: w.prompt ?? '',
    rubric_md: w.rubricMd ?? w.rubric_md ?? '',
    created_at: w.createdAt ?? w.created_at ?? '',
    updated_at: w.updatedAt ?? w.updated_at ?? '',
  }
}

export interface AddWritingPromptBody {
  id: string
  level: string
  topic: string
  prompt: string
  rubric_md?: string
}

export const writingPromptKeys = {
  all: ['admin', 'lingua', 'writing-prompts'] as const,
  list: (level: string) => ['admin', 'lingua', 'writing-prompts', level] as const,
}

export function useAdminWritingPromptsQuery(level: string = '') {
  return useQuery({
    queryKey: writingPromptKeys.list(level),
    queryFn: async () => {
      const qs = level ? `?level=${encodeURIComponent(level)}` : ''
      const r = await api<{ items?: WireWritingPrompt[] }>(`/hone/writing/prompts${qs}`)
      return (r.items ?? []).map(adaptWritingPrompt)
    },
    staleTime: 30_000,
  })
}

export function useAddWritingPromptMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: AddWritingPromptBody) => {
      const r = await api<WireWritingPrompt>('/admin/hone/writing/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: body.id,
          level: body.level,
          topic: body.topic,
          prompt: body.prompt,
          rubricMd: body.rubric_md ?? '',
        }),
      })
      return adaptWritingPrompt(r)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: writingPromptKeys.all })
    },
  })
}

export function useArchiveWritingPromptMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<Record<string, never>>(`/admin/hone/writing/prompts/${encodeURIComponent(id)}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: writingPromptKeys.all })
    },
  })
}
