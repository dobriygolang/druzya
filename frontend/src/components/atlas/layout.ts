// Atlas layout — graceful fallback when backend nodes lack designer-pinned
// pos_x/pos_y coordinates.
//
// Philosophy: clusters should ideally be hand-laid by a designer in the
// admin CMS — PoE atlas is a hand-tuned canvas, not an algorithmic output.
// Until designer pins every node, we need deterministic auto-place так
// чтобы page никогда не была сломана.
//
//   1. Все hub'ы садились на CENTER → если юзер выбрал 2+ track-kind с
//      разными hubs, они накладывались друг на друга (mlplat_root +
//      qa_root + do_root в одной точке).
//   2. spread cap 60° → при 7+ узлах одного kind на ring они стояли
//      слишком плотно с overlapping bboxes.
//   3. Cluster sectors не учитывали разный размер cluster'ов: один
//      cluster с 3 узлами получал тот же сектор что cluster с 12.
//
// Новый layout:
//   - Single hub case → center
//   - Multi-hub case → hubs распределены по mini-orbit (radius 80)
//     равномерно вокруг центра
//   - Children per cluster выкладываются вокруг СВОЕГО hub'а (не
//     вокруг главного center) на cluster-local rings
//   - Sector size adjusted for child-count → cluster с 12 узлами
//     получает шире сектор чем cluster с 3
//   - Spread cap расширен до 110° + dynamic spacing minimum 14°/узел

import type { AtlasNode } from '../../lib/queries/profile'

export type LaidNode = AtlasNode & {
  x: number
  y: number
}

const VIEWBOX = 1400
const CENTER = { x: VIEWBOX / 2, y: VIEWBOX / 2 }

// Multi-hub orbit — когда кластеров > 1, hubs не сходятся в центре,
// а распределяются по orbit'у этого радиуса. 220 даёт места под
// children на 3 концентрических кольца внутри cluster (240/380/520
// ring radii ниже считаются ОТ hub'а cluster'а, не от главного центра).
const HUB_ORBIT_RADIUS = 220

// Cluster-local ring radii (расстояние от hub'а cluster'а до узла).
const RING_RADIUS_BY_KIND: Record<string, number> = {
  small: 100,
  notable: 170,
  keystone: 250,
  hub: 0,
}

// Min angular spacing per узел на ring — гарантирует что узлы не
// накладываются bbox'ами. 16° при keystone-radius 250 = ~70px arc =
// больше keystone bbox (36px) с padding.
const MIN_DEG_PER_NODE = 16

/**
 * layoutAtlas — produce a LaidNode per input node with (x, y) filled in.
 *
 * Precedence:
 *   1. `pos_set && pos_x && pos_y` → use designer coordinates verbatim.
 *   2. Single-cluster atlas → traditional center-hub + radial children
 *   3. Multi-cluster → hubs on outer orbit, children radial around their hub
 */
export function layoutAtlas(nodes: AtlasNode[]): LaidNode[] {
  if (nodes.length === 0) return []

  // 1. Pull out designer-pinned nodes — они проходят через сразу.
  const pinned: LaidNode[] = []
  const fallback: AtlasNode[] = []
  for (const n of nodes) {
    if (n.pos_set && typeof n.pos_x === 'number' && typeof n.pos_y === 'number') {
      pinned.push({ ...n, x: n.pos_x, y: n.pos_y })
    } else {
      fallback.push(n)
    }
  }

  // 2. Group fallback by cluster. Hub of cluster — anchor для children.
  type ClusterBucket = {
    name: string
    hub?: AtlasNode
    children: AtlasNode[]
  }
  const buckets = new Map<string, ClusterBucket>()
  for (const n of fallback) {
    const cluster = n.cluster ?? '__ungrouped__'
    let b = buckets.get(cluster)
    if (!b) {
      b = { name: cluster, children: [] }
      buckets.set(cluster, b)
    }
    if (n.kind === 'hub') {
      b.hub = n
    } else {
      b.children.push(n)
    }
  }
  const bucketList = Array.from(buckets.values()).sort((a, b) => a.name.localeCompare(b.name))

  // 3. Place hubs. Single bucket → hub в центр. Multi → on orbit.
  const hubPositions = new Map<string, { x: number; y: number }>()
  if (bucketList.length === 1) {
    hubPositions.set(bucketList[0].name, { ...CENTER })
  } else {
    const step = 360 / bucketList.length
    bucketList.forEach((b, i) => {
      const deg = step * i - 90 // -90 чтобы первый hub был сверху
      const rad = (deg * Math.PI) / 180
      hubPositions.set(b.name, {
        x: CENTER.x + HUB_ORBIT_RADIUS * Math.cos(rad),
        y: CENTER.y + HUB_ORBIT_RADIUS * Math.sin(rad),
      })
    })
  }

  // 4. Place each cluster's children radially around their hub. Sector
  // angular size — full circle (children fan out 360°), но с outward
  // bias чтобы children не лезли в соседний cluster'а сектор.
  const placed: LaidNode[] = [...pinned]
  for (const bucket of bucketList) {
    const hubPos = hubPositions.get(bucket.name) ?? CENTER

    // Place hub.
    if (bucket.hub) {
      placed.push({ ...bucket.hub, x: hubPos.x, y: hubPos.y })
    }

    // Group children by kind so same-kind узлы стоят на one ring.
    const byKind = new Map<string, AtlasNode[]>()
    for (const c of bucket.children) {
      const arr = byKind.get(c.kind) ?? []
      arr.push(c)
      byKind.set(c.kind, arr)
    }

    // Outward bias — direction OT главного центра К hub'у. Children
    // веером в эту полусферу так, что они не пересекаются с соседним
    // cluster'ом.
    const dx = hubPos.x - CENTER.x
    const dy = hubPos.y - CENTER.y
    const hubAngle =
      bucketList.length === 1
        ? -90 // single cluster → веером "вверх" (произвольно, эстетика)
        : (Math.atan2(dy, dx) * 180) / Math.PI

    for (const [kind, kids] of byKind.entries()) {
      const ringR = RING_RADIUS_BY_KIND[kind] ?? 200
      const count = kids.length

      // Спред: equal spacing с min-degrees-per-node, capped на 220°
      // чтобы children не выходили за back-side hub'а.
      let spreadDeg = Math.max(MIN_DEG_PER_NODE * count, 60)
      const maxSpread = bucketList.length === 1 ? 360 : 220
      if (spreadDeg > maxSpread) spreadDeg = maxSpread

      kids.forEach((node, i) => {
        // Equal-spacing идёт от -spreadDeg/2 до +spreadDeg/2.
        const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * spreadDeg
        const deg = hubAngle + offset
        const rad = (deg * Math.PI) / 180
        placed.push({
          ...node,
          x: hubPos.x + ringR * Math.cos(rad),
          y: hubPos.y + ringR * Math.sin(rad),
        })
      })
    }
  }

  // 5. Collision repulsion — single-pass pairwise. O(n²), но n обычно
  // 30-100, что вписывается в один render-frame. Толкаем оба узла друг
  // от друга если расстояние < r1+r2+padding.
  return relaxCollisions(placed)
}

// Approximate node radius for collision detection (must roughly match
// atlasTokens.NODE_RADIUS).
const NODE_R: Record<string, number> = {
  hub: 32,
  keystone: 18,
  notable: 14,
  small: 8,
}
const COLLISION_PADDING = 8

function relaxCollisions(nodes: LaidNode[]): LaidNode[] {
  if (nodes.length < 2) return nodes
  // Mutate copies, не оригиналы.
  const out = nodes.map((n) => ({ ...n }))
  const PASSES = 3 // 3-х проходов хватает для редкого графа
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]
        const b = out[j]
        // Skip pinned nodes (designer владеет ими).
        if (a.pos_set && b.pos_set) continue
        const ra = NODE_R[a.kind] ?? 12
        const rb = NODE_R[b.kind] ?? 12
        const minDist = ra + rb + COLLISION_PADDING
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy) || 0.001
        if (dist >= minDist) continue
        const overlap = (minDist - dist) / 2
        const ux = dx / dist
        const uy = dy / dist
        // Толкаем оба наполовину overlap'а — pinned не двигаем.
        if (!a.pos_set) {
          a.x -= ux * overlap
          a.y -= uy * overlap
        }
        if (!b.pos_set) {
          b.x += ux * overlap
          b.y += uy * overlap
        }
        moved = true
      }
    }
    if (!moved) break
  }
  return out
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
