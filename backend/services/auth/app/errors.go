package app

import (
	"errors"
	"fmt"

	"druz9/auth/domain"
)

// RateLimitedError lets the HTTP layer produce a 429 with retry_after seconds.
type RateLimitedError struct {
	RetryAfterSec int
}

func (e *RateLimitedError) Error() string {
	return fmt.Sprintf("auth: rate limited, retry after %ds", e.RetryAfterSec)
}

// Is enables errors.Is matching with domain.ErrRateLimited.
func (e *RateLimitedError) Is(target error) bool {
	return errors.Is(target, domain.ErrRateLimited)
}

func isRateLimited(err error) bool { return errors.Is(err, domain.ErrRateLimited) }

func rateLimitedErr(retry int) error { return &RateLimitedError{RetryAfterSec: retry} }

// ErrInvalidState возвращается, когда OAuth-callback приносит `state`, которого
// нет в store (истёк, уже использовался или подделан). Маппится в 400 на HTTP
// уровне — это и есть анти-CSRF гарантия для OAuth-flow.
var ErrInvalidState = errors.New("auth: invalid oauth state")
