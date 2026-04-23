// queries/atlas.ts — namespace-aliased re-export атласа.
//
// Сам хук живёт в queries/profile.ts (`useAtlasQuery`), потому что
// /api/v1/profile/me/atlas — это ручка ProfileService. Этот файл существует
// для:
//   1) симметрии с другими модулями страниц (queries/calendar.ts,
//      queries/codex.ts), чтобы AtlasPage импортировался из единого
//      места;
//   2) места, куда можно дописать atlas-specific селекторы / утилиты,
//      когда они появятся (например, селектор «next unlockable node»).
//
// НЕ дублируем хук — только реэкспорт.

export {
  useAtlasQuery,
  type Atlas,
  type AtlasNode,
  type AtlasEdge,
} from './profile'

import type { Atlas, AtlasNode } from './profile'

// countUnlocked / countTotal — мелкие селекторы для шапки страницы.
// Вынесены сюда, чтобы AtlasPage не пересчитывал на каждом рендере и
// чтобы тестировались независимо.
export function countUnlocked(atlas: Atlas | undefined): number {
  if (!atlas) return 0
  let n = 0
  for (const node of atlas.nodes) if (node.unlocked) n += 1
  return n
}

export function countTotal(atlas: Atlas | undefined): number {
  return atlas?.nodes.length ?? 0
}

// nodesBySection — вспомогательный группировщик. Бэк не отдаёт готовые
// группы, но в UI часто нужно показать «по 3 узла в каждой секции».
export function nodesBySection(atlas: Atlas | undefined): Record<string, AtlasNode[]> {
  const out: Record<string, AtlasNode[]> = {}
  if (!atlas) return out
  for (const node of atlas.nodes) {
    const k = node.section || 'unknown'
    if (!out[k]) out[k] = []
    out[k].push(node)
  }
  return out
}
