// intelligence.ts — react-query hook для AI Coach (services/intelligence).
//
// Endpoint: POST /api/v1/intelligence/daily-brief — возвращает synthesised
// brief из cross-product сигналов (Hone focus, mock-interview scores, arena
// outcomes, kata streak, weak skills, today's queue).
//
// Cache: backend кеширует на сутки. Frontend дополнительно держит
// staleTime 10 мин чтобы не дёргать на каждый mount InsightsPage.
import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type RecommendationKind =
  | 'tiny_task'
  | 'schedule'
  | 'review_note'
  | 'unblock'
  | 'practice_skill'
  | 'drill_mock'
  | 'drill_kata'

export interface BriefRecommendation {
  kind: RecommendationKind
  title: string
  rationale: string
  target_id?: string
}

// CoachSeverity — Phase 4.4 wire enum, mirrors druz9.v1.InsightSeverity.
// Empty / unknown сервер кодирует как 'cruise' через мап ниже.
export type CoachSeverity = 'cruise' | 'nudge' | 'warn' | 'critical'

export interface DailyBrief {
  brief_id?: string
  headline: string
  narrative: string
  recommendations: BriefRecommendation[]
  generated_at?: string
  // Wire variants:
  //   - chi-direct handler отдаёт raw string ('cruise' | 'warn' | …)
  //   - vanguard transcoder отдаёт proto enum имя ('INSIGHT_SEVERITY_WARN')
  //   - legacy / отсутствие → undefined
  // Хелпер normalizeSeverity ниже маппит всё в CoachSeverity.
  severity?: string
  severity_reason?: string
}

export function normalizeSeverity(s: string | undefined): CoachSeverity {
  if (!s) return 'cruise'
  const v = s.toLowerCase()
  if (v.includes('critical')) return 'critical'
  if (v.includes('warn')) return 'warn'
  if (v.includes('nudge')) return 'nudge'
  return 'cruise'
}

const STALE_MS = 10 * 60 * 1000

export const intelligenceKeys = {
  brief: () => ['intelligence', 'daily-brief'] as const,
  memoryStats: () => ['intelligence', 'memory-stats'] as const,
  atlasStruggles: () => ['intelligence', 'atlas-struggles'] as const,
}

export function useDailyBriefQuery() {
  return useQuery({
    queryKey: intelligenceKeys.brief(),
    queryFn: () =>
      api<DailyBrief>('/intelligence/daily-brief', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
    staleTime: STALE_MS,
    // 503 (LLM unavailable) — частая в dev'е без OpenRouter ключа. Не
    // ретраим, показываем placeholder card.
    retry: false,
  })
}

// GET /api/v1/intelligence/memory/stats (см intelligence.proto:337). Возвращает
// сколько событий coach «помнит» за 30 дней + breakdown по kind. Используется
// на AITutorChatPage (badge «coach помнит N событий») и в Hone DailyBriefPanel.
//
// `byKind` keys mirror domain.EpisodeKind constants: brief_emitted /
// brief_followed / reflection_added / mock_pipeline_finished / standup_recorded
// и т.д. (16 видов total).
export interface MemoryStats {
  total30d: number
  byKind: Record<string, number>
}

// Wire shape: backend кодирует камень_кейс protobuf-имена в snake_case JSON.
// total_30d → total30d на frontend, by_kind → byKind. Хранится в snake_case
// чтобы api<T> deserialise работал zero-cost (matches generated TS types).
interface MemoryStatsWire {
  total_30d?: number
  by_kind?: Record<string, number>
}

export function useMemoryStatsQuery() {
  return useQuery({
    queryKey: intelligenceKeys.memoryStats(),
    queryFn: async (): Promise<MemoryStats> => {
      const wire = await api<MemoryStatsWire>('/intelligence/memory/stats')
      return {
        total30d: wire.total_30d ?? 0,
        byKind: wire.by_kind ?? {},
      }
    },
    // Memory stats — slow-changing trust indicator. 5 min staleTime
    // достаточно: episode counter инкрементится 1-2 раза в час максимум.
    staleTime: 5 * 60 * 1000,
    // 401 на /memory/stats → апи-клиент сам редиректит на /welcome, ретраить
    // нет смысла. Backend errors допустимо показывать как «coach is learning…»
    // (badge fallback in CoachMemoryHeader).
    retry: false,
  })
}

// Cross-product handoff: Cue session analysis + Hone reflection emit
// MarkAtlasStruggle when user is stuck on a topic. Web Atlas reads via
// useAtlasStrugglesQuery and renders subtle b/w indicators (single red
// dot per CLAUDE.md rule) on matched nodes.
//
// Endpoint: GET /api/v1/intelligence/atlas/struggle?window_days=30
// 503/empty → silent fallback (empty array, no struggle highlights).

export interface AtlasStruggleMark {
  atlasNodeId: string
  source: 'cue_session' | 'hone_reflection' | 'mock_stage' | 'manual'
  confidence: number
  note: string
  markedAt: string
}

interface AtlasStruggleWire {
  atlas_node_id?: string
  source?: string
  confidence?: number
  note?: string
  marked_at?: string
}

interface ListAtlasStrugglesWire {
  items?: AtlasStruggleWire[]
}

export function useAtlasStrugglesQuery(windowDays = 30) {
  return useQuery({
    queryKey: [...intelligenceKeys.atlasStruggles(), windowDays],
    queryFn: async (): Promise<AtlasStruggleMark[]> => {
      const wire = await api<ListAtlasStrugglesWire>(
        `/intelligence/atlas/struggle?window_days=${windowDays}`,
      )
      return (wire.items ?? []).map((w) => ({
        atlasNodeId: w.atlas_node_id ?? '',
        source: (w.source as AtlasStruggleMark['source']) ?? 'manual',
        confidence: w.confidence ?? 0.5,
        note: w.note ?? '',
        markedAt: w.marked_at ?? '',
      }))
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

