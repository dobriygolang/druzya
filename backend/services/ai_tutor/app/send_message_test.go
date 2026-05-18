package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"druz9/ai_tutor/domain"

	"github.com/google/uuid"
)

// inMemPersonaRepo — фейк хранилища персон. Тест-only, держит одну
// персону, GetByID возвращает её. Остальные методы интерфейса не нужны
// для happy-path SendMessage.
type inMemPersonaRepo struct{ p domain.Persona }

func (r *inMemPersonaRepo) GetByID(_ context.Context, _ uuid.UUID) (domain.Persona, error) {
	return r.p, nil
}
func (r *inMemPersonaRepo) GetBySlug(_ context.Context, _ string) (domain.Persona, error) {
	return r.p, nil
}
func (r *inMemPersonaRepo) ListActive(_ context.Context) ([]domain.Persona, error) {
	return []domain.Persona{r.p}, nil
}
func (r *inMemPersonaRepo) SetAIUserID(_ context.Context, _, _ uuid.UUID) error { return nil }

type inMemThreadRepo struct{ t domain.Thread }

func (r *inMemThreadRepo) CreateOrGet(_ context.Context, _, _ uuid.UUID) (domain.Thread, error) {
	return r.t, nil
}
func (r *inMemThreadRepo) GetThreadByID(_ context.Context, _ uuid.UUID) (domain.Thread, error) {
	return r.t, nil
}
func (r *inMemThreadRepo) ListThreadsByStudent(_ context.Context, _ uuid.UUID) ([]domain.Thread, error) {
	return []domain.Thread{r.t}, nil
}
func (r *inMemThreadRepo) ListThreadsByStudentPaged(_ context.Context, _ uuid.UUID, _ int, _ string) ([]domain.Thread, string, error) {
	return []domain.Thread{r.t}, "", nil
}
func (r *inMemThreadRepo) IncrementCounters(_ context.Context, _ uuid.UUID, _ time.Time) (domain.Thread, error) {
	r.t.MessageCount++
	return r.t, nil
}
func (r *inMemThreadRepo) UpdateSummary(_ context.Context, _ uuid.UUID, summary string, now time.Time) error {
	r.t.SummaryMD = summary
	r.t.LastCompactedAt = &now
	return nil
}

type inMemEpisodeRepo struct{ rows []domain.Episode }

func (r *inMemEpisodeRepo) Append(_ context.Context, e domain.Episode) (domain.Episode, error) {
	e.ID = uuid.New()
	e.OccurredAt = time.Now().UTC()
	r.rows = append(r.rows, e)
	return e, nil
}
func (r *inMemEpisodeRepo) ListRecent(_ context.Context, _ uuid.UUID, _ int) ([]domain.Episode, error) {
	return r.rows, nil
}
func (r *inMemEpisodeRepo) CountSinceCompaction(_ context.Context, _ uuid.UUID, _ *time.Time) (int, error) {
	return len(r.rows), nil
}

type inMemFactRepo struct{ rows map[string]domain.Fact }

func (r *inMemFactRepo) Upsert(_ context.Context, f domain.Fact) (domain.Fact, error) {
	if r.rows == nil {
		r.rows = map[string]domain.Fact{}
	}
	f.ID = uuid.New()
	r.rows[f.Key] = f
	return f, nil
}
func (r *inMemFactRepo) TopRanked(_ context.Context, _ uuid.UUID, _ int) ([]domain.Fact, error) {
	out := make([]domain.Fact, 0, len(r.rows))
	for _, f := range r.rows {
		out = append(out, f)
	}
	return out, nil
}
func (r *inMemFactRepo) RecallSemantic(_ context.Context, _ uuid.UUID, _ []float32, _ int) ([]domain.Fact, error) {
	return nil, nil
}
func (r *inMemFactRepo) SetEmbedding(_ context.Context, _ uuid.UUID, _ []float32, _ string, _ time.Time) error {
	return nil
}
func (r *inMemFactRepo) TouchLastUsed(_ context.Context, _ []uuid.UUID, _ time.Time) error {
	return nil
}
func (r *inMemFactRepo) Delete(_ context.Context, _ uuid.UUID, key string) error {
	delete(r.rows, key)
	return nil
}

// stubLLM — детерминированный ответ. Echo'нет user-сообщение чтобы
// тест мог ассертить что content прошёл насквозь.
type stubLLM struct{ lastMessages []domain.LLMMessage }

func (s *stubLLM) Run(_ context.Context, _ string, msgs []domain.LLMMessage, _ domain.LLMOptions) (domain.LLMResponse, error) {
	s.lastMessages = msgs
	return domain.LLMResponse{
		Content:   "ok: " + lastUserContent(msgs),
		TokensIn:  100,
		TokensOut: 20,
		Model:     "stub/fake-7b",
	}, nil
}

func lastUserContent(msgs []domain.LLMMessage) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "user" {
			return msgs[i].Content
		}
	}
	return ""
}

func TestSendMessage_HappyPath(t *testing.T) {
	t.Parallel()

	persona := domain.Persona{
		ID:             uuid.New(),
		Slug:           "go-coach",
		DisplayName:    "go coach",
		PromptTemplate: "Ты go-coach.\nSnapshot: {{snapshot}}\nFacts: {{facts}}\nSummary: {{summary}}",
		LLMTaskKind:    "ai_tutor_chat",
		Active:         true,
	}
	student := uuid.New()
	thread := domain.Thread{
		ID:           uuid.New(),
		StudentID:    student,
		PersonaID:    persona.ID,
		MessageCount: 0,
	}
	personaRepo := &inMemPersonaRepo{p: persona}
	threadRepo := &inMemThreadRepo{t: thread}
	episodeRepo := &inMemEpisodeRepo{}
	factRepo := &inMemFactRepo{}
	llm := &stubLLM{}

	uc := &SendMessage{
		Personas: personaRepo,
		Threads:  threadRepo,
		Episodes: episodeRepo,
		Facts:    factRepo,
		LLM:      llm,
		Now:      func() time.Time { return time.Date(2026, 5, 18, 12, 0, 0, 0, time.UTC) },
	}

	res, err := uc.Do(context.Background(), SendMessageInput{
		StudentID: student,
		ThreadID:  thread.ID,
		Content:   "Hi, как мне разобраться с goroutines?",
	})
	if err != nil {
		t.Fatalf("SendMessage.Do: %v", err)
	}
	if res.AssistantEpisode.Content == "" {
		t.Fatalf("assistant content empty")
	}
	if !strings.HasPrefix(res.AssistantEpisode.Content, "ok: ") {
		t.Fatalf("assistant content = %q, want prefix 'ok: '", res.AssistantEpisode.Content)
	}
	if res.UserEpisode.Role != domain.RoleUser {
		t.Fatalf("user role = %q", res.UserEpisode.Role)
	}
	if res.AssistantEpisode.Role != domain.RoleAssistant {
		t.Fatalf("assistant role = %q", res.AssistantEpisode.Role)
	}
	if len(episodeRepo.rows) != 2 {
		t.Fatalf("episodes = %d, want 2 (user + assistant)", len(episodeRepo.rows))
	}
	if !strings.Contains(llm.lastMessages[0].Content, "Ты go-coach") {
		t.Fatalf("system prompt missing persona, got %q", llm.lastMessages[0].Content)
	}
}

func TestSendMessage_CrossStudentLeakBlocked(t *testing.T) {
	t.Parallel()
	thread := domain.Thread{
		ID:        uuid.New(),
		StudentID: uuid.New(),
		PersonaID: uuid.New(),
	}
	uc := &SendMessage{
		Personas: &inMemPersonaRepo{},
		Threads:  &inMemThreadRepo{t: thread},
		Episodes: &inMemEpisodeRepo{},
		Facts:    &inMemFactRepo{},
		LLM:      &stubLLM{},
		Now:      func() time.Time { return time.Now() },
	}
	attacker := uuid.New()
	_, err := uc.Do(context.Background(), SendMessageInput{
		StudentID: attacker,
		ThreadID:  thread.ID,
		Content:   "hi",
	})
	if err == nil {
		t.Fatal("cross-student leak: want error, got nil")
	}
}
