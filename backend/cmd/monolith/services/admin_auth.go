package services

import (
	"errors"
	"net/http"

	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
)

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
