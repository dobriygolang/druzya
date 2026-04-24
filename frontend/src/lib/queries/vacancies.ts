// Queries for the vacancies bounded context.
//
// Backend module: backend/services/vacancies/. Endpoints land under
// /api/v1/vacancies/*.
//
// Phase 3: the parsed catalogue is an in-memory cache (no DB id). Identity
// is the composite (source, external_id). Routes use that pair; the kanban
// row still has a numeric id (saved_vacancies.id) for status updates.

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query'
import { api } from '../apiClient'

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

// VacancySource keeps the full 12-entry union because the backend domain
// retains all source codes (used by URL-detection in the analyze use case).
// Only the 5 listed in VACANCY_SOURCES are actually scraped.
export type VacancySource =
  | 'yandex'
  | 'ozon'
  | 'ozontech'
  | 'tinkoff'
  | 'vk'
  | 'sber'
  | 'avito'
  | 'wildberries'
  | 'mts'
  | 'kaspersky'
  | 'jetbrains'
  | 'lamoda'

// VACANCY_SOURCES is consumed by the filter sidebar — only the 5 sources
// with verified parsers belong here.
export const VACANCY_SOURCES: VacancySource[] = [
  'yandex',
  'ozon',
  'vk',
  'mts',
  'wildberries',
]

export type VacancyCategory =
  | 'backend'
  | 'frontend'
  | 'mobile'
  | 'data'
  | 'devops'
  | 'qa'
  | 'analytics'
  | 'product'
  | 'design'
  | 'management'
  | 'other'

// CATEGORY_LABEL keeps the Russian names the sidebar renders.
export const CATEGORY_LABEL: Record<VacancyCategory, string> = {
  backend: 'Бэкенд',
  frontend: 'Фронтенд',
  mobile: 'Мобильная разработка',
  data: 'Данные',
  devops: 'DevOps',
  qa: 'QA',
  analytics: 'Аналитика',
  product: 'Продакт',
  design: 'Дизайн',
  management: 'Менеджмент',
  other: 'Прочее',
}

// VACANCY_CATEGORIES preserves the canonical iteration order (matches the
// backend's domain.AllCategories so facet rows align 1:1).
export const VACANCY_CATEGORIES: VacancyCategory[] = [
  'backend',
  'frontend',
  'mobile',
  'data',
  'devops',
  'qa',
  'analytics',
  'product',
  'design',
  'management',
  'other',
]

export type SavedStatus =
  | 'saved'
  | 'applied'
  | 'interviewing'
  | 'rejected'
  | 'offer'

export const SAVED_STATUSES: SavedStatus[] = [
  'saved',
  'applied',
  'interviewing',
  'rejected',
  'offer',
]

export type Vacancy = {
  source: VacancySource
  external_id: string
  url: string
  title: string
  company?: string
  location?: string
  employment_type?: string
  experience_level?: string
  salary_min?: number
  salary_max?: number
  currency?: string
  description: string
  raw_skills: string[]
  normalized_skills: string[]
  category: VacancyCategory
  posted_at?: string
  fetched_at: string
}

// VacancyDetails is the wire shape returned by GET /vacancies/{src}/{ext_id}
// after Phase 4. It is a strict superset of Vacancy — every Vacancy field is
// preserved verbatim; the new optional fields carry the rich detail-page
// blocks (description HTML, bullet lists, source-specific extras).
//
// SourceOnly=true means the source has no public detail endpoint (currently
// only Ozon — host blocked / no JSON API discoverable). Frontend renders a
// CTA banner pointing at vacancy.url instead of empty rich sections.
export type VacancyDetails = Vacancy & {
  description_html?: string
  requirements?: string[]
  duties?: string[]
  conditions?: string[]
  our_team?: string
  tech_stack?: string[]
  source_only?: boolean
  details_fetched_at: string
}

export type SavedVacancy = {
  id: number
  source: VacancySource
  external_id: string
  status: SavedStatus
  notes?: string
  saved_at: string
  updated_at: string
  vacancy: Vacancy
}

export type SkillGap = {
  required: string[]
  matched: string[]
  missing: string[]
  extra: string[]
}

export type AnalyzeResponse = {
  vacancy: Vacancy
  gap: SkillGap
}

export type ListResponse = {
  items: Vacancy[]
  total: number
  limit: number
  offset: number
}

export type ListFilter = {
  sources?: VacancySource[]
  companies?: string[]
  categories?: VacancyCategory[]
  skills?: string[]
  salary_min?: number
  location?: string
  page?: number
  limit?: number
}

export type FacetEntry = { name: string; count: number }

export type FacetsResponse = {
  companies: FacetEntry[]
  categories: FacetEntry[]
  sources: FacetEntry[]
  locations: FacetEntry[]
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function buildListQuery(f: ListFilter): string {
  const sp = new URLSearchParams()
  if (f.sources?.length) sp.set('source', f.sources.join(','))
  if (f.categories?.length) sp.set('category', f.categories.join(','))
  if (f.companies?.length) sp.set('company', f.companies.join(','))
  if (f.skills?.length) sp.set('skills', f.skills.join(','))
  if (f.salary_min) sp.set('salary_min', String(f.salary_min))
  if (f.location) sp.set('location', f.location)
  if (f.page) sp.set('page', String(f.page))
  if (f.limit) sp.set('limit', String(f.limit))
  const q = sp.toString()
  return q ? `?${q}` : ''
}

// ─────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────

export function useVacanciesList(filter: ListFilter) {
  return useQuery({
    queryKey: ['vacancies', 'list', filter],
    queryFn: () => api<ListResponse>(`/vacancies${buildListQuery(filter)}`),
    placeholderData: keepPreviousData,
  })
}

export function useFacetsQuery() {
  return useQuery({
    queryKey: ['vacancies', 'facets'],
    queryFn: () => api<FacetsResponse>(`/vacancies/facets`),
  })
}

export function useVacancy(source: VacancySource | undefined, externalId: string | undefined) {
  return useQuery({
    queryKey: ['vacancies', 'one', source, externalId],
    queryFn: () => api<VacancyDetails>(`/vacancies/${source}/${externalId}`),
    enabled: !!source && !!externalId,
  })
}

export function useSavedVacancies() {
  return useQuery({
    queryKey: ['vacancies', 'saved'],
    queryFn: () => api<{ items: SavedVacancy[] }>(`/vacancies/saved`),
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────

export function useAnalyzeVacancy() {
  return useMutation({
    mutationFn: (input: { url: string; user_skills?: string[] }) =>
      api<AnalyzeResponse>(`/vacancies/analyze`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  })
}

export function useSaveVacancy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      source: VacancySource
      externalId: string
      notes?: string
    }) =>
      api<SavedVacancy>(`/vacancies/${input.source}/${input.externalId}/save`, {
        method: 'POST',
        body: JSON.stringify({ notes: input.notes ?? '' }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vacancies', 'saved'] })
    },
  })
}

export function useUpdateSavedStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      savedId: number
      status: SavedStatus
      notes?: string
    }) =>
      api<SavedVacancy>(`/vacancies/saved/${input.savedId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: input.status, notes: input.notes ?? '' }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vacancies', 'saved'] })
    },
  })
}

export function useDeleteSaved() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (savedId: number) =>
      api<void>(`/vacancies/saved/${savedId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vacancies', 'saved'] })
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Derived helpers (used by VacancyCard skill diff visualisation)
// ─────────────────────────────────────────────────────────────────────────

export function diffSkills(required: string[], userSkills: string[]): {
  matched: Set<string>
  missing: Set<string>
} {
  const lower = (xs: string[]) => new Set(xs.map((s) => s.toLowerCase()))
  const u = lower(userSkills)
  const matched = new Set<string>()
  const missing = new Set<string>()
  for (const s of required) {
    const k = s.toLowerCase()
    if (u.has(k)) matched.add(k)
    else missing.add(k)
  }
  return { matched, missing }
}
