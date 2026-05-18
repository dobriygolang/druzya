// auth_helpers.go — request-level admin-role gate used by admin handlers
// across multiple domains (admin, arena/admin_arena_tasks, etc).
//
// Sits in services/auth (not services/admin) because (a) it's an auth
// concern not an admin one, and (b) putting it under services/admin would
// force every domain that has an admin endpoint to back-import admin just
// for these helpers.
package auth

import (
	"errors"
	"fmt"
	"net/http"

	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
)

// RequireAdminInline pulls the user from request context and rejects
// non-admin roles. Returns sentinel errors ("unauthenticated" / "forbidden")
// that StatusForAuthErr maps to HTTP codes.
func RequireAdminInline(r *http.Request) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		return uuid.Nil, errors.New("unauthenticated")
	}
	role, _ := sharedMw.UserRoleFromContext(r.Context())
	if role != "admin" {
		return uuid.Nil, errors.New("forbidden")
	}
	return uid, nil
}

// StatusForAuthErr maps the sentinel strings RequireAdminInline returns
// onto HTTP status codes. Anything else → 500.
func StatusForAuthErr(err error) int {
	if err == nil {
		return http.StatusOK
	}
	switch err.Error() {
	case "unauthenticated":
		return http.StatusUnauthorized
	case "forbidden":
		return http.StatusForbidden
	}
	return http.StatusInternalServerError
}

// AdminGateHandler wraps next so only authenticated admin users can reach
// it. The auth context is populated by the bearer middleware above; this
// handler only checks role. On failure it emits a JSON error body shaped
// like the rest of the admin surface (`{"error":"..."}`). Used by every
// admin REST mount that wraps a vanguard transcoder.
func AdminGateHandler(next http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := RequireAdminInline(r); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(StatusForAuthErr(err))
			_, _ = fmt.Fprintf(w, `{"error":"%s"}`, err.Error())
			return
		}
		next.ServeHTTP(w, r)
	}
}
