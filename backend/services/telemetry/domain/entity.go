// Package domain — telemetry bounded context. Opt-in product analytics layer
// для Hone/Cue/web. Не PII, не identity tracking — measure user behavior
// чтобы roadmap шипал на signal, не на guess.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Surface — origin product. Explicit field (не из User-Agent header) чтобы
// admin dashboards могли filter по канал без header-parsing fragility.
type Surface string

const (
	SurfaceHone Surface = "hone"
	SurfaceCue  Surface = "cue"
	SurfaceWeb  Surface = "web"
)

// IsValid возвращает true для known surfaces. Server'у нужен для validate
// перед INSERT (CHECK в SQL тоже есть, но fail быстрее app-layer'ом).
func (s Surface) IsValid() bool {
	switch s {
	case SurfaceHone, SurfaceCue, SurfaceWeb:
		return true
	}
	return false
}

// Event — single product analytics measurement.
//
// Свободные правила (см. validation):
//   - Name: snake_case, 1-64 chars. Канон: page_view / palette_open /
//     note_create / focus_start / coach_fork_pick / etc. Живой словарь —
//     не enum (новый event не должен требовать proto migration).
//   - Properties: max 32 keys, max 512 chars per value. PII responsibility
//     лежит на клиенте — server не парсит values.
//   - OccurredAt clamps к [now()-7d, now()+1m]: drop "events из будущего"
//     (clock skew) или ancient backfill (suspicious).
type Event struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	Surface    Surface
	Name       string
	OccurredAt time.Time
	ReceivedAt time.Time
	Properties map[string]string
}

// Consent — opt-in choice по конкретной surface. Default (нет row)
// интерпретируется на клиенте: hone/web = banner-then-fire,
// cue = silent-until-explicit.
type Consent struct {
	UserID         uuid.UUID
	Surface        Surface
	OptedIn        bool
	ConsentVersion int32
	UpdatedAt      time.Time
}

// LatestConsentVersion — bumped when consent prompt copy changes
// materially (новый processor / новая категория данных). Persisted на
// клиенте, server возвращает в GetConsent чтобы фронт мог детектить
// stale ack и re-prompt.
const LatestConsentVersion int32 = 1

// Validation rules — enforce'мы в RecordEventsUC перед INSERT.
const (
	MaxNameLen           = 64
	MaxPropertyKeys      = 32
	MaxPropertyValueLen  = 512
	OccurredAtPastWindow = 7 * 24 * time.Hour
	OccurredAtFutureSkew = 1 * time.Minute
)

// Sentinel errors — каждая validation rule даёт specific error чтобы UC мог
// log/respond differently. Connect-RPC ports конвертируют в codes (Invalid /
// internal).
var (
	ErrInvalidSurface  = errors.New("telemetry: invalid surface")
	ErrInvalidName     = errors.New("telemetry: invalid event name")
	ErrTooManyProps    = errors.New("telemetry: too many property keys")
	ErrPropValueTooBig = errors.New("telemetry: property value too long")
)
