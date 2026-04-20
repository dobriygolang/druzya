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

export function usePodcastCatalogQuery() {
  return useQuery({
    queryKey: ['podcast', 'catalog'],
    queryFn: () => api<PodcastCatalog>('/podcast'),
  })
}
