import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

// STUB: switch to Connect-ES client from src/api/generated/pb/druz9/v1/slot_connect.ts
// once `createPromiseClient(SlotService, transport)` migration lands.

export type SlotMentor = {
  user_id: string
  username: string
  title: string
  elo: number
}

export type Slot = {
  id: string
  mentor: SlotMentor
  section: 'algorithms' | 'sql' | 'go' | 'system_design' | 'behavioral'
  starts_at: string
  duration_min: number
  price_ai_credits: number
  format: 'video_call' | 'voice_only'
  spots_left: number
}

export type SlotBooking = {
  slot_id: string
  booking_id: string
  meet_url: string
}

export type SlotListResponse = {
  slots: Slot[]
  bookings: SlotBooking[]
}

export function useSlotsQuery() {
  return useQuery({
    queryKey: ['slots'],
    queryFn: () => api<SlotListResponse>('/slots'),
  })
}

export function useBookSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slotId: string) =>
      api<SlotBooking>(`/slots/${slotId}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['slots'] })
    },
  })
}
