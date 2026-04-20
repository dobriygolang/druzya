package ports

import (
	"net/http"
	"strings"

	"druz9/auth/app"
	"druz9/shared/pkg/httperr"
	sharedMw "druz9/shared/pkg/middleware"
)

// RequireAuth returns chi-compatible middleware that validates the JWT
// Authorization header and injects the user id/role into the request context.
// Other services import this from `druz9/auth/ports` — it is the one cross-
// domain symbol we intentionally export.
func RequireAuth(issuer *app.TokenIssuer) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := extractBearer(r)
			if raw == "" {
				httperr.Write(w, httperr.Unauthorized())
				return
			}
			claims, err := issuer.Parse(raw)
			if err != nil {
				httperr.Write(w, httperr.Unauthorized())
				return
			}
			ctx := sharedMw.WithUserID(r.Context(), claims.UserID)
			ctx = sharedMw.WithUserRole(ctx, claims.Role.String())
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func extractBearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(h, prefix) {
		return ""
	}
	return strings.TrimSpace(h[len(prefix):])
}
