// api/lingua/listening.ts — Listening API client для web /lingua.
import { api } from '../../lib/apiClient'

export interface ListeningMaterial {
  id: string
  title: string
  audioUrl: string
  transcriptMd: string
  archivedAt: Date | null
  createdAt: Date | null
  updatedAt: Date | null
}

type WireTs = { seconds?: number | string; nanos?: number } | string | null | undefined

type WireMaterial = {
  id: string
  title: string
  audio_url?: string
  audioUrl?: string
  transcript_md?: string
  transcriptMd?: string
  archived_at?: WireTs
  archivedAt?: WireTs
  created_at?: WireTs
  createdAt?: WireTs
  updated_at?: WireTs
  updatedAt?: WireTs
}

function parseTs(ts: WireTs): Date | null {
  if (!ts) return null
  if (typeof ts === 'string') {
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

function unwrap(m: WireMaterial): ListeningMaterial {
  return {
    id: m.id,
    title: m.title,
    audioUrl: m.audio_url ?? m.audioUrl ?? '',
    transcriptMd: m.transcript_md ?? m.transcriptMd ?? '',
    archivedAt: parseTs(m.archived_at ?? m.archivedAt),
    createdAt: parseTs(m.created_at ?? m.createdAt),
    updatedAt: parseTs(m.updated_at ?? m.updatedAt),
  }
}

export async function listListeningMaterials(limit = 100): Promise<ListeningMaterial[]> {
  const qs = limit !== 100 ? `?limit=${limit}` : ''
  const resp = await api<{ items?: WireMaterial[] }>(`/hone/listening/materials${qs}`)
  return (resp.items ?? []).map(unwrap)
}

export async function getListeningMaterial(id: string): Promise<ListeningMaterial> {
  const resp = await api<WireMaterial>(`/hone/listening/materials/${encodeURIComponent(id)}`)
  return unwrap(resp)
}

export interface AddListeningMaterialArgs {
  title: string
  audioUrl: string
  transcriptMd: string
}

export async function addListeningMaterial(args: AddListeningMaterialArgs): Promise<ListeningMaterial> {
  const resp = await api<WireMaterial>(`/hone/listening/materials`, {
    method: 'POST',
    body: JSON.stringify({
      title: args.title,
      audio_url: args.audioUrl,
      transcript_md: args.transcriptMd,
    }),
  })
  return unwrap(resp)
}

export async function archiveListeningMaterial(id: string): Promise<void> {
  await api<unknown>(`/hone/listening/materials/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
    body: '{}',
  })
}

export async function ingestYouTubeListening(
  url: string,
  languageHint = '',
): Promise<ListeningMaterial> {
  const resp = await api<WireMaterial>(`/hone/listening/youtube`, {
    method: 'POST',
    body: JSON.stringify({ url, language_hint: languageHint }),
  })
  return unwrap(resp)
}

// ─── Curated ready library (Phase K Wave 15) ──────────────────────────────
//
// Sergey-curated 50+ listening tracks (SE Daily, Changelog, Lex Fridman,
// Hanselminutes, Latent Space, TED, Strange Loop, GOTO). Static Go-backed
// catalog; this client just calls GET /hone/listening/curated?level=…
// The endpoint returns a flat list — UI groups by level / source as needed.

export type CuratedListeningLevel = 'B1' | 'B2' | 'C1'

export interface CuratedListeningTrack {
  id: string
  title: string
  speaker: string
  url: string
  level: CuratedListeningLevel
  estimatedMinutes: number
  topic: string
  tags: string[]
  source: string
  why: string
}

type WireCuratedTrack = {
  id: string
  title: string
  speaker: string
  url: string
  level: string
  estimated_minutes?: number
  estimatedMinutes?: number
  topic: string
  tags?: string[] | null
  source: string
  why: string
}

function unwrapCurated(w: WireCuratedTrack): CuratedListeningTrack {
  const level: CuratedListeningLevel =
    w.level === 'B1' || w.level === 'B2' || w.level === 'C1' ? w.level : 'B2'
  return {
    id: w.id,
    title: w.title,
    speaker: w.speaker,
    url: w.url,
    level,
    estimatedMinutes: w.estimated_minutes ?? w.estimatedMinutes ?? 0,
    topic: w.topic,
    tags: Array.isArray(w.tags) ? w.tags : [],
    source: w.source,
    why: w.why,
  }
}

/**
 * Список Sergey-curated готовых аудиозаписей. Параметр `level` фильтрует на
 * сервере; передай 'all' (или пропусти) чтобы получить полный каталог —
 * хендлер вернёт всё, мы делаем фильтр-проверку на клиенте перед отправкой.
 */
export async function listCuratedListeningTracks(
  level?: CuratedListeningLevel | 'all',
): Promise<CuratedListeningTrack[]> {
  const qs = level && level !== 'all' ? `?level=${encodeURIComponent(level)}` : ''
  const resp = await api<{ items?: WireCuratedTrack[] }>(`/hone/listening/curated${qs}`)
  return (resp.items ?? []).map(unwrapCurated)
}
