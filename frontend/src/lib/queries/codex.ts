// queries/codex.ts — раньше здесь жил `usePodcastCatalogQuery` для /codex.
//
// /codex переехал на статический контент (см. src/content/codex.ts), поэтому
// runtime-запросы со страницы убраны. Этот файл сохранён по двум причинам:
//
//   1) MSW-handlers и другие потребители ссылались на типы PodcastEpisode /
//      PodcastCatalog — оставляем их как backward-compat shim, чтобы не
//      лопнул контракт mock-сервера.
//   2) Когда (если) заведём собственный CMS для /codex, можно будет вернуть
//      хук под тем же именем.
//
// Текущая реализация не используется страницей CodexPage; для проверки
// типов нужно, чтобы файл компилировался, поэтому оставлен реэкспорт.

import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type PodcastEpisode = {
  id: string
  title: string
  section: string
  duration_min: number
  published_at: string
  description: string
  cover: string | null
  listened: boolean
}

export type PodcastCatalog = {
  episodes: PodcastEpisode[]
  sections: { key: string; title: string; count: number }[]
}

// usePodcastCatalogQuery — оставлен как опциональный fetch для возможного
// будущего «Слушать» секции внутри /codex. Сейчас CodexPage его не зовёт.
export function usePodcastCatalogQuery() {
  return useQuery({
    queryKey: ['podcast', 'catalog'],
    queryFn: () => api<PodcastCatalog>('/podcast'),
    enabled: false, // отключено по умолчанию — страница использует static
  })
}
