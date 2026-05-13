package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"druz9/auth/domain"
	authmocks "druz9/auth/domain/mocks"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// fakeBus — тонкий tap по shared/domain.Bus интерфейсу (Publish/Subscribe). Используем
// именно его, а не mockgen-mock из shared/domain/mocks (того там нет, и shared/* не
// трогаем — boundary с Agent EEE), чтобы тесты могли проверять что событие действительно
// эмитнули. Это не stateful business mock, а простейший record-tap.
type fakeBus struct {
	mu     sync.Mutex
	events []sharedDomain.Event
}

func (b *fakeBus) Publish(_ context.Context, e sharedDomain.Event) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.events = append(b.events, e)
	return nil
}
func (b *fakeBus) Subscribe(string, sharedDomain.Handler) {}

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// codeStore — in-test закрытая state-машина для TelegramCodeRepo:
//
//	SetPending → Fill → Get(filled=true) → Delete (single-use).
//
// Реализация принципа Wave 13: вместо отдельного типа fakeCodes — closure-based
// state attached к gomock-mock через DoAndReturn. Возвращаем mock + struct, чтобы
// тесты могли проверять seen / deleted без приватных полей.
type codeStore struct {
	mu      sync.Mutex
	pending map[string]struct{}
	filled  map[string]domain.TelegramPayload
	deleted map[string]bool
}

func newCodeStore() *codeStore {
	return &codeStore{
		pending: map[string]struct{}{},
		filled:  map[string]domain.TelegramPayload{},
		deleted: map[string]bool{},
	}
}

// wireMockTelegramCodeRepo подключает state-машину codeStore к
// mocks.MockTelegramCodeRepo через DoAndReturn (AnyTimes), эмулируя
// Redis-репо с правилами: pending → can be filled → Get returns
// payload+filled, Delete снимает (single-use).
func wireMockTelegramCodeRepo(ctrl *gomock.Controller, store *codeStore) *authmocks.MockTelegramCodeRepo {
	m := authmocks.NewMockTelegramCodeRepo(ctrl)
	m.EXPECT().SetPending(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, code string) error {
			store.mu.Lock()
			defer store.mu.Unlock()
			if _, ok := store.pending[code]; ok {
				return domain.ErrCodeAlreadyExists
			}
			store.pending[code] = struct{}{}
			return nil
		},
	).AnyTimes()
	m.EXPECT().Fill(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, code string, p domain.TelegramPayload) error {
			store.mu.Lock()
			defer store.mu.Unlock()
			if _, ok := store.pending[code]; !ok {
				return domain.ErrCodeNotFound
			}
			store.filled[code] = p
			return nil
		},
	).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, code string) (domain.TelegramPayload, bool, error) {
			store.mu.Lock()
			defer store.mu.Unlock()
			if _, ok := store.pending[code]; !ok {
				return domain.TelegramPayload{}, false, domain.ErrCodeNotFound
			}
			if p, ok := store.filled[code]; ok {
				return p, true, nil
			}
			return domain.TelegramPayload{}, false, nil
		},
	).AnyTimes()
	m.EXPECT().Delete(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, code string) error {
			store.mu.Lock()
			defer store.mu.Unlock()
			delete(store.pending, code)
			delete(store.filled, code)
			store.deleted[code] = true
			return nil
		},
	).AnyTimes()
	return m
}

// wireMockRateLimiter — limiter с правилом «reject если key начинается с prefix».
// Это закрытый stateful behavior через DoAndReturn closure.
func wireMockRateLimiter(ctrl *gomock.Controller, rejectKeyPrefix string, retry int) *authmocks.MockRateLimiter {
	m := authmocks.NewMockRateLimiter(ctrl)
	m.EXPECT().Allow(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, key string, _ int, _ time.Duration) (int, int, error) {
			if rejectKeyPrefix != "" && strings.HasPrefix(key, rejectKeyPrefix) {
				return 0, retry, domain.ErrRateLimited
			}
			return 9, 0, nil
		},
	).AnyTimes()
	return m
}

// wireMockSessionsCreateOnly возвращает SessionRepo-mock, который только Create.
// Get/Delete не вызываются в poll-флоу.
func wireMockSessionsCreateOnly(ctrl *gomock.Controller, captured *[]domain.Session) *authmocks.MockSessionRepo {
	m := authmocks.NewMockSessionRepo(ctrl)
	m.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, s domain.Session) error {
			*captured = append(*captured, s)
			return nil
		},
	).AnyTimes()
	return m
}

// wireMockUsersUpsert привязывает behaviour: Upsert возвращает заданного юзера +
// created флаг + захватывает Input в captured.
func wireMockUsersUpsert(ctrl *gomock.Controller, user domain.User, created bool, captured *domain.UpsertOAuthInput, upsertErr error) *authmocks.MockUserRepo {
	m := authmocks.NewMockUserRepo(ctrl)
	m.EXPECT().UpsertByOAuth(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, in domain.UpsertOAuthInput) (domain.User, bool, error) {
			*captured = in
			if upsertErr != nil {
				return domain.User{}, false, upsertErr
			}
			return user, created, nil
		},
	).AnyTimes()
	return m
}

// ── StartTelegramCode ────────────────────────────────────────────────────

func TestStartTelegramCode_Happy(t *testing.T) {
	ctrl := gomock.NewController(t)
	store := newCodeStore()
	uc := &StartTelegramCode{
		Codes:   wireMockTelegramCodeRepo(ctrl, store),
		Limiter: wireMockRateLimiter(ctrl, "", 0),
		BotName: "druz9_bot",
		CodeTTL: 5 * time.Minute,
		Log:     quietLog(),
		Now:     func() time.Time { return time.Unix(1_700_000_000, 0).UTC() },
	}
	res, err := uc.Do(context.Background(), StartTelegramCodeInput{IP: "127.0.0.1"})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !domain.IsValidTelegramCode(res.Code) {
		t.Fatalf("invalid code returned: %q", res.Code)
	}
	want := "https://t.me/druz9_bot?start=" + res.Code
	if res.DeepLink != want {
		t.Fatalf("deep link %q, want %q", res.DeepLink, want)
	}
	if res.ExpiresAt.IsZero() {
		t.Fatal("ExpiresAt zero")
	}
	store.mu.Lock()
	_, ok := store.pending[res.Code]
	store.mu.Unlock()
	if !ok {
		t.Fatal("code not persisted")
	}
}

func TestStartTelegramCode_RateLimited(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := &StartTelegramCode{
		Codes:   wireMockTelegramCodeRepo(ctrl, newCodeStore()),
		Limiter: wireMockRateLimiter(ctrl, "rl:auth:tg:start:", 42),
		BotName: "druz9_bot",
		CodeTTL: time.Minute,
		Log:     quietLog(),
	}
	_, err := uc.Do(context.Background(), StartTelegramCodeInput{IP: "1.2.3.4"})
	var rl *RateLimitedError
	if !errors.As(err, &rl) {
		t.Fatalf("expected RateLimitedError, got %v", err)
	}
	if rl.RetryAfterSec != 42 {
		t.Fatalf("retry %d, want 42", rl.RetryAfterSec)
	}
}

func TestStartTelegramCode_NoBotName(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := &StartTelegramCode{
		Codes:   wireMockTelegramCodeRepo(ctrl, newCodeStore()),
		Limiter: wireMockRateLimiter(ctrl, "", 0),
		CodeTTL: time.Minute,
		Log:     quietLog(),
	}
	_, err := uc.Do(context.Background(), StartTelegramCodeInput{IP: "1.1.1.1"})
	if err == nil {
		t.Fatal("expected error for missing bot name")
	}
}

// ── PollTelegramCode ──────────────────────────────────────────────────────

// pollHarness packs all dependencies + capture buffers — позволяет тестам читать
// gotIn / sessions созданные / события без приватных полей.
type pollHarness struct {
	uc       *PollTelegramCode
	store    *codeStore
	gotIn    *domain.UpsertOAuthInput
	sessions *[]domain.Session
	bus      *fakeBus
}

func newPollHarness(t *testing.T, user domain.User, created bool) *pollHarness {
	t.Helper()
	ctrl := gomock.NewController(t)
	store := newCodeStore()
	gotIn := &domain.UpsertOAuthInput{}
	sessions := &[]domain.Session{}
	bus := &fakeBus{}
	return &pollHarness{
		uc: &PollTelegramCode{
			Codes:      wireMockTelegramCodeRepo(ctrl, store),
			Users:      wireMockUsersUpsert(ctrl, user, created, gotIn, nil),
			Sessions:   wireMockSessionsCreateOnly(ctrl, sessions),
			Limiter:    wireMockRateLimiter(ctrl, "", 0),
			Bus:        bus,
			Issuer:     NewTokenIssuer("test-secret-32-bytes-aaaaaaaaaaaaaaaa", time.Minute),
			RefreshTTL: 24 * time.Hour,
			Log:        quietLog(),
		},
		store:    store,
		gotIn:    gotIn,
		sessions: sessions,
		bus:      bus,
	}
}

func TestPollTelegramCode_Pending(t *testing.T) {
	h := newPollHarness(t, domain.User{}, false)
	c, _ := domain.GenerateTelegramCode()
	_ = h.uc.Codes.SetPending(context.Background(), c)
	_, err := h.uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"})
	if !errors.Is(err, domain.ErrCodePending) {
		t.Fatalf("expected ErrCodePending, got %v", err)
	}
}

func TestPollTelegramCode_NotFound(t *testing.T) {
	h := newPollHarness(t, domain.User{}, false)
	c, _ := domain.GenerateTelegramCode()
	_, err := h.uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"})
	if !errors.Is(err, domain.ErrCodeNotFound) {
		t.Fatalf("expected ErrCodeNotFound, got %v", err)
	}
}

func TestPollTelegramCode_BadCodeFormat(t *testing.T) {
	h := newPollHarness(t, domain.User{}, false)
	_, err := h.uc.Do(context.Background(), PollTelegramCodeInput{Code: "lower-case", IP: "1.1.1.1"})
	if err == nil {
		t.Fatal("expected error for bad code format")
	}
}

func TestPollTelegramCode_Authenticated(t *testing.T) {
	uid := uuid.New()
	h := newPollHarness(t, domain.User{ID: uid, Username: "serg", Role: enums.UserRoleUser}, true)
	c, _ := domain.GenerateTelegramCode()
	_ = h.uc.Codes.SetPending(context.Background(), c)
	_ = h.uc.Codes.Fill(context.Background(), c, domain.TelegramPayload{
		ID: 42, FirstName: "Sergey", Username: "serg", PhotoURL: "https://t.me/i/userpic/x.jpg", AuthDate: time.Now().Unix(),
	})

	res, err := h.uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1", UserAgent: "go-test"})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !res.IsNewUser {
		t.Fatal("expected IsNewUser=true")
	}
	if res.Tokens.AccessToken == "" {
		t.Fatal("empty access token")
	}
	h.store.mu.Lock()
	deleted := h.store.deleted[c]
	h.store.mu.Unlock()
	if !deleted {
		t.Fatal("code not deleted on success (single-use violated)")
	}
	if h.gotIn.AvatarURL != "https://t.me/i/userpic/x.jpg" {
		t.Fatalf("avatar url not propagated: %q", h.gotIn.AvatarURL)
	}
	if h.gotIn.Provider != enums.AuthProviderTelegram {
		t.Fatalf("provider %q want telegram", h.gotIn.Provider)
	}
}

func TestPollTelegramCode_DoublePoll_SecondTime410(t *testing.T) {
	uid := uuid.New()
	h := newPollHarness(t, domain.User{ID: uid, Username: "x", Role: enums.UserRoleUser}, false)
	c, _ := domain.GenerateTelegramCode()
	_ = h.uc.Codes.SetPending(context.Background(), c)
	_ = h.uc.Codes.Fill(context.Background(), c, domain.TelegramPayload{ID: 1, AuthDate: time.Now().Unix()})

	if _, err := h.uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"}); err != nil {
		t.Fatalf("first poll failed: %v", err)
	}
	_, err := h.uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"})
	if !errors.Is(err, domain.ErrCodeNotFound) {
		t.Fatalf("second poll: expected ErrCodeNotFound, got %v", err)
	}
}

// TestPollTelegramCode_AvatarNotPropagatedWhenEmpty verifies a Telegram payload
// without photo_url leaves UpsertOAuthInput.AvatarURL empty (so the Postgres
// UpdateUserAvatar query becomes a no-op — see auth.sql).
func TestPollTelegramCode_AvatarNotPropagatedWhenEmpty(t *testing.T) {
	h := newPollHarness(t, domain.User{ID: uuid.New(), Username: "x", Role: enums.UserRoleUser}, false)
	c, _ := domain.GenerateTelegramCode()
	_ = h.uc.Codes.SetPending(context.Background(), c)
	_ = h.uc.Codes.Fill(context.Background(), c, domain.TelegramPayload{
		ID: 1, FirstName: "X", AuthDate: time.Now().Unix(), // PhotoURL omitted
	})
	if _, err := h.uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if h.gotIn.AvatarURL != "" {
		t.Fatalf("avatar URL %q should be empty", h.gotIn.AvatarURL)
	}
}

// TestPollTelegramCode_DisplayNameComposed ensures First+Last are joined.
func TestPollTelegramCode_DisplayNameComposed(t *testing.T) {
	h := newPollHarness(t, domain.User{ID: uuid.New(), Username: "x", Role: enums.UserRoleUser}, false)
	c, _ := domain.GenerateTelegramCode()
	_ = h.uc.Codes.SetPending(context.Background(), c)
	_ = h.uc.Codes.Fill(context.Background(), c, domain.TelegramPayload{
		ID: 1, FirstName: "Sergey", LastName: "Smirnov", AuthDate: time.Now().Unix(),
	})
	if _, err := h.uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if h.gotIn.DisplayName != "Sergey Smirnov" {
		t.Fatalf("display name %q", h.gotIn.DisplayName)
	}
}

// TestPollTelegramCode_UsernameFallback covers tg_<id> fallback when the
// Telegram username is empty (private profile).
func TestPollTelegramCode_UsernameFallback(t *testing.T) {
	h := newPollHarness(t, domain.User{ID: uuid.New(), Username: "x", Role: enums.UserRoleUser}, false)
	c, _ := domain.GenerateTelegramCode()
	_ = h.uc.Codes.SetPending(context.Background(), c)
	_ = h.uc.Codes.Fill(context.Background(), c, domain.TelegramPayload{
		ID: 12345, AuthDate: time.Now().Unix(), // Username omitted
	})
	if _, err := h.uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if h.gotIn.UsernameHint != "tg_12345" {
		t.Fatalf("username hint %q want tg_12345", h.gotIn.UsernameHint)
	}
}

func TestPollTelegramCode_RateLimited(t *testing.T) {
	ctrl := gomock.NewController(t)
	store := newCodeStore()
	gotIn := &domain.UpsertOAuthInput{}
	sessions := &[]domain.Session{}
	bus := &fakeBus{}
	uc := &PollTelegramCode{
		Codes:      wireMockTelegramCodeRepo(ctrl, store),
		Users:      wireMockUsersUpsert(ctrl, domain.User{}, false, gotIn, nil),
		Sessions:   wireMockSessionsCreateOnly(ctrl, sessions),
		Limiter:    wireMockRateLimiter(ctrl, "rl:auth:tg:poll:", 7),
		Bus:        bus,
		Issuer:     NewTokenIssuer("test-secret-32-bytes-aaaaaaaaaaaaaaaa", time.Minute),
		RefreshTTL: time.Hour,
		Log:        quietLog(),
	}
	c, _ := domain.GenerateTelegramCode()
	_, err := uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"})
	var rl *RateLimitedError
	if !errors.As(err, &rl) {
		t.Fatalf("expected RateLimitedError, got %v", err)
	}
}
