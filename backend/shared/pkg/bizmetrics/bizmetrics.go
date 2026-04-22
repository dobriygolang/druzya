// Package bizmetrics records business events to BOTH Prometheus
// (immediate counter increment, scraped by Grafana for tech alerting)
// AND ClickHouse (durable analytics store for DAU/MAU/retention/etc.).
//
// The Prometheus side is synchronous and lock-free. The ClickHouse
// side is fire-and-forget through a buffered async sink so a slow CH
// node never blocks request handling.
//
// Wiring is done once at boot via SetSink(...). If no sink is set the
// helpers still record to Prometheus — useful for unit tests and the
// local stack which can run without ClickHouse.
package bizmetrics

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"druz9/shared/pkg/metrics"
)

// Event is the canonical row shape persisted to ClickHouse `events` table.
//
//	CREATE TABLE events (
//	    ts          DateTime64(3) DEFAULT now64(),
//	    user_id     UUID,
//	    name        LowCardinality(String),
//	    section     LowCardinality(String),
//	    mode        LowCardinality(String),
//	    result      LowCardinality(String),
//	    score       Int32,
//	    duration_ms UInt32,
//	    source      LowCardinality(String),
//	    tier        LowCardinality(String),
//	    props       String  -- JSON for non-standard fields
//	) ENGINE = MergeTree ORDER BY (name, ts);
type Event struct {
	Timestamp  time.Time
	UserID     string
	Name       string
	Section    string
	Mode       string
	Result     string
	Score      int32
	DurationMs uint32
	Source     string
	Tier       string
	Props      map[string]any
}

// Sink is the contract for an async event consumer (e.g. ClickHouse client
// with batching). Implementations MUST be non-blocking — drop events under
// pressure and increment an internal counter rather than back-propagate.
type Sink interface {
	Emit(Event)
}

// nopSink is the default — discards every event. Used until SetSink is called.
type nopSink struct{}

func (nopSink) Emit(Event) {}

var (
	sinkPtr     atomic.Pointer[Sink]
	logger      atomic.Pointer[slog.Logger]
	defaultSink Sink = nopSink{}
)

func init() {
	s := defaultSink
	sinkPtr.Store(&s)
}

// SetSink swaps the active event sink. Safe to call at any time; nil resets
// to the no-op sink.
func SetSink(s Sink) {
	if s == nil {
		s = nopSink{}
	}
	sinkPtr.Store(&s)
}

// SetLogger plugs in a structured logger for sink-side errors.
func SetLogger(l *slog.Logger) {
	logger.Store(l)
}

func emit(ctx context.Context, e Event) {
	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now()
	}
	if uid, ok := userIDFromCtx(ctx); ok && e.UserID == "" {
		e.UserID = uid
	}
	(*sinkPtr.Load()).Emit(e)
}

// ── userID extraction ──────────────────────────────────────────────────────
//
// We avoid importing shared/pkg/middleware here to prevent an import cycle
// (middleware would otherwise want to call into metrics). Instead we read
// the same ctx key by string match — middleware's ctxKey type is internal
// but the underlying value is a `uuid.UUID`. Callers can also override
// UserID directly on the Event struct.

type userCtxKey struct{}

// WithUserID stores a stringified user id on the context for emit().
// Auth middleware can call this in addition to its own typed key so that
// bizmetrics can stamp every event without an import cycle.
func WithUserID(ctx context.Context, uid string) context.Context {
	return context.WithValue(ctx, userCtxKey{}, uid)
}

func userIDFromCtx(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(userCtxKey{}).(string)
	return v, ok && v != ""
}

// ── Public recording helpers ───────────────────────────────────────────────

// RecordMatchStarted is called when an arena match transitions to "in_match".
func RecordMatchStarted(ctx context.Context, section, mode string) {
	metrics.MatchesStartedTotal.WithLabelValues(section, mode).Inc()
	emit(ctx, Event{Name: "match_started", Section: section, Mode: mode})
}

// RecordMatchFinished is called on any terminal arena state.
// `result` is win|loss|draw|timeout|abandoned.
func RecordMatchFinished(ctx context.Context, section, mode, result string, duration time.Duration) {
	metrics.MatchesFinishedTotal.WithLabelValues(section, mode, result).Inc()
	emit(ctx, Event{
		Name: "match_finished", Section: section, Mode: mode, Result: result,
		DurationMs: uint32(duration.Milliseconds()),
	})
}

// RecordMockSessionCompleted records a successful end-of-mock with score.
func RecordMockSessionCompleted(ctx context.Context, section string, score int32) {
	metrics.MockSessionsTotal.WithLabelValues(section, "completed").Inc()
	emit(ctx, Event{Name: "mock_completed", Section: section, Score: score})
}

// RecordMockSessionAbandoned records when a user drops a mock mid-session.
func RecordMockSessionAbandoned(ctx context.Context, section string, elapsedMin int) {
	metrics.MockSessionsTotal.WithLabelValues(section, "abandoned").Inc()
	emit(ctx, Event{
		Name: "mock_abandoned", Section: section,
		DurationMs: uint32(elapsedMin * 60 * 1000),
	})
}

// RecordSignup records a fresh user registration.
// `source` is yandex|telegram|email — used in conversion funnel.
func RecordSignup(ctx context.Context, source string) {
	emit(ctx, Event{Name: "signup", Source: source})
}

// RecordPremiumUpgrade records a successful free → paid conversion.
// `tier` is the new tier (premium|premium_plus|trial).
func RecordPremiumUpgrade(ctx context.Context, tier string) {
	emit(ctx, Event{Name: "premium_upgrade", Tier: tier})
}

// RecordQueueWait observes matchmaking wait time per section. Emits both
// the histogram (for tech alerting) and a per-event row for analytics.
func RecordQueueWait(ctx context.Context, section string, wait time.Duration) {
	metrics.QueueWaitSeconds.WithLabelValues(section).Observe(wait.Seconds())
	emit(ctx, Event{Name: "queue_wait", Section: section, DurationMs: uint32(wait.Milliseconds())})
}

// ── Memory-buffered sink (for tests + local dev) ───────────────────────────

// MemorySink keeps events in-memory; useful for asserting wiring in tests.
type MemorySink struct {
	mu     sync.Mutex
	Events []Event
}

func (m *MemorySink) Emit(e Event) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Events = append(m.Events, e)
}

// Snapshot returns a copy of the recorded events so the caller can inspect
// them without racing the writer.
func (m *MemorySink) Snapshot() []Event {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Event, len(m.Events))
	copy(out, m.Events)
	return out
}
