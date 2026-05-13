package app

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"

	"druz9/copilot/domain"
	mocks "druz9/copilot/domain/mocks"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// Wave 13: внутри-тестовые fakes заменены на mockgen-generated mocks
// с DoAndReturn-closures. Stateful поведение (in-memory CRUD) живёт в
// store-структурах, которые тесты читают напрямую через mutex.

// ─── conversations store + wire ───────────────────────────────────────────

type convStore struct {
	mu   sync.Mutex
	rows map[uuid.UUID]domain.Conversation
}

func newConvStore() *convStore { return &convStore{rows: map[uuid.UUID]domain.Conversation{}} }

func wireMockConvRepo(ctrl *gomock.Controller, s *convStore) *mocks.MockConversationRepo {
	m := mocks.NewMockConversationRepo(ctrl)
	m.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID, title, model string) (domain.Conversation, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			now := time.Now().UTC()
			c := domain.Conversation{
				ID:        uuid.New(),
				UserID:    userID,
				Title:     title,
				Model:     model,
				CreatedAt: now,
				UpdatedAt: now,
			}
			s.rows[c.ID] = c
			return c, nil
		},
	).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) (domain.Conversation, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			c, ok := s.rows[id]
			if !ok {
				return domain.Conversation{}, domain.ErrNotFound
			}
			return c, nil
		},
	).AnyTimes()
	m.EXPECT().UpdateTitle(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID, title string) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			c, ok := s.rows[id]
			if !ok {
				return domain.ErrNotFound
			}
			c.Title = title
			c.UpdatedAt = time.Now().UTC()
			s.rows[id] = c
			return nil
		},
	).AnyTimes()
	m.EXPECT().Touch(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			c, ok := s.rows[id]
			if !ok {
				return domain.ErrNotFound
			}
			c.UpdatedAt = time.Now().UTC()
			s.rows[id] = c
			return nil
		},
	).AnyTimes()
	m.EXPECT().Delete(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id, userID uuid.UUID) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			c, ok := s.rows[id]
			if !ok || c.UserID != userID {
				return domain.ErrNotFound
			}
			delete(s.rows, id)
			return nil
		},
	).AnyTimes()
	m.EXPECT().ListForUser(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID, _ domain.Cursor, limit int) ([]domain.ConversationSummary, domain.Cursor, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			out := make([]domain.ConversationSummary, 0, len(s.rows))
			for _, c := range s.rows {
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
		},
	).AnyTimes()
	m.EXPECT().ResetModelsNotIn(gomock.Any(), gomock.Any(), gomock.Any()).Return(int64(0), nil).AnyTimes()
	return m
}

// ─── messages store + wire ────────────────────────────────────────────────

type msgStore struct {
	mu   sync.Mutex
	rows map[uuid.UUID]domain.Message
	conv *convStore // for OwnerOf
}

func newMsgStore(conv *convStore) *msgStore {
	return &msgStore{rows: map[uuid.UUID]domain.Message{}, conv: conv}
}

func wireMockMsgRepo(ctrl *gomock.Controller, s *msgStore) *mocks.MockMessageRepo {
	m := mocks.NewMockMessageRepo(ctrl)
	m.EXPECT().Insert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, msg domain.Message) (domain.Message, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			msg.ID = uuid.New()
			msg.CreatedAt = time.Now().UTC()
			s.rows[msg.ID] = msg
			return msg, nil
		},
	).AnyTimes()
	m.EXPECT().UpdateAssistant(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID, content string, tokensIn, tokensOut, latencyMs int) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			msg, ok := s.rows[id]
			if !ok {
				return domain.ErrNotFound
			}
			msg.Content = content
			msg.TokensIn = tokensIn
			msg.TokensOut = tokensOut
			msg.LatencyMs = latencyMs
			s.rows[id] = msg
			return nil
		},
	).AnyTimes()
	m.EXPECT().List(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, conversationID uuid.UUID) ([]domain.Message, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			out := make([]domain.Message, 0)
			for _, m := range s.rows {
				if m.ConversationID == conversationID {
					out = append(out, m)
				}
			}
			sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
			return out, nil
		},
	).AnyTimes()
	m.EXPECT().Rate(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID, rating int8) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			msg, ok := s.rows[id]
			if !ok {
				return domain.ErrNotFound
			}
			v := rating
			msg.Rating = &v
			s.rows[id] = msg
			return nil
		},
	).AnyTimes()
	m.EXPECT().OwnerOf(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, messageID uuid.UUID) (uuid.UUID, error) {
			s.mu.Lock()
			msg, ok := s.rows[messageID]
			s.mu.Unlock()
			if !ok {
				return uuid.Nil, domain.ErrNotFound
			}
			if s.conv == nil {
				return uuid.Nil, domain.ErrNotFound
			}
			s.conv.mu.Lock()
			defer s.conv.mu.Unlock()
			c, ok := s.conv.rows[msg.ConversationID]
			if !ok {
				return uuid.Nil, domain.ErrNotFound
			}
			return c.UserID, nil
		},
	).AnyTimes()
	return m
}

// ─── quotas store + wire ──────────────────────────────────────────────────

type quotaStore struct {
	mu   sync.Mutex
	rows map[uuid.UUID]domain.Quota
	cap  int
}

func newQuotaStore(cap int) *quotaStore {
	return &quotaStore{rows: map[uuid.UUID]domain.Quota{}, cap: cap}
}

func wireMockQuotaRepo(ctrl *gomock.Controller, s *quotaStore) *mocks.MockQuotaRepo {
	m := mocks.NewMockQuotaRepo(ctrl)
	m.EXPECT().GetOrInit(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID) (domain.Quota, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if q, ok := s.rows[userID]; ok {
				return q, nil
			}
			q := domain.Quota{
				UserID:        userID,
				Plan:          enums.SubscriptionPlanFree,
				RequestsUsed:  0,
				RequestsCap:   s.cap,
				ResetsAt:      time.Now().Add(24 * time.Hour),
				ModelsAllowed: []string{"druz9/turbo"},
				UpdatedAt:     time.Now().UTC(),
			}
			s.rows[userID] = q
			return q, nil
		},
	).AnyTimes()
	m.EXPECT().IncrementUsage(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			q, ok := s.rows[userID]
			if !ok {
				return domain.ErrNotFound
			}
			q.RequestsUsed++
			s.rows[userID] = q
			return nil
		},
	).AnyTimes()
	m.EXPECT().ResetWindow(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			q, ok := s.rows[userID]
			if !ok {
				return domain.ErrNotFound
			}
			q.RequestsUsed = 0
			q.ResetsAt = time.Now().Add(24 * time.Hour)
			s.rows[userID] = q
			return nil
		},
	).AnyTimes()
	m.EXPECT().UpdatePlan(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID, plan enums.SubscriptionPlan, cap int, modelsAllowed []string) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			q, ok := s.rows[userID]
			if !ok {
				return domain.ErrNotFound
			}
			q.Plan = plan
			q.RequestsCap = cap
			q.ModelsAllowed = append([]string(nil), modelsAllowed...)
			s.rows[userID] = q
			return nil
		},
	).AnyTimes()
	return m
}

// ─── llm provider mock (scripted) ─────────────────────────────────────────

// llmScript описывает scripted-output провайдера: deltas + done.
type llmScript struct {
	Deltas      []string
	TokensIn    int
	TokensOut   int
	Model       string
	SendErrOnIx int // 0 = no error; 1-indexed
	ErrValue    error
}

func wireMockLLMProvider(ctrl *gomock.Controller, scr *llmScript) *mocks.MockLLMProvider {
	m := mocks.NewMockLLMProvider(ctrl)
	m.EXPECT().Stream(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ domain.CompletionRequest) (<-chan domain.StreamEvent, error) {
			out := make(chan domain.StreamEvent, len(scr.Deltas)+2)
			go func() {
				defer close(out)
				for i, d := range scr.Deltas {
					if scr.SendErrOnIx == i+1 {
						out <- domain.StreamEvent{Err: scr.ErrValue}
						return
					}
					out <- domain.StreamEvent{Delta: d}
				}
				out <- domain.StreamEvent{Done: &domain.CompletionDone{
					TokensIn:  scr.TokensIn,
					TokensOut: scr.TokensOut,
					Model:     scr.Model,
				}}
			}()
			return out, nil
		},
	).AnyTimes()
	return m
}

// ─── config provider mock ─────────────────────────────────────────────────

type configState struct {
	cfg domain.DesktopConfig
}

func newConfigState(defaultModel string) *configState {
	return &configState{cfg: domain.DesktopConfig{
		Rev:            1,
		DefaultModelID: defaultModel,
		Models: []domain.ProviderModel{
			{ID: "druz9/turbo", DisplayName: "Turbo", ProviderName: "Druz9"},
			{ID: "openai/gpt-4o-mini", DisplayName: "GPT Fast", ProviderName: "OpenAI"},
			{ID: "openai/gpt-4o", DisplayName: "GPT Smart", ProviderName: "OpenAI"},
		},
	}}
}

func wireMockConfigProvider(ctrl *gomock.Controller, s *configState) *mocks.MockConfigProvider {
	m := mocks.NewMockConfigProvider(ctrl)
	m.EXPECT().Load(gomock.Any()).DoAndReturn(
		func(_ context.Context) (domain.DesktopConfig, error) { return s.cfg, nil },
	).AnyTimes()
	return m
}

// ─── helpers ──────────────────────────────────────────────────────────────

// drainFrames collects every frame from a channel until it closes.
func drainFrames(ch <-chan StreamFrame) []StreamFrame {
	out := make([]StreamFrame, 0, 16)
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
