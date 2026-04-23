// Atlas layout — graceful fallback when backend nodes lack designer-pinned
// pos_x/pos_y coordinates (Wave-10, design-review v2).
//
// Philosophy: clusters should ideally be hand-laid by a designer in the
// admin CMS — PoE atlas is a hand-tuned canvas, not an algorithmic output.
// But until the operator sits down to place every new node, we need a
// deterministic auto-place so the page never renders broken.
//
// Fallback is a simple per-cluster ring arrangement around the hub:
//   - Hub at (centerX, centerY)
//   - Each cluster occupies an equal slice of the 360° circle
//   - Within a cluster, nodes stack on 3 concentric rings by kind
//     (small=innermost, notable=middle, keystone=outermost)
//
// This is intentionally NOT the Wave-10 target visual — it's a "page works
// on day 1 with N=0 designer placements". The admin CMS pin workflow is
// what gets you to the actual PoE-like density.

import type { AtlasNode } from '../../lib/queries/profile'

export type LaidNode = AtlasNode & {
  x: number
  y: number
}

const VIEWBOX = 1400 // AtlasCanvas renders 0..1400 ×  0..1400
const CENTER = { x: VIEWBOX / 2, y: VIEWBOX / 2 }
const RING_RADIUS_BY_KIND: Record<string, number> = {
  small: 240,
  notable: 380,
  keystone: 520,
  hub: 0,
}

/**
 * layoutAtlas — produce a LaidNode per input node with (x, y) filled in.
 *
 * Precedence:
 *   1. `pos_set && pos_x && pos_y` → use designer coordinates verbatim.
 *   2. `kind === 'hub'` → always at centre.
 *   3. Fallback ring by cluster sector × kind radius.
 *
 * Deterministic: same input → same output (cluster order is sorted alpha,
 * in-cluster order follows input-array order). No randomness, no time.
 */
export function layoutAtlas(nodes: AtlasNode[]): LaidNode[] {
  if (nodes.length === 0) return []

  // Bucket non-hub nodes by cluster for sector assignment.
  const clusters = new Set<string>()
  for (const n of nodes) {
    if (n.kind !== 'hub' && n.cluster) clusters.add(n.cluster)
  }
  const clusterList = Array.from(clusters).sort()
  const sectorCount = Math.max(clusterList.length, 1)
  const sectorDeg = 360 / sectorCount

  // Per-cluster, per-kind counters so nodes on the same ring of the same
  // cluster fan out rather than pile on top of each other.
  const counters = new Map<string, number>()
  const key = (cluster: string, kind: string) => `${cluster}::${kind}`
  const totalOnRing = new Map<string, number>()
  for (const n of nodes) {
    if (n.kind === 'hub') continue
    const k = key(n.cluster ?? '__ungrouped__', n.kind)
    totalOnRing.set(k, (totalOnRing.get(k) ?? 0) + 1)
  }

  return nodes.map((n) => {
    // 1. Designer-pinned coordinates win.
    if (n.pos_set && typeof n.pos_x === 'number' && typeof n.pos_y === 'number') {
      return { ...n, x: n.pos_x, y: n.pos_y }
    }
    // 2. Hub — always centre.
    if (n.kind === 'hub') {
      return { ...n, x: CENTER.x, y: CENTER.y }
    }
    // 3. Fallback ring.
    const cluster = n.cluster ?? '__ungrouped__'
    const ringR = RING_RADIUS_BY_KIND[n.kind] ?? 300
    const sectorIdx = clusterList.indexOf(cluster)
    const sectorCentre = sectorIdx * sectorDeg + sectorDeg / 2 - 90 // -90 so 0° points up
    // Spread within-sector for same-kind nodes.
    const kKey = key(cluster, n.kind)
    const total = totalOnRing.get(kKey) ?? 1
    const idx = counters.get(kKey) ?? 0
    counters.set(kKey, idx + 1)
    const spread = Math.min(sectorDeg * 0.7, 60) // cap so sectors don't overlap
    const offset = total === 1 ? 0 : (idx / (total - 1) - 0.5) * spread
    const deg = sectorCentre + offset
    const rad = (deg * Math.PI) / 180
    return {
      ...n,
      x: CENTER.x + ringR * Math.cos(rad),
      y: CENTER.y + ringR * Math.sin(rad),
    }
  })
}

/**
 * labelFor — compute a label anchor that sits OUTSIDE the node on the
 * radial axis, so labels never overlap edges. Returns `{ x, y, anchor }`
 * where anchor ∈ {start, middle, end} for `text-anchor` attribute.
 */
export function labelFor(
  nodeX: number,
  nodeY: number,
  extraRadius = 22,
): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
  const dx = nodeX - CENTER.x
  const dy = nodeY - CENTER.y
  const len = Math.hypot(dx, dy) || 1
  const lx = nodeX + (dx / len) * extraRadius
  const ly = nodeY + (dy / len) * extraRadius
  const anchor: 'start' | 'middle' | 'end' = dx > 20 ? 'start' : dx < -20 ? 'end' : 'middle'
  return { x: lx, y: ly, anchor }
}

export const ATLAS_VIEWBOX = VIEWBOX
export const ATLAS_CENTER = CENTER
