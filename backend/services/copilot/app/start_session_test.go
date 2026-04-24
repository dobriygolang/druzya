package app

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// fakeStartSessions — минимальная реализация SessionRepo для теста.
// Остальные методы panic-ят: если тест их вдруг позовёт, узнаем громко.
type fakeStartSessions struct {
	created int64
}

func (f *fakeStartSessions) Create(_ context.Context, userID uuid.UUID, kind domain.SessionKind) (domain.Session, error) {
	atomic.AddInt64(&f.created, 1)
	return domain.Session{ID: uuid.New(), UserID: userID, Kind: kind}, nil
}
func (f *fakeStartSessions) Get(context.Context, uuid.UUID) (domain.Session, error) {
	panic("unexpected Get")
}
func (f *fakeStartSessions) GetLive(context.Context, uuid.UUID) (domain.Session, error) {
	panic("unexpected GetLive")
}
func (f *fakeStartSessions) End(context.Context, uuid.UUID, uuid.UUID) error { panic("unexpected End") }
func (f *fakeStartSessions) MarkByok(context.Context, uuid.UUID) error       { panic("unexpected MarkByok") }
func (f *fakeStartSessions) ListForUser(
	context.Context, uuid.UUID, domain.SessionKind, domain.Cursor, int,
) ([]domain.SessionSummary, domain.Cursor, error) {
	panic("unexpected ListForUser")
}
func (f *fakeStartSessions) AttachConversation(context.Context, uuid.UUID, uuid.UUID) error {
	panic("unexpected AttachConversation")
}
func (f *fakeStartSessions) ListConversations(context.Context, uuid.UUID) ([]domain.Conversation, error) {
	panic("unexpected ListConversations")
}
func (f *fakeStartSessions) AttachDocument(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	panic("unexpected AttachDocument")
}
func (f *fakeStartSessions) DetachDocument(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	panic("unexpected DetachDocument")
}

// inMemoryLimiter — лимитер с фиксированным порогом и счётчиком на ключ.
// 11-й вызов (при limit=10) возвращает ErrRateLimited.
type inMemoryLimiter struct {
	limit  int
	counts map[string]int
}

func newInMemoryLimiter(limit int) *inMemoryLimiter {
	return &inMemoryLimiter{limit: limit, counts: map[string]int{}}
}

func (l *inMemoryLimiter) Allow(_ context.Context, key string, limit int, _ time.Duration) (int, int, error) {
	l.counts[key]++
	if l.counts[key] > limit {
		return 0, 60, domain.ErrRateLimited
	}
	return limit - l.counts[key], 0, nil
}

// TestStartSession_RateLimited — 11-й старт подряд для одного юзера падает
// в ErrRateLimited; 10 первых проходят.
func TestStartSession_RateLimited(t *testing.T) {
	sessions := &fakeStartSessions{}
	limiter := newInMemoryLimiter(10)
	uc := &StartSession{Sessions: sessions, Limiter: limiter}

	uid := uuid.New()
	for i := 0; i < 10; i++ {
		if _, err := uc.Do(context.Background(), StartSessionInput{
			UserID: uid, Kind: domain.SessionKindInterview,
		}); err != nil {
			t.Fatalf("call %d: unexpected err %v", i+1, err)
		}
	}
	_, err := uc.Do(context.Background(), StartSessionInput{
		UserID: uid, Kind: domain.SessionKindInterview,
	})
	if !errors.Is(err, domain.ErrRateLimited) {
		t.Fatalf("expected ErrRateLimited on 11th call, got %v", err)
	}
	if got := atomic.LoadInt64(&sessions.created); got != 10 {
		t.Fatalf("Create calls=%d, want 10 (лимит пропустил только первые 10)", got)
	}
}

// TestStartSession_RateLimitPerUser — лимит считается per-user, а не per-IP
// или глобально: второй юзер стартует успешно даже после того, как первый
// выбрал квоту.
func TestStartSession_RateLimitPerUser(t *testing.T) {
	sessions := &fakeStartSessions{}
	limiter := newInMemoryLimiter(10)
	uc := &StartSession{Sessions: sessions, Limiter: limiter}

	alice := uuid.New()
	bob := uuid.New()

	// Alice исчерпывает квоту.
	for i := 0; i < 10; i++ {
		if _, err := uc.Do(context.Background(), StartSessionInput{
			UserID: alice, Kind: domain.SessionKindInterview,
		}); err != nil {
			t.Fatalf("alice call %d: %v", i+1, err)
		}
	}
	if _, err := uc.Do(context.Background(), StartSessionInput{
		UserID: alice, Kind: domain.SessionKindInterview,
	}); !errors.Is(err, domain.ErrRateLimited) {
		t.Fatalf("alice 11th: expected ErrRateLimited, got %v", err)
	}

	// Боб — с чистого листа, ему лимит Alice не касается.
	if _, err := uc.Do(context.Background(), StartSessionInput{
		UserID: bob, Kind: domain.SessionKindInterview,
	}); err != nil {
		t.Fatalf("bob first call got %v", err)
	}
}

// TestStartSession_NoLimiter — use case работает и без limiter'а (nil-safe).
// Нужен для совместимости с тестами, которые limiter не создают.
func TestStartSession_NoLimiter(t *testing.T) {
	sessions := &fakeStartSessions{}
	uc := &StartSession{Sessions: sessions /* Limiter nil */}
	if _, err := uc.Do(context.Background(), StartSessionInput{
		UserID: uuid.New(), Kind: domain.SessionKindInterview,
	}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}
