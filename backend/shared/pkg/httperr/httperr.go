// Package httperr предоставляет единый формат HTTP-ответа об ошибке,
// соответствующий `ErrorResponse` из shared/openapi.yaml.
package httperr

import (
	"encoding/json"
	"errors"
	"net/http"
)

type APIError struct {
	Status  int            `json:"-"`
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

func (e *APIError) Error() string { return e.Code + ": " + e.Message }

func New(status int, code, message string) *APIError {
	return &APIError{Status: status, Code: code, Message: message}
}

func (e *APIError) WithDetails(d map[string]any) *APIError {
	e.Details = d
	return e
}

// Write сериализует ошибку в каноническом JSON-формате.
func Write(w http.ResponseWriter, err error) {
	var ae *APIError
	if !errors.As(err, &ae) {
		ae = New(http.StatusInternalServerError, "internal", "internal error")
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(ae.Status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": ae})
}

// Конструкторы стандартных ошибок.
func Validation(msg string) *APIError { return New(http.StatusBadRequest, "validation_error", msg) }
func Unauthorized() *APIError {
	return New(http.StatusUnauthorized, "unauthorized", "not authenticated")
}
func Forbidden() *APIError           { return New(http.StatusForbidden, "forbidden", "access denied") }
func NotFound(what string) *APIError { return New(http.StatusNotFound, "not_found", what+" not found") }
func RateLimited(retryAfter int) *APIError {
	return New(http.StatusTooManyRequests, "rate_limit", "rate limit exceeded").
		WithDetails(map[string]any{"retry_after_sec": retryAfter})
}
func Internal(msg string) *APIError { return New(http.StatusInternalServerError, "internal", msg) }
