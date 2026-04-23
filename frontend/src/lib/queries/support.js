// Support ticket — POST /api/v1/support/ticket.
// Public endpoint (см. backend/cmd/monolith/bootstrap/router.go). Если юзер
// залогинен, бэк подхватит его user_id из bearer-токена через middleware.
import { useMutation } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useCreateSupportTicket() {
    return useMutation({
        mutationFn: (input) => api('/support/ticket', {
            method: 'POST',
            body: JSON.stringify(input),
        }),
    });
}
