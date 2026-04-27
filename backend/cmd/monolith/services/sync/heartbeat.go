// heartbeat.go — auth-gated middleware: revocation check + throttled
// last_seen_at touch. Lives in the sync package; consumers see only the
// narrow services.SyncHeartbeatGate interface (just Middleware) so neither
// services.Deps nor router.go imports sync directly.
package sync

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	stdSync "sync"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
)

// ErrDeviceRevoked / ErrUnknownDevice — sentinels the heartbeat callbacks
// return to drive the 401 device_revoked response. Sync.NewSync populates
// CheckRevokedFn with a closure mapping druz9/sync/domain.{ErrDeviceRevoked,
// ErrNotFound} onto these.
//
// These names intentionally collide with `syncDomain.ErrDeviceRevoked` only
// when imported with the qualified path — same package contains both via
// alias on the domain side, no actual symbol collision.
var (
	ErrDeviceRevoked = errors.New("sync.middleware: device revoked")
	ErrUnknownDevice = errors.New("sync.middleware: device unknown")
)

// Heartbeat — middleware exposed to router.go via the
// services.SyncHeartbeatGate interface (narrow: just Middleware).
type Heartbeat struct {
	Log *slog.Logger

	// CheckRevokedFn — synchronous revocation lookup. Returns nil when
	// active; ErrDeviceRevoked or ErrUnknownDevice when the row is
	// rejected; any other error → fail-open (logged + passthrough).
	CheckRevokedFn func(ctx context.Context, userID, deviceID uuid.UUID) error
	// TouchFn — fire-and-forget last_seen_at bump.
	TouchFn func(ctx context.Context, deviceID uuid.UUID) error

	Mu        stdSync.Mutex
	LastTouch map[uuid.UUID]time.Time // device_id → last UPDATE timestamp
	Throttle  time.Duration
}

// Compile-time check: *Heartbeat satisfies services.SyncHeartbeatGate.
var _ monolithServices.SyncHeartbeatGate = (*Heartbeat)(nil)

// Middleware reads X-Device-ID, проверяет revocation, throttled-обновляет
// last_seen_at. Без header'а — passthrough (легаси-клиент или ещё не
// прошедший bootstrap).
func (s *Heartbeat) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid, hasUser := sharedMw.UserIDFromContext(r.Context())
		didStr := r.Header.Get("X-Device-ID")
		if didStr == "" {
			didStr = r.URL.Query().Get("deviceId")
		}
		if didStr == "" || !hasUser {
			next.ServeHTTP(w, r)
			return
		}
		did, err := uuid.Parse(didStr)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}

		// 1. Revocation check — single SELECT, не трогаем БД-write hot
		// path. Если БД упадёт — fail-open.
		if s.CheckRevokedFn != nil {
			err = s.CheckRevokedFn(r.Context(), uid, did)
			switch {
			case err == nil:
				// active — продолжаем
			case errors.Is(err, ErrDeviceRevoked), errors.Is(err, ErrUnknownDevice):
				s.writeRevoked(w)
				return
			default:
				s.Log.WarnContext(r.Context(), "sync.heartbeat: revocation check failed",
					slog.Any("err", err), slog.String("device_id", didStr))
				next.ServeHTTP(w, r)
				return
			}
		}

		// 2. Throttled last_seen_at update.
		s.Mu.Lock()
		last, ok := s.LastTouch[did]
		shouldTouch := !ok || time.Since(last) >= s.Throttle
		if shouldTouch {
			s.LastTouch[did] = time.Now()
		}
		s.Mu.Unlock()
		if shouldTouch && s.TouchFn != nil {
			go s.touchAsync(did)
		}

		// Кладём device-id в context — downstream'ные handler'ы
		// (Hone Delete, etc) читают его и записывают в sync_tombstones
		// с origin_device_id. Это позволяет pull endpoint'у не возвращать
		// устройству его же tombstone'ы.
		r = r.WithContext(sharedMw.WithDeviceID(r.Context(), did))
		next.ServeHTTP(w, r)
	})
}

func (s *Heartbeat) touchAsync(did uuid.UUID) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := s.TouchFn(ctx, did); err != nil {
		s.Log.Warn("sync.heartbeat.touch failed",
			slog.Any("err", err), slog.String("device_id", did.String()))
	}
}

func (s *Heartbeat) writeRevoked(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(
		`{"error":{"code":"device_revoked","message":"This device has been signed out from another device."}}`,
	))
}
