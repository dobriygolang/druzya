// api/lingua/speaking.ts — Speaking modality API client для web /lingua.
//
// Mirrors hone/src/renderer/src/api/speaking.ts но через JSON REST поверх
// general-purpose api() fetcher. Audio bytes отдаются base64 в body для
// grade endpoint.
import { api } from '../../lib/apiClient'

export type SpeakingLevel = 'B1' | 'B2' | 'C1'

export interface SpeakingExercise {
  id: string
  level: SpeakingLevel
  topic: string
  prompt: string
  audioUrl: string
}

export type WordDiffStatus = 'match' | 'miss' | 'extra' | 'substitute'

export interface WordDiff {
  status: WordDiffStatus
  expected: string
  actual: string
}

export interface SpeakingGradeResult {
  id: string
  userTranscript: string
  pronunciationScore: number
  fluencyScore: number
  coachFeedback: string
  wordDiffs: WordDiff[]
  createdAt: Date | null
}

export interface SpeakingSession {
  id: string
  exerciseId: string
  prompt: string
  userTranscript: string
  pronunciationScore: number
  fluencyScore: number
  coachFeedback: string
  createdAt: Date | null
}

type WireTs = { seconds?: number | string; nanos?: number } | string | null | undefined

type WireExercise = {
  id: string
  level: string
  topic?: string
  prompt: string
  audio_url?: string
  audioUrl?: string
}

type WireWordDiff = {
  status: string
  expected: string
  actual: string
}

type WireGradeResp = {
  id: string
  user_transcript?: string
  userTranscript?: string
  pronunciation_score?: number
  pronunciationScore?: number
  fluency_score?: number
  fluencyScore?: number
  coach_feedback?: string
  coachFeedback?: string
  word_diffs?: WireWordDiff[]
  wordDiffs?: WireWordDiff[]
  created_at?: WireTs
  createdAt?: WireTs
}

type WireSession = {
  id: string
  exercise_id?: string
  exerciseId?: string
  prompt: string
  user_transcript?: string
  userTranscript?: string
  pronunciation_score?: number
  pronunciationScore?: number
  fluency_score?: number
  fluencyScore?: number
  coach_feedback?: string
  coachFeedback?: string
  created_at?: WireTs
  createdAt?: WireTs
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

function normalizeLevel(v: string): SpeakingLevel {
  switch (v) {
    case 'B1':
    case 'B2':
    case 'C1':
      return v
    default:
      return 'B2'
  }
}

function normalizeStatus(v: string): WordDiffStatus {
  switch (v) {
    case 'match':
    case 'miss':
    case 'extra':
    case 'substitute':
      return v
    default:
      return 'match'
  }
}

export async function listSpeakingExercises(level?: SpeakingLevel): Promise<SpeakingExercise[]> {
  const qs = level ? `?level=${level}` : ''
  const resp = await api<{ items?: WireExercise[] }>(`/hone/speaking/exercises${qs}`)
  return (resp.items ?? []).map((ex) => ({
    id: ex.id,
    level: normalizeLevel(ex.level),
    topic: ex.topic ?? '',
    prompt: ex.prompt,
    audioUrl: ex.audio_url ?? ex.audioUrl ?? '',
  }))
}

export interface GradeSpeakingArgs {
  exerciseId: string
  clientSessionId: string
  audioBlob: Blob
  durationMs: number
}

async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const r = reader.result
      if (typeof r !== 'string') {
        reject(new Error('FileReader returned non-string'))
        return
      }
      const idx = r.indexOf('base64,')
      resolve(idx >= 0 ? r.slice(idx + 'base64,'.length) : r)
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(blob)
  })
}

export async function gradeSpeaking(args: GradeSpeakingArgs): Promise<SpeakingGradeResult> {
  const audioBase64 = await blobToBase64(args.audioBlob)
  const mimeType = args.audioBlob.type || 'audio/webm'
  const resp = await api<WireGradeResp>(`/hone/speaking/grade`, {
    method: 'POST',
    body: JSON.stringify({
      exercise_id: args.exerciseId,
      client_session_id: args.clientSessionId,
      audio_base64: audioBase64,
      mime_type: mimeType,
      duration_ms: args.durationMs,
    }),
  })
  return {
    id: resp.id,
    userTranscript: resp.user_transcript ?? resp.userTranscript ?? '',
    pronunciationScore: resp.pronunciation_score ?? resp.pronunciationScore ?? 0,
    fluencyScore: resp.fluency_score ?? resp.fluencyScore ?? 0,
    coachFeedback: resp.coach_feedback ?? resp.coachFeedback ?? '',
    wordDiffs: (resp.word_diffs ?? resp.wordDiffs ?? []).map((d) => ({
      status: normalizeStatus(d.status),
      expected: d.expected,
      actual: d.actual,
    })),
    createdAt: parseTs(resp.created_at ?? resp.createdAt),
  }
}

export async function listSpeakingHistory(limit = 14): Promise<SpeakingSession[]> {
  const qs = limit !== 14 ? `?limit=${limit}` : ''
  const resp = await api<{ items?: WireSession[] }>(`/hone/speaking/history${qs}`)
  return (resp.items ?? []).map((s) => ({
    id: s.id,
    exerciseId: s.exercise_id ?? s.exerciseId ?? '',
    prompt: s.prompt,
    userTranscript: s.user_transcript ?? s.userTranscript ?? '',
    pronunciationScore: s.pronunciation_score ?? s.pronunciationScore ?? 0,
    fluencyScore: s.fluency_score ?? s.fluencyScore ?? 0,
    coachFeedback: s.coach_feedback ?? s.coachFeedback ?? '',
    createdAt: parseTs(s.created_at ?? s.createdAt),
  }))
}
