package ports

import (
	"io"
	"net/http"
	"strings"

	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
)

// attachAdminForTest is the test-only helper used by models_test.go to
// inject the auth context values the router middleware would normally
// populate (user id + role=admin). Kept in ports/ so unexported ctx
// helpers stay off the public API surface.
func attachAdminForTest(r *http.Request, uid uuid.UUID) *http.Request {
	ctx := sharedMw.WithUserID(r.Context(), uid)
	ctx = sharedMw.WithUserRole(ctx, string(enums.UserRoleAdmin))
	return r.WithContext(ctx)
}

// strPayload wraps a string literal as an io.Reader — avoids importing
// bytes.NewBufferString() on every httptest.NewRequest call.
func strPayload(s string) io.Reader { return strings.NewReader(s) }
