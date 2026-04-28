// run_code.go — one-shot code execution against a Judge0 sandbox.
//
// The editor domain is "stateless run": nothing is persisted here. The
// use case enforces:
//
//  1. Participant-or-owner authorisation (same gate as GetRoom — the
//     transport layer already hydrates a user id from the JWT).
//  2. In-memory token-bucket rate limiting, 10 runs per user per minute.
//     This is intentionally modest; heavy abuse maps to ErrRateLimited
//     → Connect ResourceExhausted (HTTP 429).
//  3. Missing/unsupported language or unreachable Judge0 both surface
//     domain.ErrSandboxUnavailable so the port returns 503.
package app

import (
	"context"
	"fmt"
	"sync"
	"time"

	"druz9/editor/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// RunCodeInput is the validated payload for a RunCode call.
type RunCodeInput struct {
	RoomID   uuid.UUID
	CallerID uuid.UUID
	Code     string
	Language enums.Language
}

// RunCode wires the use case.
type RunCode struct {
	Rooms        domain.RoomRepo
	Participants domain.ParticipantRepo
	Runner       domain.CodeRunner
	Limiter      domain.RunCodeRateLimiter
	Now          func() time.Time
}

// allowedRunLanguages enumerates exactly the languages the sandbox accepts.
// Anything outside this set is rejected with ErrLanguageUnsupported BEFORE
// hitting the rate limiter or Judge0 — keeps the abuse surface small.
var allowedRunLanguages = map[enums.Language]struct{}{
	enums.LanguageGo:         {},
	enums.LanguagePython:     {},
	enums.LanguageJavaScript: {},
	enums.LanguageTypeScript: {},
}

// Do executes the RunCode workflow.
func (uc *RunCode) Do(ctx context.Context, in RunCodeInput) (domain.RunResult, error) {
	if uc.Runner == nil {
		return domain.RunResult{}, fmt.Errorf("editor.RunCode: %w: runner not configured", domain.ErrSandboxUnavailable)
	}
	if in.CallerID == uuid.Nil {
		return domain.RunResult{}, fmt.Errorf("editor.RunCode: %w", domain.ErrForbidden)
	}
	// Confirm the caller belongs to the room. We re-use the participant repo
	// directly rather than GetRoom so the use case stays minimal.
	room, err := uc.Rooms.Get(ctx, in.RoomID)
	if err != nil {
		return domain.RunResult{}, fmt.Errorf("editor.RunCode: %w", err)
	}
	if room.OwnerID != in.CallerID {
		ps, perr := uc.Participants.List(ctx, in.RoomID)
		if perr != nil {
			return domain.RunResult{}, fmt.Errorf("editor.RunCode: participants: %w", perr)
		}
		allowed := false
		for _, p := range ps {
			if p.UserID == in.CallerID {
				allowed = true
				break
			}
		}
		if !allowed {
			return domain.RunResult{}, fmt.Errorf("editor.RunCode: %w", domain.ErrForbidden)
		}
	}

	// Language defaults to the room's language if caller left it blank.
	lang := in.Language
	if lang == "" {
		lang = room.Language
	}
	if _, ok := allowedRunLanguages[lang]; !ok {
		return domain.RunResult{}, fmt.Errorf("editor.RunCode: %w: language %q not allowed", domain.ErrLanguageUnsupported, lang)
	}

	if uc.Limiter != nil {
		ok, _, lerr := uc.Limiter.Allow(ctx, in.CallerID)
		if lerr != nil {
			return domain.RunResult{}, fmt.Errorf("editor.RunCode: limiter: %w", lerr)
		}
		if !ok {
			return domain.RunResult{}, fmt.Errorf("editor.RunCode: %w", domain.ErrRateLimited)
		}
	}

	res, err := uc.Runner.Run(ctx, in.Code, lang)
	if err != nil {
		return domain.RunResult{}, fmt.Errorf("editor.RunCode: %w", err)
	}
	return res, nil
}

// ─── Rate limiter ────────────────────────────────────────────────────────────

// UserRateLimiter is an in-memory token-bucket keyed by user id. Used for
// dev / CI / single-process deployments; production wires a Redis-backed
// implementation from infra/. Implements domain.RunCodeRateLimiter.
type UserRateLimiter struct {
	capacity   int
	refillRate float64 // tokens per second
	window     time.Duration
	now        func() time.Time
	mu         sync.Mutex
	buckets    map[uuid.UUID]*bucket
}

type bucket struct {
	tokens   float64
	lastSeen time.Time
}

// NewUserRateLimiter builds a limiter with `capacity` burst and refill such
// that the bucket fully refills over `window`.
func NewUserRateLimiter(capacity int, window time.Duration) *UserRateLimiter {
	if capacity <= 0 {
		capacity = 1
	}
	if window <= 0 {
		window = time.Minute
	}
	return &UserRateLimiter{
		capacity:   capacity,
		refillRate: float64(capacity) / window.Seconds(),
		window:     window,
		now:        time.Now,
		buckets:    map[uuid.UUID]*bucket{},
	}
}

// Allow implements domain.RunCodeRateLimiter. The in-memory bucket cannot
// surface a transport error, so the err return is always nil.
func (l *UserRateLimiter) Allow(_ context.Context, user uuid.UUID) (bool, int, error) {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.buckets[user]
	if !ok {
		b = &bucket{tokens: float64(l.capacity), lastSeen: now}
		l.buckets[user] = b
	}
	elapsed := now.Sub(b.lastSeen).Seconds()
	if elapsed > 0 {
		b.tokens += elapsed * l.refillRate
		if b.tokens > float64(l.capacity) {
			b.tokens = float64(l.capacity)
		}
	}
	b.lastSeen = now
	if b.tokens < 1 {
		// Estimate retry-after: time until one token is generated.
		retry := time.Duration((1.0/l.refillRate)*float64(time.Second)) + time.Second
		return false, int(retry.Seconds()), nil
	}
	b.tokens--
	return true, 0, nil
}
