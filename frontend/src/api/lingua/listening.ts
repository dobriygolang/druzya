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
