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

// Phase-1: cluster colors collapsed to a monochrome ramp. Atlas now reads
// as a single material with strength shown by node intensity, not hue.
// Differentiation between clusters comes from layout + label, not color
// — same rule as the rest of the unified palette (one accent: red).
// If we later need cluster differentiation back, do it via 6 ink-tints
// of slightly varying saturation rather than reintroducing rainbow.
export const CLUSTER_COLOR: Record<string, string> = {
  algorithms:      '#FFFFFF',
  algo:            '#FFFFFF',
  data_structures: '#D9D9D9',
  ds:              '#D9D9D9',
  system_design:   '#B3B3B3',
  sysdes:          '#B3B3B3',
  go:              '#8C8C8C',
  backend:         '#8C8C8C',
  concurrency:     '#666666',
  sql:             '#A6A6A6',
  behavioral:      '#737373',
}

export function clusterColor(cluster: string | undefined): string {
  if (!cluster) return '#FFFFFF'
  return CLUSTER_COLOR[cluster] ?? '#FFFFFF'
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
