// codex.ts — react-query hooks for the /codex catalogue (now DB-backed).
//
// Public read (`/codex/articles`) — анонимно-доступен, фронт читает
// без bearer'а. Admin CRUD — только за role=admin.
//
// Категории остаются захардкожены на фронте (иконки + цвета — это
// presentation, а не data). Тут только статьи.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type CodexArticle = {
  id: string
  slug: string
  title: string
  description: string
  category: string
  href: string
  source: string
  read_min: number
  sort_order: number
  active: boolean
}

export type CodexArticleUpsertBody = {
  slug: string
  title: string
  description: string
  category: string
  href: string
  source: string
  read_min: number
  sort_order: number
  active?: boolean | null
}

export type CodexCategory = {
  slug: string
  label: string
  description: string
  sort_order: number
  active: boolean
}

export type CodexCategoryUpsertBody = Omit<CodexCategory, never>

const STALE_MS = 5 * 60_000

export const codexKeys = {
  publicList: () => ['codex', 'public'] as const,
  adminList: () => ['codex', 'admin'] as const,
  categoriesPublic: () => ['codex', 'categories', 'public'] as const,
  categoriesAdmin: () => ['codex', 'categories', 'admin'] as const,
}

export function useCodexArticlesQuery() {
  return useQuery({
    queryKey: codexKeys.publicList(),
    queryFn: async () => {
      const r = await api<{ items: CodexArticle[] }>('/codex/articles')
      return r.items ?? []
    },
    staleTime: STALE_MS,
  })
}

export function useAdminCodexQuery() {
  return useQuery({
    queryKey: codexKeys.adminList(),
    queryFn: async () => {
      const r = await api<{ items: CodexArticle[] }>('/admin/codex/articles')
      return r.items ?? []
    },
    staleTime: 30_000,
  })
}

export function useCreateCodexArticleMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CodexArticleUpsertBody) =>
      api<CodexArticle>('/admin/codex/articles', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['codex'] })
    },
  })
}

export function useUpdateCodexArticleMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CodexArticleUpsertBody }) =>
      api<CodexArticle>(`/admin/codex/articles/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['codex'] })
    },
  })
}

export function useToggleCodexActiveMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api<{ ok: boolean }>(`/admin/codex/articles/${encodeURIComponent(id)}/active`, {
        method: 'POST',
        body: JSON.stringify({ active }),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['codex'] })
    },
  })
}

export function useDeleteCodexArticleMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/admin/codex/articles/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['codex'] })
    },
  })
}

// ── Categories ───────────────────────────────────────────────────────

export function useCodexCategoriesQuery() {
  return useQuery({
    queryKey: codexKeys.categoriesPublic(),
    queryFn: async () => {
      const r = await api<{ items: CodexCategory[] }>('/codex/categories')
      return r.items ?? []
    },
    staleTime: STALE_MS,
  })
}

export function useAdminCodexCategoriesQuery() {
  return useQuery({
    queryKey: codexKeys.categoriesAdmin(),
    queryFn: async () => {
      const r = await api<{ items: CodexCategory[] }>('/admin/codex/categories')
      return r.items ?? []
    },
    staleTime: 30_000,
  })
}

export function useCreateCodexCategoryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CodexCategoryUpsertBody) =>
      api<CodexCategory>('/admin/codex/categories', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['codex', 'categories'] })
    },
  })
}

export function useUpdateCodexCategoryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: CodexCategoryUpsertBody }) =>
      api<CodexCategory>(`/admin/codex/categories/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['codex', 'categories'] })
    },
  })
}

export function useDeleteCodexCategoryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) =>
      api<void>(`/admin/codex/categories/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['codex', 'categories'] })
    },
  })
}

// ── Coach signal ─────────────────────────────────────────────────────

// Best-effort fire-and-forget: opens the external article + pings the
// backend so a `codex_article_opened` episode lands in Coach memory.
export function pingCodexArticleOpened(id: string): void {
  void api(`/codex/articles/${encodeURIComponent(id)}/open`, {
    method: 'POST',
  }).catch(() => {})
}
