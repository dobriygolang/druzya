package app

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"

	"druz9/copilot/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ─────────────────────────────────────────────────────────────────────────
// In-memory fakes — exist solely to drive the use-case tests below.
// Each fake intentionally keeps the minimum surface needed; missing methods
// panic so a future test that touches new territory fails loudly.
// ─────────────────────────────────────────────────────────────────────────

type fakeConversations struct {
	mu   sync.Mutex
	rows map[uuid.UUID]domain.Conversation
}

func newFakeConversations() *fakeConversations {
	return &fakeConversations{rows: map[uuid.UUID]domain.Conversation{}}
}

func (f *fakeConversations) Create(_ context.Context, userID uuid.UUID, title, model string) (domain.Conversation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now().UTC()
	c := domain.Conversation{
		ID:        uuid.New(),
		UserID:    userID,
		Title:     title,
		Model:     model,
		CreatedAt: now,
		UpdatedAt: now,
	}
	f.rows[c.ID] = c
	return c, nil
}

func (f *fakeConversations) Get(_ context.Context, id uuid.UUID) (domain.Conversation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.rows[id]
	if !ok {
		return domain.Conversation{}, domain.ErrNotFound
	}
	return c, nil
}

func (f *fakeConversations) UpdateTitle(_ context.Context, id uuid.UUID, title string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	c.Title = title
	c.UpdatedAt = time.Now().UTC()
	f.rows[id] = c
	return nil
}

func (f *fakeConversations) Touch(_ context.Context, id uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	c.UpdatedAt = time.Now().UTC()
	f.rows[id] = c
	return nil
}

func (f *fakeConversations) Delete(_ context.Context, id, userID uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.rows[id]
	if !ok || c.UserID != userID {
		return domain.ErrNotFound
	}
	delete(f.rows, id)
	return nil
}

func (f *fakeConversations) ListForUser(_ context.Context, userID uuid.UUID, _ domain.Cursor, limit int) ([]domain.ConversationSummary, domain.Cursor, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]domain.ConversationSummary, 0, len(f.rows))
	for _, c := range f.rows {
		if c.UserID != userID {
			continue
		}
		out = append(out, domain.ConversationSummary{Conversation: c})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, "", nil
}

type fakeMessages struct {
	mu    sync.Mutex
	rows  map[uuid.UUID]domain.Message
	convs *fakeConversations // used by OwnerOf; may be nil for isolated tests
}

func newFakeMessages(convs *fakeConversations) *fakeMessages {
	return &fakeMessages{rows: map[uuid.UUID]domain.Message{}, convs: convs}
}

func (f *fakeMessages) Insert(_ context.Context, m domain.Message) (domain.Message, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	m.ID = uuid.New()
	m.CreatedAt = time.Now().UTC()
	f.rows[m.ID] = m
	return m, nil
}

func (f *fakeMessages) UpdateAssistant(_ context.Context, id uuid.UUID, content string, tokensIn, tokensOut, latencyMs int) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	m, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	m.Content = content
	m.TokensIn = tokensIn
	m.TokensOut = tokensOut
	m.LatencyMs = latencyMs
	f.rows[id] = m
	return nil
}

func (f *fakeMessages) List(_ context.Context, conversationID uuid.UUID) ([]domain.Message, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]domain.Message, 0)
	for _, m := range f.rows {
		if m.ConversationID == conversationID {
			out = append(out, m)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (f *fakeMessages) Rate(_ context.Context, id uuid.UUID, rating int8) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	m, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	v := rating
	m.Rating = &v
	f.rows[id] = m
	return nil
}

// OwnerOf resolves ownership through the paired Conversations fake.
// If no Conversations fake is linked, returns ErrNotFound — tests that
// don't exercise Rate/OwnerOf can pass nil.
func (f *fakeMessages) OwnerOf(_ context.Context, messageID uuid.UUID) (uuid.UUID, error) {
	f.mu.Lock()
	m, ok := f.rows[messageID]
	f.mu.Unlock()
	if !ok {
		return uuid.Nil, domain.ErrNotFound
	}
	if f.convs == nil {
		return uuid.Nil, domain.ErrNotFound
	}
	f.convs.mu.Lock()
	defer f.convs.mu.Unlock()
	c, ok := f.convs.rows[m.ConversationID]
	if !ok {
		return uuid.Nil, domain.ErrNotFound
	}
	return c.UserID, nil
}

type fakeQuotas struct {
	mu   sync.Mutex
	rows map[uuid.UUID]domain.Quota
	cap  int
}

func newFakeQuotas(cap int) *fakeQuotas {
	return &fakeQuotas{rows: map[uuid.UUID]domain.Quota{}, cap: cap}
}

func (f *fakeQuotas) GetOrInit(_ context.Context, userID uuid.UUID) (domain.Quota, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if q, ok := f.rows[userID]; ok {
		return q, nil
	}
	q := domain.Quota{
		UserID:        userID,
		Plan:          enums.SubscriptionPlanFree,
		RequestsUsed:  0,
		RequestsCap:   f.cap,
		ResetsAt:      time.Now().Add(24 * time.Hour),
		ModelsAllowed: []string{"openai/gpt-4o-mini"},
		UpdatedAt:     time.Now().UTC(),
	}
	f.rows[userID] = q
	return q, nil
}

func (f *fakeQuotas) IncrementUsage(_ context.Context, userID uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	q, ok := f.rows[userID]
	if !ok {
		return domain.ErrNotFound
	}
	q.RequestsUsed++
	f.rows[userID] = q
	return nil
}

func (f *fakeQuotas) ResetWindow(_ context.Context, userID uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	q, ok := f.rows[userID]
	if !ok {
		return domain.ErrNotFound
	}
	q.RequestsUsed = 0
	q.ResetsAt = time.Now().Add(24 * time.Hour)
	f.rows[userID] = q
	return nil
}

func (f *fakeQuotas) UpdatePlan(_ context.Context, userID uuid.UUID, plan enums.SubscriptionPlan, cap int, modelsAllowed []string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	q, ok := f.rows[userID]
	if !ok {
		return domain.ErrNotFound
	}
	q.Plan = plan
	q.RequestsCap = cap
	q.ModelsAllowed = append([]string(nil), modelsAllowed...)
	f.rows[userID] = q
	return nil
}

// fakeLLM is a scripted provider: it emits a predefined sequence of deltas
// and a Done event. If ErrOn > 0, the given index's frame is replaced by Err.
type fakeLLM struct {
	Deltas      []string
	TokensIn    int
	TokensOut   int
	Model       string
	SendErrOnIx int // 0 = no error; 1-indexed into Deltas
	ErrValue    error
}

func (f *fakeLLM) Stream(_ context.Context, _ domain.CompletionRequest) (<-chan domain.StreamEvent, error) {
	out := make(chan domain.StreamEvent, len(f.Deltas)+2)
	go func() {
		defer close(out)
		for i, d := range f.Deltas {
			if f.SendErrOnIx == i+1 {
				out <- domain.StreamEvent{Err: f.ErrValue}
				return
			}
			out <- domain.StreamEvent{Delta: d}
		}
		out <- domain.StreamEvent{Done: &domain.CompletionDone{
			TokensIn:  f.TokensIn,
			TokensOut: f.TokensOut,
			Model:     f.Model,
		}}
	}()
	return out, nil
}

// fakeConfig serves a minimal DesktopConfig for tests.
type fakeConfig struct {
	cfg domain.DesktopConfig
}

func newFakeConfig(defaultModel string) *fakeConfig {
	return &fakeConfig{cfg: domain.DesktopConfig{
		Rev:            1,
		DefaultModelID: defaultModel,
		Models: []domain.ProviderModel{
			{ID: "openai/gpt-4o-mini", DisplayName: "GPT Fast", ProviderName: "OpenAI"},
			{ID: "openai/gpt-4o", DisplayName: "GPT Smart", ProviderName: "OpenAI"},
		},
	}}
}

func (f *fakeConfig) Load(_ context.Context) (domain.DesktopConfig, error) { return f.cfg, nil }

// drainFrames collects every frame from a channel until it closes.
func drainFrames(ch <-chan StreamFrame) []StreamFrame {
	var out []StreamFrame
	for f := range ch {
		out = append(out, f)
	}
	return out
}

// firstErr returns the first frame.Err encountered, or nil.
func firstErr(frames []StreamFrame) error {
	for _, f := range frames {
		if f.Err != nil {
			return f.Err
		}
	}
	return nil
}

// assembledText concatenates all delta text in order.
func assembledText(frames []StreamFrame) string {
	var s string
	for _, f := range frames {
		s += f.Delta
	}
	return s
}

// lastDone returns the final ConversationDoneFrame, or nil.
func lastDone(frames []StreamFrame) *ConversationDoneFrame {
	for i := len(frames) - 1; i >= 0; i-- {
		if frames[i].Done != nil {
			return frames[i].Done
		}
	}
	return nil
}

// errIs is a tiny helper that matches errors.Is but returns a bool for use
// in test expressions.
func errIs(err, target error) bool { return errors.Is(err, target) }
