// Support ticket — POST /api/v1/support/ticket.
// Public endpoint (см. backend/cmd/monolith/bootstrap/router.go). Если юзер
// залогинен, бэк подхватит его user_id из bearer-токена через middleware.

import { useMutation } from '@tanstack/react-query'
import { api } from '../apiClient'

// schema_v2 dropped email-auth and the support_tickets check constraint is
// now `CHECK IN ('telegram')`. The type stays a single-element union so it
// keeps a shape-stable name across the codebase.
export type SupportContactKind = 'telegram'

export interface CreateSupportTicketInput {
  contact_kind: SupportContactKind
  contact_value: string
  subject?: string
  message: string
}

export interface CreateSupportTicketResponse {
  ticket_id: string
  created_at: string
}

export function useCreateSupportTicket() {
  return useMutation({
    mutationFn: (input: CreateSupportTicketInput) =>
      api<CreateSupportTicketResponse>('/support/ticket', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  })
}
