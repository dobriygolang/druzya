// list_users.go — admin user-management read use case.
package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// ListUsers implements GET /api/v1/admin/users.
type ListUsers struct {
	Users domain.UserRepo
}

// Do returns a paginated user listing with active-ban metadata.
func (uc *ListUsers) Do(ctx context.Context, f domain.UserListFilter) (domain.UserPage, error) {
	page, err := uc.Users.List(ctx, f)
	if err != nil {
		return domain.UserPage{}, fmt.Errorf("admin.ListUsers: %w", err)
	}
	return page, nil
}
