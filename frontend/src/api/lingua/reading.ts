// api/lingua/reading.ts — Reading-модуль API client для web /lingua.
//
// Phase K Wave 8 migration: English vertical уехал из Hone (desktop Electron)
// в web под /lingua. Backend HoneService (proto/druz9/v1/hone.proto) тот же —
// REST endpoints через google.api.http transcoding. Здесь — JSON wrappers
// поверх general-purpose `api()` fetcher (frontend pattern, см honeTasks.ts).
//
// Proto3 JSON encoding wire shape: snake_case field names. Locally конвертим
// в camelCase POJO так же как hone/src/renderer/src/api/reading.ts.
import { api } from '../../lib/apiClient'

export type ReadingSourceKind = 'paste' | 'url' | 'pdf' | 'epub' | 'book'

export interface ReadingMaterial {
  id: string
  sourceKind: ReadingSourceKind
  sourceUrl: string
  title: string
  bodyMd: string
  totalChars: number
  archivedAt: Date | null
  createdAt: Date | null
  updatedAt: Date | null
  bookChapter: number | null
  bookTotalChapters: number | null
}

export interface ReadingSession {
  id: string
  materialId: string
  charsRead: number
  charsTotal: number
  startedAt: Date | null
  endedAt: Date | null
  aiSummaryScore: number | null
  summaryMd: string
}

export interface VocabEntry {
  word: string
  translation: string
  contextMd: string
  sourceMaterial: string | null
  box: number
  nextReviewAt: Date | null
  reviewedCount: number
  learnedAt: Date | null
  createdAt: Date | null
}

// ── Wire types (proto3 JSON snake_case) ────────────────────────────────────

type WireTs = { seconds?: number | string; nanos?: number } | string | null | undefined

type WireMaterial = {
  id: string
  source_kind?: string
  sourceKind?: string
  source_url?: string
  sourceUrl?: string
  title: string
  body_md?: string
  bodyMd?: string
  total_chars?: number
  totalChars?: number
  archived_at?: WireTs
  archivedAt?: WireTs
  created_at?: WireTs
  createdAt?: WireTs
  updated_at?: WireTs
  updatedAt?: WireTs
  book_chapter?: number
  bookChapter?: number
  has_book_chapter?: boolean
  hasBookChapter?: boolean
  book_total_chapters?: number
  bookTotalChapters?: number
  has_book_total?: boolean
  hasBookTotal?: boolean
}

type WireSession = {
  id: string
  material_id?: string
  materialId?: string
  chars_read?: number
  charsRead?: number
  chars_total?: number
  charsTotal?: number
  started_at?: WireTs
  startedAt?: WireTs
  ended_at?: WireTs
  endedAt?: WireTs
  ai_summary_score?: number
  aiSummaryScore?: number
  has_score?: boolean
  hasScore?: boolean
  summary_md?: string
  summaryMd?: string
}

type WireVocab = {
  word: string
  translation: string
  context_md?: string
  contextMd?: string
  source_material?: string
  sourceMaterial?: string
  box: number
  next_review_at?: WireTs
  nextReviewAt?: WireTs
  reviewed_count?: number
  reviewedCount?: number
  learned_at?: WireTs
  learnedAt?: WireTs
  created_at?: WireTs
  createdAt?: WireTs
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseTs(ts: WireTs): Date | null {
  if (!ts) return null
  if (typeof ts === 'string') {
    // RFC3339 string (most common with grpc-gateway transcoding).
    const ms = Date.parse(ts)
    if (!Number.isFinite(ms) || ms <= 0) return null
    return new Date(ms)
  }
  const sec = typeof ts.seconds === 'string' ? Number(ts.seconds) : ts.seconds ?? 0
  const ns = ts.nanos ?? 0
  const ms = sec * 1000 + Math.floor(ns / 1_000_000)
  if (ms <= 0) return null
  return new Date(ms)
}

function normalizeSourceKind(k: string | undefined): ReadingSourceKind {
  switch (k) {
    case 'paste':
    case 'url':
    case 'pdf':
    case 'epub':
    case 'book':
      return k
    default:
      return 'paste'
  }
}

function unwrapMaterial(m: WireMaterial): ReadingMaterial {
  const sourceKind = m.source_kind ?? m.sourceKind
  const hasChapter = m.has_book_chapter ?? m.hasBookChapter ?? false
  const hasTotal = m.has_book_total ?? m.hasBookTotal ?? false
  return {
    id: m.id,
    sourceKind: normalizeSourceKind(sourceKind),
    sourceUrl: m.source_url ?? m.sourceUrl ?? '',
    title: m.title,
    bodyMd: m.body_md ?? m.bodyMd ?? '',
    totalChars: m.total_chars ?? m.totalChars ?? 0,
    archivedAt: parseTs(m.archived_at ?? m.archivedAt),
    createdAt: parseTs(m.created_at ?? m.createdAt),
    updatedAt: parseTs(m.updated_at ?? m.updatedAt),
    bookChapter: hasChapter ? m.book_chapter ?? m.bookChapter ?? 0 : null,
    bookTotalChapters: hasTotal ? m.book_total_chapters ?? m.bookTotalChapters ?? 0 : null,
  }
}

function unwrapSession(s: WireSession): ReadingSession {
  return {
    id: s.id,
    materialId: s.material_id ?? s.materialId ?? '',
    charsRead: s.chars_read ?? s.charsRead ?? 0,
    charsTotal: s.chars_total ?? s.charsTotal ?? 0,
    startedAt: parseTs(s.started_at ?? s.startedAt),
    endedAt: parseTs(s.ended_at ?? s.endedAt),
    aiSummaryScore: (s.has_score ?? s.hasScore) ? s.ai_summary_score ?? s.aiSummaryScore ?? 0 : null,
    summaryMd: s.summary_md ?? s.summaryMd ?? '',
  }
}

function unwrapVocab(v: WireVocab): VocabEntry {
  const src = v.source_material ?? v.sourceMaterial ?? ''
  return {
    word: v.word,
    translation: v.translation,
    contextMd: v.context_md ?? v.contextMd ?? '',
    sourceMaterial: src.length > 0 ? src : null,
    box: v.box ?? 0,
    nextReviewAt: parseTs(v.next_review_at ?? v.nextReviewAt),
    reviewedCount: v.reviewed_count ?? v.reviewedCount ?? 0,
    learnedAt: parseTs(v.learned_at ?? v.learnedAt),
    createdAt: parseTs(v.created_at ?? v.createdAt),
  }
}

// ── Materials ──────────────────────────────────────────────────────────────

export async function listReadingMaterials(limit = 100): Promise<ReadingMaterial[]> {
  const qs = limit !== 100 ? `?limit=${limit}` : ''
  const resp = await api<{ items?: WireMaterial[] }>(`/hone/reading/materials${qs}`)
  return (resp.items ?? []).map(unwrapMaterial)
}

export async function getReadingMaterial(id: string): Promise<ReadingMaterial> {
  const resp = await api<WireMaterial>(`/hone/reading/materials/${encodeURIComponent(id)}`)
  return unwrapMaterial(resp)
}

export interface AddReadingMaterialArgs {
  sourceKind: ReadingSourceKind
  title: string
  bodyMd: string
  sourceUrl?: string
  bookChapter?: number
  bookTotalChapters?: number
}

export async function addReadingMaterial(args: AddReadingMaterialArgs): Promise<ReadingMaterial> {
  const body = {
    source_kind: args.sourceKind,
    title: args.title,
    body_md: args.bodyMd,
    source_url: args.sourceUrl ?? '',
    book_chapter: args.bookChapter ?? 0,
    has_book_chapter: typeof args.bookChapter === 'number',
    book_total_chapters: args.bookTotalChapters ?? 0,
    has_book_total: typeof args.bookTotalChapters === 'number',
  }
  const resp = await api<WireMaterial>(`/hone/reading/materials`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return unwrapMaterial(resp)
}

export async function archiveReadingMaterial(id: string): Promise<void> {
  await api<unknown>(`/hone/reading/materials/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
    body: '{}',
  })
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function startReadingSession(materialId: string): Promise<ReadingSession> {
  const resp = await api<WireSession>(`/hone/reading/sessions`, {
    method: 'POST',
    body: JSON.stringify({ material_id: materialId }),
  })
  return unwrapSession(resp)
}

export interface EndReadingSessionArgs {
  sessionId: string
  charsRead: number
  summaryMd?: string
}

export async function endReadingSession(args: EndReadingSessionArgs): Promise<ReadingSession> {
  const resp = await api<{ session?: WireSession }>(
    `/hone/reading/sessions/${encodeURIComponent(args.sessionId)}/end`,
    {
      method: 'POST',
      body: JSON.stringify({
        chars_read: args.charsRead,
        summary_md: args.summaryMd ?? '',
      }),
    },
  )
  if (!resp.session) {
    return {
      id: args.sessionId,
      materialId: '',
      charsRead: args.charsRead,
      charsTotal: 0,
      startedAt: null,
      endedAt: new Date(),
      aiSummaryScore: null,
      summaryMd: args.summaryMd ?? '',
    }
  }
  return unwrapSession(resp.session)
}

// ── Vocab queue ────────────────────────────────────────────────────────────

export interface AddVocabArgs {
  word: string
  translation?: string
  contextMd?: string
  sourceMaterial?: string
}

export async function addVocab(args: AddVocabArgs): Promise<VocabEntry> {
  const resp = await api<WireVocab>(`/hone/reading/vocab`, {
    method: 'POST',
    body: JSON.stringify({
      word: args.word,
      translation: args.translation ?? '',
      context_md: args.contextMd ?? '',
      source_material: args.sourceMaterial ?? '',
    }),
  })
  return unwrapVocab(resp)
}

export async function reviewVocab(word: string, correct: boolean): Promise<VocabEntry> {
  const resp = await api<WireVocab>(`/hone/reading/vocab/review`, {
    method: 'POST',
    body: JSON.stringify({ word, correct }),
  })
  return unwrapVocab(resp)
}

export async function listVocabBySourceMaterial(materialId: string, limit = 50): Promise<VocabEntry[]> {
  const qs = limit !== 50 ? `?limit=${limit}` : ''
  const resp = await api<{ items?: WireVocab[] }>(
    `/hone/reading/materials/${encodeURIComponent(materialId)}/vocab${qs}`,
  )
  return (resp.items ?? []).map(unwrapVocab)
}

export async function listVocabDue(limit = 20): Promise<VocabEntry[]> {
  const qs = limit !== 20 ? `?limit=${limit}` : ''
  const resp = await api<{ items?: WireVocab[] }>(`/hone/reading/vocab/due${qs}`)
  return (resp.items ?? []).map(unwrapVocab)
}
