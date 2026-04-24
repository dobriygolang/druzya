// Slot queries — wrapper over the SlotService Connect-RPC contract
// (proto/druz9/v1/slot.proto). Vanguard transcodes the gRPC handlers to four
// REST endpoints under /api/v1/slot.
//
// Wire shape mirrors druz9v1.Slot 1:1 — keep snake_case so we decode the JSON
// the transcoder emits without an extra mapper. Enum fields arrive as the
// canonical proto name (SECTION_ALGORITHMS, SLOT_STATUS_AVAILABLE, …); we
// normalize them down to the short lowercase form the UI works with.

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

export type SlotSort = 'soonest' | 'cheapest' | 'top_rated'

export type SlotFilter = {
  section?: SlotSection
  difficulty?: SlotDifficulty
  from?: string
  to?: string
  // priceMax is a client-only filter — the backend ListSlots RPC does not yet
  // accept a price predicate, so we apply it after the fetch (see useSlotsQuery).
  priceMax?: number
  // sort is also client-side — see comparator in useSlotsQuery.
  sort?: SlotSort
}

// vanguard returns the SlotList wrapper as a top-level array on the REST wire.
type SlotListWire = SlotWire[] | { items: SlotWire[] }

// Wire-level slot — enum fields arrive as proto strings. We normalize on read.
type SlotWire = Omit<Slot, 'section' | 'difficulty' | 'status'> & {
  section: string
  difficulty?: string
  status: string
}

const SECTION_PROTO: Record<SlotSection, string> = {
  algorithms: 'SECTION_ALGORITHMS',
  sql: 'SECTION_SQL',
  go: 'SECTION_GO',
  system_design: 'SECTION_SYSTEM_DESIGN',
  behavioral: 'SECTION_BEHAVIORAL',
}

const DIFFICULTY_PROTO: Record<SlotDifficulty, string> = {
  easy: 'DIFFICULTY_EASY',
  medium: 'DIFFICULTY_MEDIUM',
  hard: 'DIFFICULTY_HARD',
}

// Reverse maps. Both proto-form and short-form keys are accepted so the same
// normalizer copes with the legacy wire shape (rare, but cheap insurance).
const SECTION_FROM_WIRE: Record<string, SlotSection> = {
  SECTION_ALGORITHMS: 'algorithms',
  SECTION_SQL: 'sql',
  SECTION_GO: 'go',
  SECTION_SYSTEM_DESIGN: 'system_design',
  SECTION_BEHAVIORAL: 'behavioral',
  algorithms: 'algorithms',
  sql: 'sql',
  go: 'go',
  system_design: 'system_design',
  behavioral: 'behavioral',
}

const DIFFICULTY_FROM_WIRE: Record<string, SlotDifficulty> = {
  DIFFICULTY_EASY: 'easy',
  DIFFICULTY_MEDIUM: 'medium',
  DIFFICULTY_HARD: 'hard',
  easy: 'easy',
  medium: 'medium',
  hard: 'hard',
}

const STATUS_FROM_WIRE: Record<string, SlotStatusValue> = {
  SLOT_STATUS_AVAILABLE: 'available',
  SLOT_STATUS_BOOKED: 'booked',
  SLOT_STATUS_COMPLETED: 'completed',
  SLOT_STATUS_CANCELLED: 'cancelled',
  SLOT_STATUS_NO_SHOW: 'no_show',
  available: 'available',
  booked: 'booked',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'no_show',
}

export function normalizeSlot(w: SlotWire): Slot {
  const section = SECTION_FROM_WIRE[w.section]
  const status = STATUS_FROM_WIRE[w.status] ?? 'available'
  if (!section) {
    // Unknown enum from a future proto bump — surface a typed value rather
    // than letting the UI render the proto literal.
    throw new Error(`unknown slot section from wire: ${w.section}`)
  }
  const difficulty = w.difficulty ? DIFFICULTY_FROM_WIRE[w.difficulty] : undefined
  return {
    ...w,
    section,
    difficulty,
    status,
  }
}

function buildQS(f: SlotFilter): string {
  const params: string[] = []
  if (f.section) params.push(`section=${encodeURIComponent(SECTION_PROTO[f.section])}`)
  if (f.difficulty) params.push(`difficulty=${encodeURIComponent(DIFFICULTY_PROTO[f.difficulty])}`)
  if (f.from) params.push(`from=${encodeURIComponent(f.from)}`)
  if (f.to) params.push(`to=${encodeURIComponent(f.to)}`)
  // price_max is a server-side predicate as of M2 (slot.proto:ListSlotsRequest).
  if (typeof f.priceMax === 'number' && f.priceMax > 0) {
    params.push(`price_max=${f.priceMax}`)
  }
  return params.length === 0 ? '' : `?${params.join('&')}`
}

function unwrap(wire: SlotListWire): SlotWire[] {
  if (Array.isArray(wire)) return wire
  return wire.items ?? []
}

function sortSlots(slots: Slot[], sort: SlotSort | undefined): Slot[] {
  if (!sort || sort === 'soonest') {
    return [...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  }
  if (sort === 'cheapest') {
    return [...slots].sort((a, b) => a.price_rub - b.price_rub || a.starts_at.localeCompare(b.starts_at))
  }
  // top_rated — interviewers without a rating sink to the bottom.
  return [...slots].sort((a, b) => {
    const ra = a.interviewer.avg_rating ?? -1
    const rb = b.interviewer.avg_rating ?? -1
    return rb - ra || a.starts_at.localeCompare(b.starts_at)
  })
}

// useSlotsQuery hits GET /api/v1/slot with the given filter. priceMax is now
// a server-side predicate (M2). sort stays client-side — there's no useful
// stable ordering on the wire beyond the default starts_at ASC.
export function useSlotsQuery(filter: SlotFilter = {}) {
  // sort is client-only — keep it out of the wire QS so the queryKey still
  // differentiates fetches that actually hit the network.
  const wireFilter: SlotFilter = {
    section: filter.section,
    difficulty: filter.difficulty,
    from: filter.from,
    to: filter.to,
    priceMax: filter.priceMax,
  }
  const qs = buildQS(wireFilter)
  return useQuery({
    queryKey: ['slots', wireFilter],
    queryFn: async () => {
      const wire = await api<SlotListWire>(`/slot${qs}`)
      return unwrap(wire).map(normalizeSlot)
    },
    select: (all) => sortSlots(all, filter.sort),
  })
}

// CreateSlotInput mirrors proto CreateSlotRequest. starts_at is an ISO
// string (the wire-level Timestamp); duration_min/price_rub are positive ints.
export type CreateSlotInput = {
  starts_at: string
  duration_min: number
  section: SlotSection
  difficulty?: SlotDifficulty
  language: string
  price_rub: number
  meet_url?: string
}

// useCreateSlot wraps POST /api/v1/slot. Returns the created Slot.
export function useCreateSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateSlotInput) => {
      const body: Record<string, unknown> = {
        starts_at: input.starts_at,
        duration_min: input.duration_min,
        section: SECTION_PROTO[input.section],
        language: input.language,
        price_rub: input.price_rub,
      }
      if (input.difficulty) body.difficulty = DIFFICULTY_PROTO[input.difficulty]
      if (input.meet_url) body.meet_url = input.meet_url
      const wire = await api<SlotWire>('/slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return normalizeSlot(wire)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['slots'] })
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
  // has_review reflects whether the candidate already left a review for this
  // booking (M3, slot.proto:MyBookingItem.has_review). Drives the «Оставить
  // отзыв» CTA visibility on the drawer.
  has_review?: boolean
}

// Wire shape: section/difficulty/slot_status arrive as enums.Section / proto
// strings depending on whether the chi-direct or RPC path serves the request.
type MyBookingItemWire = Omit<MyBookingItem, 'section' | 'difficulty' | 'slot_status' | 'has_review'> & {
  section: string
  difficulty?: string
  slot_status: string
  has_review?: boolean
}

type MyBookingsWire = { items: MyBookingItemWire[] }

function normalizeMyBooking(w: MyBookingItemWire): MyBookingItem {
  const section = SECTION_FROM_WIRE[w.section]
  if (!section) throw new Error(`unknown booking section from wire: ${w.section}`)
  return {
    ...w,
    section,
    difficulty: w.difficulty ? DIFFICULTY_FROM_WIRE[w.difficulty] : undefined,
    slot_status: STATUS_FROM_WIRE[w.slot_status] ?? 'available',
    has_review: w.has_review ?? false,
  }
}

// HostedBookingItem mirrors slot.proto:HostedBookingItem (the
// interviewer-side projection). candidate_username + has_review come
// hydrated from the server.
export type HostedBookingItem = {
  id: string
  slot_id: string
  candidate_id: string
  candidate_username: string
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
  has_review?: boolean
}

type HostedBookingItemWire = Omit<HostedBookingItem, 'section' | 'difficulty' | 'slot_status' | 'has_review'> & {
  section: string
  difficulty?: string
  slot_status: string
  has_review?: boolean
}

function normalizeHostedBooking(w: HostedBookingItemWire): HostedBookingItem {
  const section = SECTION_FROM_WIRE[w.section]
  if (!section) throw new Error(`unknown hosted-booking section: ${w.section}`)
  return {
    ...w,
    section,
    difficulty: w.difficulty ? DIFFICULTY_FROM_WIRE[w.difficulty] : undefined,
    slot_status: STATUS_FROM_WIRE[w.slot_status] ?? 'available',
    has_review: w.has_review ?? false,
  }
}

// useHostedBookingsQuery — GET /api/v1/slot/my/hosted (interviewer's
// hosted sessions). Lazy: only fires when enabled.
export function useHostedBookingsQuery(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['slots', 'my-hosted'],
    queryFn: async () => {
      const wire = await api<{ items: HostedBookingItemWire[] }>('/slot/my/hosted')
      return (wire.items ?? []).map(normalizeHostedBooking)
    },
    staleTime: 30_000,
    enabled: opts.enabled ?? true,
  })
}

// useMyBookingsQuery — GET /api/v1/slot/my/bookings. Возвращает все
// букинги текущего пользователя (отсортированы по starts_at DESC). 200 OK
// с пустым items[] — норма для пользователя без записей.
export function useMyBookingsQuery(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['slots', 'my-bookings'],
    queryFn: async () => {
      const wire = await api<MyBookingsWire>('/slot/my/bookings')
      return (wire.items ?? []).map(normalizeMyBooking)
    },
    staleTime: 30_000,
    enabled: opts.enabled ?? true,
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
