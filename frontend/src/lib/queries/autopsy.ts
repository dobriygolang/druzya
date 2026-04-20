import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

// STUB: switch to Connect-ES client from src/api/generated/pb/druz9/v1/daily_connect.ts
// DailyService.CreateAutopsy once migration lands.

export type InterviewAutopsyInput = {
  company: string
  role: string
  sections: Array<'algorithms' | 'sql' | 'go' | 'system_design' | 'behavioral'>
  outcome: 'passed' | 'rejected' | 'pending' | 'no_show'
  what_went_wrong: string
  retro_decay_nodes: string[]
}

export type InterviewAutopsy = InterviewAutopsyInput & {
  id: string
  created_at: string
}

export function useCreateAutopsy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InterviewAutopsyInput) =>
      api<InterviewAutopsy>('/daily/autopsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['daily', 'calendar'] })
    },
  })
}
