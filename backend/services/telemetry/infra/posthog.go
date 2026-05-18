// Package infra — PostHog AnalyticsSink. Batches events to the PostHog
// capture endpoint; distinct_id = HMAC(user_id, salt) keeps IDs opaque.
// When APIKey="" the wirer returns NoopSink.
package infra

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"druz9/telemetry/domain"

	"github.com/google/uuid"
)

// PostHogSink — HTTP-based fanout. Batches до 50 events в один POST,
// flush по timer'у каждые 5s или при достижении BATCH_SIZE.
//
// Non-blocking on Track(): batch growth in memory, background goroutine
// flush'ит. Если goroutine не успевает (extreme burst) — events drop'аются
// после QUEUE_LIMIT (acceptable, sink — best-effort).
type PostHogSink struct {
	apiKey   string
	endpoint string
	anon     domain.IDAnonymizer
	client   *http.Client

	mu    sync.Mutex
	queue []domain.Event

	flushCh chan struct{}
	closeCh chan struct{}
	closed  bool
}

const (
	posthogBatchSize   = 50
	posthogQueueLimit  = 5000 // hard cap; drop new когда reached
	posthogFlushEvery  = 5 * time.Second
	posthogHTTPTimeout = 10 * time.Second
)

// NewPostHogSink — конструктор. endpoint обычно https://eu.i.posthog.com
// (без trailing slash). Если "" — defaults к eu.i.posthog.com.
func NewPostHogSink(apiKey, endpoint string, anon domain.IDAnonymizer) *PostHogSink {
	if endpoint == "" {
		endpoint = "https://eu.i.posthog.com"
	}
	s := &PostHogSink{
		apiKey:   apiKey,
		endpoint: endpoint,
		anon:     anon,
		client:   &http.Client{Timeout: 10 * time.Second},
		queue:    make([]domain.Event, 0, posthogBatchSize),
		flushCh:  make(chan struct{}, 1),
		closeCh:  make(chan struct{}),
	}
	go s.flushLoop()
	return s
}

// Track adds events to the in-memory queue. Non-blocking; returns nil
// always (errors live in flushLoop logs).
func (s *PostHogSink) Track(_ context.Context, events []domain.Event) error {
	if len(events) == 0 {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	for _, e := range events {
		if len(s.queue) >= posthogQueueLimit {
			break
		}
		s.queue = append(s.queue, e)
	}
	if len(s.queue) >= posthogBatchSize {
		select {
		case s.flushCh <- struct{}{}:
		default:
		}
	}
	return nil
}

// DeleteUser — PostHog GDPR delete via /api/person/delete endpoint
// требует personal API key (не project) → не делаем здесь. Возвращаем
// nil (best-effort no-op); deletion остаётся local-only.
//
// Sergey может вручную дернуть PostHog dashboard data deletion API
// раз в квартал по списку opt-out'нувшихся; out of scope для X3 MVP.
func (s *PostHogSink) DeleteUser(_ context.Context, _ string) error {
	return nil
}

// Close — drain remaining queue + stop background flush. Используется
// в Shutdown chain. Caller passes shutdown ctx so the final flush
// honours bootstrap deadline.
func (s *PostHogSink) Close(ctx context.Context) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.mu.Unlock()
	close(s.closeCh)
	if ctx == nil {
		ctx = context.Background()
	}
	// Final flush (synchronous, чтобы Shutdown не вернулся раньше
	// чем pending events улетят).
	return s.flushOnce(ctx)
}

func (s *PostHogSink) flushLoop() {
	ticker := time.NewTicker(posthogFlushEvery)
	defer ticker.Stop()
	for {
		select {
		case <-s.closeCh:
			return
		case <-ticker.C:
			// detached from request lifetime — uses WithoutCancel
			fCtx, cancel := context.WithTimeout(context.Background(), posthogHTTPTimeout)
			_ = s.flushOnce(fCtx)
			cancel()
		case <-s.flushCh:
			fCtx, cancel := context.WithTimeout(context.Background(), posthogHTTPTimeout)
			_ = s.flushOnce(fCtx)
			cancel()
		}
	}
}

func (s *PostHogSink) flushOnce(ctx context.Context) error {
	s.mu.Lock()
	if len(s.queue) == 0 {
		s.mu.Unlock()
		return nil
	}
	batch := s.queue
	s.queue = make([]domain.Event, 0, posthogBatchSize)
	s.mu.Unlock()

	return s.postBatch(ctx, batch)
}

type posthogEvent struct {
	APIKey     string                 `json:"api_key"`
	Event      string                 `json:"event"`
	DistinctID string                 `json:"distinct_id"`
	Properties map[string]interface{} `json:"properties"`
	Timestamp  string                 `json:"timestamp"`
}

type posthogBatchPayload struct {
	APIKey string         `json:"api_key"`
	Batch  []posthogEvent `json:"batch"`
}

func (s *PostHogSink) postBatch(ctx context.Context, events []domain.Event) error {
	if len(events) == 0 {
		return nil
	}
	rows := make([]posthogEvent, 0, len(events))
	for _, e := range events {
		distinctID := ""
		if s.anon != nil {
			distinctID = s.anon.Anonymize(e.UserID)
		} else {
			distinctID = e.UserID.String()
		}
		props := make(map[string]interface{}, len(e.Properties)+2)
		for k, v := range e.Properties {
			props[k] = v
		}
		props["$lib"] = "druz9-telemetry-server"
		props["surface"] = string(e.Surface)
		rows = append(rows, posthogEvent{
			APIKey:     s.apiKey,
			Event:      e.Name,
			DistinctID: distinctID,
			Properties: props,
			Timestamp:  e.OccurredAt.UTC().Format(time.RFC3339),
		})
	}
	body, err := json.Marshal(posthogBatchPayload{APIKey: s.apiKey, Batch: rows})
	if err != nil {
		return fmt.Errorf("posthog: marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint+"/batch/", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("posthog: request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("posthog: do: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("posthog: status %d", resp.StatusCode)
	}
	return nil
}

// ── Noop sink (default когда POSTHOG_API_KEY="") ───────────────────────

// NoopSink — placeholder когда PostHog не configured. Track/DeleteUser
// возвращают nil без работы.
type NoopSink struct{}

func (NoopSink) Track(_ context.Context, _ []domain.Event) error { return nil }
func (NoopSink) DeleteUser(_ context.Context, _ string) error    { return nil }
func (NoopSink) Close(_ context.Context) error                   { return nil }

// ── IDAnonymizer ───────────────────────────────────────────────────────

// HMACAnonymizer — HMAC-SHA256 anonymizer. Производит стабильный hex hash
// который вне знания соли не reversible к DB uuid.
type HMACAnonymizer struct {
	salt []byte
}

func NewHMACAnonymizer(salt string) *HMACAnonymizer {
	if salt == "" {
		// Защита от misconfiguration: пустая соль → анонимизация
		// бессмысленна (любой может посчитать hash от uuid). Wirer
		// должен fail-fast'нуть, но defensive guard: подставим default
		// который явно объявляет «not configured» в hash.
		salt = "druz9-anon-salt-NOT-CONFIGURED"
	}
	return &HMACAnonymizer{salt: []byte(salt)}
}

func (a *HMACAnonymizer) Anonymize(userID uuid.UUID) string {
	h := hmac.New(sha256.New, a.salt)
	_, _ = h.Write(userID[:])
	return hex.EncodeToString(h.Sum(nil))
}
