// Queries for the vacancies bounded context.
//
// Backend module: backend/services/vacancies/. The endpoints land under
// /api/v1/vacancies/*. Public reads (analyze, list, get) work without bearer;
// mutating endpoints (save / update status / delete) require auth.

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

export type VacancySource =
  | 'hh'
  | 'yandex'
  | 'ozon'
  | 'tinkoff'
  | 'vk'
  | 'sber'
  | 'avito'
  | 'wildberries'
  | 'mts'
  | 'kaspersky'
  | 'jetbrains'
  | 'lamoda'

export const VACANCY_SOURCES: VacancySource[] = [
  'hh',
  'yandex',
  'ozon',
  'tinkoff',
  'vk',
  'sber',
  'avito',
  'wildberries',
  'mts',
  'kaspersky',
  'jetbrains',
  'lamoda',
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
  id: number
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
  posted_at?: string
  fetched_at: string
}

export type SavedVacancy = {
  id: number
  vacancy_id: number
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
  skills?: string[]
  salary_min?: number
  location?: string
  page?: number
  limit?: number
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function buildListQuery(f: ListFilter): string {
  const sp = new URLSearchParams()
  if (f.sources?.length) sp.set('source', f.sources.join(','))
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

export function useVacancy(id: number | undefined) {
  return useQuery({
    queryKey: ['vacancies', 'one', id],
    queryFn: () => api<Vacancy>(`/vacancies/${id}`),
    enabled: typeof id === 'number' && id > 0,
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
    mutationFn: (input: { vacancyId: number; notes?: string }) =>
      api<SavedVacancy>(`/vacancies/${input.vacancyId}/save`, {
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
