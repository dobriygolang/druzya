// codexHelpers — pure-presentation utilities для R1 (Phase A) Codex
// ranking-proxy enhancements:
//   - getSourceIcon(source): maps source string → lucide icon component
//   - pickRecommendedArticles(articles, weakest): F9 diagnostic-driven «for you»
//   - sortArticles(articles, mode): ranking-proxy dropdown
//
// Anti-fallback: если diagnostic не пройден, pickRecommendedArticles
// возвращает empty array (не fake-recommend случайные). Сurfaces скрывают
// recommended section в этом случае.

import {
  BookOpen,
  Globe,
  FileText,
  Play,
  Code,
  Library,
  type LucideIcon,
} from 'lucide-react'

import type { CodexArticle } from './queries/codex'

/**
 * Map source string (free-text, set админом в Codex CMS) → lucide icon.
 * Case-insensitive. Falls back to generic Globe.
 *
 * Currently supports: Wikipedia / MDN / RFC / YouTube / GitHub / Codex /
 * arXiv / academic.
 */
export function getSourceIcon(source: string): LucideIcon {
  const s = source.toLowerCase()
  if (s.includes('wikipedia') || s.includes('wiki')) return Library
  if (s.includes('mdn')) return BookOpen
  if (s.includes('rfc') || s.includes('ietf')) return FileText
  if (s.includes('youtube') || s.includes('youtu.be')) return Play
  if (s.includes('github')) return Code
  if (s.includes('arxiv') || s.includes('paper') || s.includes('acm')) return FileText
  return Globe
}

// Map F9 `weakest` answer → Codex category slugs (best-effort fuzzy match).
// Multiple categories per weakness — Codex может иметь похожие cats под
// разными именами (sysdesign / system_design / distributed_systems).
const WEAKEST_TO_CATEGORIES: Record<string, string[]> = {
  // Go track
  algos: ['algorithms', 'algos', 'leetcode', 'data_structures'],
  concurrency: ['concurrency', 'go_concurrency', 'go'],
  sysdesign: ['system_design', 'sysdesign', 'architecture'],
  databases: ['sql', 'databases', 'data', 'storage'],
  distributed: ['distributed', 'distributed_systems', 'system_design', 'consensus'],
  // ML track
  classical: ['ml', 'machine_learning', 'classical_ml'],
  deep_learning: ['deep_learning', 'dl', 'transformers', 'pytorch'],
  mlops: ['mlops', 'ml_systems', 'productionizing_ml'],
  research: ['ml_research', 'papers', 'research'],
  statistics: ['statistics', 'stats', 'ab_testing'],
  systems: ['ml_systems', 'recsys', 'feature_stores'],
  // English track
  speaking: ['english_speaking', 'pronunciation', 'speaking'],
  listening: ['english_listening', 'listening'],
  reading: ['english_reading', 'reading'],
  vocabulary: ['english_vocabulary', 'vocabulary'],
  grammar: ['english_grammar', 'grammar'],
}

/**
 * Pick top-N articles matching юзера weakest area из F9 diagnostic.
 * Если weakest пуст или не нашлось ни одного match — возвращает [] (
 * каллер скрывает Recommended section, не симулируем советы).
 */
export function pickRecommendedArticles(
  articles: CodexArticle[],
  weakest: string | undefined | null,
  limit = 3,
): CodexArticle[] {
  if (!weakest) return []
  const cats = WEAKEST_TO_CATEGORIES[weakest]
  if (!cats || cats.length === 0) return []

  const candidates = articles.filter((a) => cats.includes(a.category))
  if (candidates.length === 0) return []

  // Сортируем: shortest read first (быстро вгрызться), затем sort_order
  // (admin curation tie-breaker).
  return [...candidates]
    .sort((a, b) => {
      if (a.read_min !== b.read_min) return a.read_min - b.read_min
      return a.sort_order - b.sort_order
    })
    .slice(0, limit)
}

export type CodexSortMode = 'default' | 'shortest' | 'longest' | 'alphabetical'

export const SORT_LABELS: Record<CodexSortMode, string> = {
  default: 'По умолчанию',
  shortest: 'Короче первым',
  longest: 'Длиннее первым',
  alphabetical: 'А → Я',
}

/**
 * Sort articles by ranking mode. Default uses CMS sort_order (admin curation).
 * Other modes — pure presentation, не меняет underlying data.
 */
export function sortArticles(articles: CodexArticle[], mode: CodexSortMode): CodexArticle[] {
  const copy = [...articles]
  switch (mode) {
    case 'shortest':
      return copy.sort((a, b) => a.read_min - b.read_min)
    case 'longest':
      return copy.sort((a, b) => b.read_min - a.read_min)
    case 'alphabetical':
      return copy.sort((a, b) => a.title.localeCompare(b.title, 'ru'))
    case 'default':
    default:
      return copy.sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category)
        return a.sort_order - b.sort_order
      })
  }
}
