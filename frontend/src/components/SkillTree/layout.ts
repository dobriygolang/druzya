import type { AtlasEdge, AtlasNode } from '../../lib/queries/profile'

export type Point = { x: number; y: number }
export type LayoutMap = Map<string, Point>

// Radial spoke angles — Algorithms at top (-90°), clockwise every 72°.
export const SECTION_ORDER = [
  'algorithms', 'sql', 'go', 'system_design', 'behavioral',
] as const
export type SectionKey = (typeof SECTION_ORDER)[number]

export const SECTION_ANGLE: Record<SectionKey, number> = {
  algorithms: -90, sql: -18, go: 54, system_design: 126, behavioral: 198,
}

const R_INNER = 110
const R_MID = 195
const R_OUTER = 275

/**
 * Deterministic radial layout. Center at (0,0). Each section owns a spoke.
 * Spine nodes (directly attached to center) are placed on the spoke: normals
 * at the inner ring, keystones at the mid ring. Multiple siblings fan ±8°
 * tangentially. Leaves (those with a parent edge) are placed one ring
 * further out, angled off-spoke in the parent's tangent direction so edges
 * don't cross.
 */
export function layout(
  nodes: AtlasNode[], edges: AtlasEdge[], centerKey: string,
): LayoutMap {
  const coords: LayoutMap = new Map()
  coords.set(centerKey, { x: 0, y: 0 })

  // parent index — first-seen wins, ignore center-attachment edges
  const parentOf = new Map<string, string>()
  for (const e of edges) {
    if (e.from === centerKey || e.to === centerKey) continue
    if (!parentOf.has(e.to)) parentOf.set(e.to, e.from)
  }

  // group nodes per section (skip center)
  const bySection = new Map<string, AtlasNode[]>()
  for (const n of nodes) {
    if (n.key === centerKey) continue
    const list = bySection.get(n.section) ?? []
    list.push(n)
    bySection.set(n.section, list)
  }

  for (const section of SECTION_ORDER) {
    const list = bySection.get(section)
    if (!list || list.length === 0) continue
    const baseRad = (SECTION_ANGLE[section] * Math.PI) / 180

    const spine = list.filter((n) => !parentOf.has(n.key))
    const leaves = list.filter((n) => parentOf.has(n.key))

    const inner: AtlasNode[] = []
    const mid: AtlasNode[] = []
    for (const n of spine) {
      if (n.kind === 'keystone') mid.push(n)
      else inner.push(n)
    }

    const placeBucket = (bucket: AtlasNode[], radius: number) => {
      const count = bucket.length
      const fan = 16
      bucket.forEach((n, i) => {
        const off = count === 1 ? 0 : -fan / 2 + (i * fan) / (count - 1)
        const a = baseRad + (off * Math.PI) / 180
        coords.set(n.key, { x: Math.cos(a) * radius, y: Math.sin(a) * radius })
      })
    }
    placeBucket(inner, R_INNER)
    placeBucket(mid, R_MID)

    // Leaves: outer ring, biased along parent's tangent (alternating sides).
    leaves.forEach((n) => {
      const parentKey = parentOf.get(n.key)!
      const parent = coords.get(parentKey)
      if (!parent) return
      const parentAngle = Math.atan2(parent.y, parent.x)
      const parentRadius = Math.hypot(parent.x, parent.y)
      const r = Math.min(R_OUTER, parentRadius + 95)
      const siblings = leaves.filter((l) => parentOf.get(l.key) === parentKey)
      const idx = siblings.findIndex((s) => s.key === n.key)
      const tangentDeg =
        siblings.length === 1 ? 0 : (idx - (siblings.length - 1) / 2) * 14
      const a = parentAngle + (tangentDeg * Math.PI) / 180
      coords.set(n.key, { x: Math.cos(a) * r, y: Math.sin(a) * r })
    })
  }

  return coords
}
