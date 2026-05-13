// Цель: показать каждой atlas-node визуальный signal «что юзер уже трогал»
// + section. Возвращает CoverageState per node-key.
//
// Когда backend mapping ship'нет — этот модуль становится fallback для
// offline; primary source — `user_atlas_node_state` aggregation.

import { getDailyActivityCounts, listActivities, type Activity } from './activity'

export type CoverageState =
  | 'covered'    // 3+ matches за 30d
  | 'partial'    // 1-2 matches
  | 'struggling' // matches но >2 без recent activity (cold)
  | 'not_yet'    // 0 matches

export interface NodeCoverage {
  state: CoverageState
  matchCount30d: number
  matchCount7d: number
  lastMatchAt: number | null
  matchedActivities: Activity[]
}

interface NodeRef {
  key: string
  title: string
  section: string
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
  'и', 'в', 'на', 'с', 'для', 'из', 'к', 'о', 'об', 'от',
])

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  )
}

function intersectSize(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const t of a) if (b.has(t)) n++
  return n
}

/**
 * Score-based matching: activity matches node if tokens overlap.
 * Score = matched_tokens / log(node_tokens.size + 1).
 * Anti-fallback: minimal match (1 token) accepted only когда node title
 * длинный и token «strong» (>=5 chars). Иначе требуем ≥2 tokens.
 */
function activityMatches(activity: Activity, nodeTokens: Set<string>, sectionTokens: Set<string>): boolean {
  const aText = `${activity.title} ${activity.source ?? ''}`
  const aTokens = tokenize(aText)
  const titleOverlap = intersectSize(aTokens, nodeTokens)
  if (titleOverlap >= 2) return true
  // Single strong token (≥5 chars) is OK когда section tokens тоже совпадают.
  if (titleOverlap === 1) {
    const sectionOverlap = intersectSize(aTokens, sectionTokens)
    if (sectionOverlap > 0) {
      for (const t of aTokens) if (nodeTokens.has(t) && t.length >= 5) return true
    }
  }
  return false
}

/**
 * computeCoverage — для given list of nodes, возвращает Map по node.key.
 * Single pass per node (acceptable для catalog < 1000 nodes). Когда masштаб
 * вырастет — invert index (token → node[]).
 */
export function computeCoverage(nodes: NodeRef[]): Map<string, NodeCoverage> {
  const activities = listActivities()
  const now = Date.now()
  const cutoff30d = now - 30 * 24 * 60 * 60 * 1000
  const cutoff7d = now - 7 * 24 * 60 * 60 * 1000
  const recentActivities = activities.filter((a) => a.occurredAt >= cutoff30d)

  const out = new Map<string, NodeCoverage>()
  for (const node of nodes) {
    const nodeTokens = tokenize(node.title)
    const sectionTokens = tokenize(node.section)
    const matched: Activity[] = []
    for (const act of recentActivities) {
      if (activityMatches(act, nodeTokens, sectionTokens)) matched.push(act)
    }
    const count30d = matched.length
    const count7d = matched.filter((a) => a.occurredAt >= cutoff7d).length
    const lastMatchAt = matched.length > 0
      ? matched.reduce((max, a) => (a.occurredAt > max ? a.occurredAt : max), 0)
      : null

    let state: CoverageState
    if (count30d === 0) state = 'not_yet'
    else if (count30d >= 3) state = 'covered'
    else if (count7d === 0) state = 'struggling' // 1-2 matches но не недавние
    else state = 'partial'

    out.set(node.key, {
      state,
      matchCount30d: count30d,
      matchCount7d: count7d,
      lastMatchAt,
      matchedActivities: matched,
    })
  }
  return out
}

/**
 * Summary across nodes — для surface'ов которые хотят показать «N node'ов
 * covered из M visible». Computes pure counts.
 */
export function summarizeCoverage(nodes: NodeRef[]): {
  total: number
  covered: number
  partial: number
  struggling: number
  notYet: number
} {
  const cov = computeCoverage(nodes)
  let covered = 0, partial = 0, struggling = 0, notYet = 0
  for (const c of cov.values()) {
    if (c.state === 'covered') covered++
    else if (c.state === 'partial') partial++
    else if (c.state === 'struggling') struggling++
    else notYet++
  }
  return { total: nodes.length, covered, partial, struggling, notYet }
}

// Debug helper — used by preview_eval to confirm tokenize works as expected.
// Pure function, no side effects — safe для production.
export function _debugMatchProbe(activity: Activity, node: NodeRef): {
  aTokens: string[]
  nodeTokens: string[]
  overlap: number
  matches: boolean
  recentCount: number
} {
  const nodeTokens = tokenize(node.title)
  const sectionTokens = tokenize(node.section)
  const aText = `${activity.title} ${activity.source ?? ''}`
  const aTokens = tokenize(aText)
  const allActivities = listActivities()
  const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000
  return {
    aTokens: [...aTokens],
    nodeTokens: [...nodeTokens],
    overlap: intersectSize(aTokens, nodeTokens),
    matches: activityMatches(activity, nodeTokens, sectionTokens),
    recentCount: allActivities.filter((a) => a.occurredAt >= cutoff30d).length,
  }
}

// Exposed для testability: возвращает 30-day activity histogram aligned
// с node match periods.
export function recentActivityDays(): number {
  return getDailyActivityCounts(30).filter((b) => b.count > 0).length
}
