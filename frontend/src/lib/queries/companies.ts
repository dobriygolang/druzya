// Companies queries — read-only listing used by the /calendar EditDateModal
// company picker.
//
// Wire endpoint is GET /api/v1/companies — a chi-direct handler in
// cmd/monolith/services/admin.go that wraps admin.CompanyRepo.List without
// the role=admin gate. The shape is minimal on purpose (id/slug/name): the
// picker only needs a UUID + label.

import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type CompanyOption = {
  id: string
  slug: string
  name: string
}

type CompaniesWire = { items: CompanyOption[] }

// useCompaniesQuery — GET /api/v1/companies. Returns every company known to
// the system (ordered by name on the backend). Cached for 5 минут — список
// меняется редко (curator-only writes).
export function useCompaniesQuery() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const wire = await api<CompaniesWire>('/companies')
      return wire.items ?? []
    },
    staleTime: 5 * 60_000,
  })
}
