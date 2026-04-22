import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type HelpCategory = {
  id: string
  label: string
  count: number
  kind: string
}

export type FAQItem = {
  id: string
  question: string
  answer: string
  tags: string[]
}

export type HelpContact = {
  kind: string
  label: string
  value: string
}

export type HelpResponse = {
  total_articles: number
  categories: HelpCategory[]
  faq: FAQItem[]
  contacts: HelpContact[]
  status: string
}

export function useHelpQuery() {
  return useQuery({
    queryKey: ['help'],
    queryFn: () => api<HelpResponse>('/help'),
  })
}
