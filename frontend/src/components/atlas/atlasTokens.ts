// Atlas SVG tokens — Wave-10 PoE-inspired passive-tree (design-review v2).
//
// Single source of truth for colour-per-cluster, node radii, path-glow
// stroke widths and SVG <defs> ids referenced from <AtlasNode>, <AtlasEdge>,
// <AtlasHub>, <AtlasKeystone> and <AtlasClusterAura>. Splitting into a
// pure-data module lets us test layout math without rendering and keeps
// the JSX components small.
//
// All colours match design-system tokens (frontend/src/lib/cn.ts / tailwind
// theme). Hex literals are intentional here — SVG gradients can't consume
// CSS variables directly under all browsers, and these values are stable
// across the dark theme (we don't ship light-theme atlas).

export type AtlasNodeKind = 'hub' | 'keystone' | 'notable' | 'small'

export type AtlasNodeState =
  | 'mastered'
  | 'active'
  | 'decaying'
  | 'not_started'
  | 'locked'

export type AtlasEdgeKind = 'prereq' | 'suggested' | 'crosslink'

// Colour-per-cluster — designer-allocated palette. Falls back to accent
// for clusters not in this map (graceful degrade for new clusters added
// in admin CMS before the palette is updated).
export const CLUSTER_COLOR: Record<string, string> = {
  algorithms: '#582CFF', // accent
  algo: '#582CFF',
  data_structures: '#22D3EE', // cyan
  ds: '#22D3EE',
  system_design: '#F472B6', // pink
  sysdes: '#F472B6',
  go: '#10B981', // success
  backend: '#10B981',
  concurrency: '#FBBF24', // warn
  sql: '#22D3EE',
  behavioral: '#A78BFA',
}

export function clusterColor(cluster: string | undefined): string {
  if (!cluster) return '#582CFF'
  return CLUSTER_COLOR[cluster] ?? '#582CFF'
}

// Node radius per kind. Hub is the visual anchor, keystones diamonds are
// drawn separately but their bounding circle uses this same number for
// edge-shorten calculations.
export const NODE_RADIUS: Record<AtlasNodeKind, number> = {
  hub: 32,
  keystone: 18,
  notable: 14,
  small: 8,
}

// SVG <defs> ids. Centralised so <AtlasCanvas> can include them once and
// children reference by url(#id). Changing an id here is a one-place edit.
export const DEFS_IDS = {
  arrowMarker: 'atlas-arrow',
  pathGlow: 'atlas-path-glow',
  nodeBevel: 'atlas-node-bevel',
  hubCore: 'atlas-hub-core',
} as const

/**
 * shortenedSegment — pull both endpoints inward so the stroke doesn't
 * disappear inside the node circles. Returns null when the two centres
 * are closer than `2 * shorten` (degenerate edge — caller should skip).
 *
 * Used by <AtlasEdge> to stop the line at the visible boundary of the
 * connected nodes regardless of their kind/radius.
 */
export function shortenedSegment(
  from: { x: number; y: number },
  to: { x: number; y: number },
  shortenFrom: number,
  shortenTo: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < shortenFrom + shortenTo + 1) {
    return null
  }
  const ux = dx / len
  const uy = dy / len
  return {
    x1: from.x + ux * shortenFrom,
    y1: from.y + uy * shortenFrom,
    x2: to.x - ux * shortenTo,
    y2: to.y - uy * shortenTo,
  }
}
