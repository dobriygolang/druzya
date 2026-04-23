// Slot queries — wrapper over the SlotService Connect-RPC contract
// (proto/druz9/v1/slot.proto). Vanguard transcodes the gRPC handlers to four
// REST endpoints under /api/v1/slot.
//
// Wire shape mirrors druz9v1.Slot 1:1 — keep snake_case so we decode the JSON
// the transcoder emits without an extra mapper.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type SlotInterviewer = {
  user_id: string
  username: string
  avg_rating?: number
  reviews_count?: number
}

export type SlotSection = 'algorithms' | 'sql' | 'go' | 'system_design' | 'behavioral'
export type SlotDifficulty = 'easy' | 'medium' | 'hard'
export type SlotStatusValue = 'available' | 'booked' | 'completed' | 'cancelled' | 'no_show'

export type Slot = {
  id: string
  interviewer: SlotInterviewer
  starts_at: string
  duration_min: number
  section: SlotSection
  difficulty?: SlotDifficulty
  language: string
  price_rub: number
  status: SlotStatusValue
}

export type Booking = {
  id: string
  slot: Slot
  meet_url: string
  created_at: string
}

export type SlotFilter = {
  section?: SlotSection
  difficulty?: SlotDifficulty
  from?: string
  to?: string
  // priceMax is a client-only filter — the backend ListSlots RPC does not yet
  // accept a price predicate, so we apply it after the fetch (see useSlotsQuery).
  priceMax?: number
}

// vanguard returns the SlotList wrapper as a top-level array on the REST wire.
type SlotListWire = Slot[] | { items: Slot[] }

function buildQS(f: SlotFilter): string {
  const params: string[] = []
  if (f.section) params.push(`section=${encodeURIComponent(f.section.toUpperCase())}`)
  if (f.difficulty) params.push(`difficulty=${encodeURIComponent(f.difficulty.toUpperCase())}`)
  if (f.from) params.push(`from=${encodeURIComponent(f.from)}`)
  if (f.to) params.push(`to=${encodeURIComponent(f.to)}`)
  return params.length === 0 ? '' : `?${params.join('&')}`
}

function unwrap(wire: SlotListWire): Slot[] {
  if (Array.isArray(wire)) return wire
  return wire.items ?? []
}

// useSlotsQuery hits GET /api/v1/slot with the given filter. priceMax is
// applied client-side because the proto contract does not yet expose a
// price_max predicate (see slot.proto:ListSlotsRequest).
export function useSlotsQuery(filter: SlotFilter = {}) {
  const qs = buildQS(filter)
  return useQuery({
    queryKey: ['slots', filter],
    queryFn: async () => {
      const wire = await api<SlotListWire>(`/slot${qs}`)
      const all = unwrap(wire)
      if (typeof filter.priceMax === 'number') {
        return all.filter((s) => s.price_rub <= filter.priceMax!)
      }
      return all
    },
  })
}

// useBookSlot wraps POST /api/v1/slot/{slot_id}/book.
export function useBookSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slotId: string) =>
      api<Booking>(`/slot/${slotId}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['slots'] })
    },
  })
}

// useCancelSlot wraps DELETE /api/v1/slot/{slot_id}/cancel.
export function useCancelSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slotId: string) =>
      api<void>(`/slot/${slotId}/cancel`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['slots'] })
    },
  })
}

// MyBookingItem mirrors the chi-direct DTO shape returned by
// GET /api/v1/slot/my/bookings (defined in cmd/monolith/services/slot.go).
// Snake_case kept 1:1 with the wire so we don't need an extra mapper.
export type MyBookingItem = {
  id: string
  slot_id: string
  meet_url?: string
  status: string
  created_at: string
  starts_at: string
  duration_min: number
  section: SlotSection
  difficulty?: SlotDifficulty
  language: string
  price_rub: number
  slot_status: SlotStatusValue
}

type MyBookingsWire = { items: MyBookingItem[] }

// useMyBookingsQuery — GET /api/v1/slot/my/bookings. Возвращает все
// букинги текущего пользователя (отсортированы по starts_at DESC). 200 OK
// с пустым items[] — норма для пользователя без записей.
export function useMyBookingsQuery() {
  return useQuery({
    queryKey: ['slots', 'my-bookings'],
    queryFn: async () => {
      const wire = await api<MyBookingsWire>('/slot/my/bookings')
      return wire.items ?? []
    },
    staleTime: 30_000,
  })
}

// derivePriceBuckets returns ordered price-cap suggestions from the available
// slots — this replaces the "до 2000₽" hardcoded filter chip on /slots. We
// pick a few quantile-ish breakpoints so the chips stay useful even when
// price distribution shifts across seasons.
//
// All cap values are rounded UP to the nearest 500, so the chip always
// includes the slot it was derived from (e.g. a 1234₽ slot yields a 1500₽
// cap chip). The output is deduplicated and ≤3 entries.
export function derivePriceBuckets(slots: Slot[]): number[] {
  if (slots.length === 0) return []
  const prices = slots.map((s) => s.price_rub).filter((p) => p > 0).sort((a, b) => a - b)
  if (prices.length === 0) return []
  const buckets = new Set<number>()
  // 33%, 66%, 100% — round each up to the nearest 500.
  for (const q of [0.33, 0.66, 1]) {
    const idx = Math.min(prices.length - 1, Math.floor(prices.length * q))
    const v = prices[idx]
    buckets.add(Math.ceil(v / 500) * 500)
  }
  // Keep ≤3 ascending unique cap values. Caps may exceed individual prices
  // by ≤500₽ (the rounding tail) — that's fine, the user just gets a
  // friendlier label than "до 1234₽".
  return Array.from(buckets).sort((a, b) => a - b).slice(0, 3)
}
