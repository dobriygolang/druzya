package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"druz9/auth/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ── fakes ─────────────────────────────────────────────────────────────────

type fakeCodes struct {
	mu      sync.Mutex
	pending map[string]struct{}
	filled  map[string]domain.TelegramPayload
	deleted map[string]bool
	setErr  error
	fillErr error
	getErr  error
	delErr  error
}

func newFakeCodes() *fakeCodes {
	return &fakeCodes{
		pending: map[string]struct{}{},
		filled:  map[string]domain.TelegramPayload{},
		deleted: map[string]bool{},
	}
}

func (f *fakeCodes) SetPending(_ context.Context, code string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.setErr != nil {
		return f.setErr
	}
	if _, ok := f.pending[code]; ok {
		return domain.ErrCodeAlreadyExists
	}
	f.pending[code] = struct{}{}
	return nil
}

func (f *fakeCodes) Fill(_ context.Context, code string, p domain.TelegramPayload) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fillErr != nil {
		return f.fillErr
	}
	if _, ok := f.pending[code]; !ok {
		return domain.ErrCodeNotFound
	}
	f.filled[code] = p
	return nil
}

func (f *fakeCodes) Get(_ context.Context, code string) (domain.TelegramPayload, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.getErr != nil {
		return domain.TelegramPayload{}, false, f.getErr
	}
	if _, ok := f.pending[code]; !ok {
		return domain.TelegramPayload{}, false, domain.ErrCodeNotFound
	}
	if p, ok := f.filled[code]; ok {
		return p, true, nil
	}
	return domain.TelegramPayload{}, false, nil
}

func (f *fakeCodes) Delete(_ context.Context, code string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.delErr != nil {
		return f.delErr
	}
	delete(f.pending, code)
	delete(f.filled, code)
	f.deleted[code] = true
	return nil
}

type fakeLimiter struct {
	rejectKeyPrefix string
	retry           int
}

func (f *fakeLimiter) Allow(_ context.Context, key string, _ int, _ time.Duration) (int, int, error) {
	if f.rejectKeyPrefix != "" && len(key) >= len(f.rejectKeyPrefix) && key[:len(f.rejectKeyPrefix)] == f.rejectKeyPrefix {
		return 0, f.retry, domain.ErrRateLimited
	}
	return 9, 0, nil
}

type fakeUsers struct {
	created bool
	user    domain.User
	err     error
	gotIn   domain.UpsertOAuthInput
}

func (f *fakeUsers) UpsertByOAuth(_ context.Context, in domain.UpsertOAuthInput) (domain.User, bool, error) {
	f.gotIn = in
	if f.err != nil {
		return domain.User{}, false, f.err
	}
	return f.user, f.created, nil
}
func (f *fakeUsers) FindByID(context.Context, uuid.UUID) (domain.User, error) {
	return domain.User{}, nil
}
func (f *fakeUsers) FindByUsername(context.Context, string) (domain.User, error) {
	return domain.User{}, nil
}

type fakeSessions struct{ created []domain.Session }

func (f *fakeSessions) Create(_ context.Context, s domain.Session) error {
	f.created = append(f.created, s)
	return nil
}
func (f *fakeSessions) Get(context.Context, uuid.UUID) (domain.Session, error) {
	return domain.Session{}, nil
}
func (f *fakeSessions) Delete(context.Context, uuid.UUID) error { return nil }

type fakeBus struct{ events []sharedDomain.Event }

func (b *fakeBus) Publish(_ context.Context, e sharedDomain.Event) error {
	b.events = append(b.events, e)
	return nil
}
func (b *fakeBus) Subscribe(string, sharedDomain.Handler) {}

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// ── StartTelegramCode ────────────────────────────────────────────────────

func TestStartTelegramCode_Happy(t *testing.T) {
	codes := newFakeCodes()
	uc := &StartTelegramCode{
		Codes:   codes,
		Limiter: &fakeLimiter{},
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
	if _, ok := codes.pending[res.Code]; !ok {
		t.Fatal("code not persisted")
	}
}

func TestStartTelegramCode_RateLimited(t *testing.T) {
	uc := &StartTelegramCode{
		Codes:   newFakeCodes(),
		Limiter: &fakeLimiter{rejectKeyPrefix: "rl:auth:tg:start:", retry: 42},
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
	uc := &StartTelegramCode{Codes: newFakeCodes(), Limiter: &fakeLimiter{}, CodeTTL: time.Minute, Log: quietLog()}
	_, err := uc.Do(context.Background(), StartTelegramCodeInput{IP: "1.1.1.1"})
	if err == nil {
		t.Fatal("expected error for missing bot name")
	}
}

// ── PollTelegramCode ──────────────────────────────────────────────────────

func newPollUC(codes domain.TelegramCodeRepo, users *fakeUsers, sess *fakeSessions, bus *fakeBus) *PollTelegramCode {
	return &PollTelegramCode{
		Codes:      codes,
		Users:      users,
		Sessions:   sess,
		Limiter:    &fakeLimiter{},
		Bus:        bus,
		Issuer:     NewTokenIssuer("test-secret-32-bytes-aaaaaaaaaaaaaaaa", time.Minute),
		RefreshTTL: 24 * time.Hour,
		Log:        quietLog(),
	}
}

func TestPollTelegramCode_Pending(t *testing.T) {
	codes := newFakeCodes()
	c, _ := domain.GenerateTelegramCode()
	_ = codes.SetPending(context.Background(), c)
	uc := newPollUC(codes, &fakeUsers{}, &fakeSessions{}, &fakeBus{})
	_, err := uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"})
	if !errors.Is(err, domain.ErrCodePending) {
		t.Fatalf("expected ErrCodePending, got %v", err)
	}
}

func TestPollTelegramCode_NotFound(t *testing.T) {
	codes := newFakeCodes()
	c, _ := domain.GenerateTelegramCode()
	uc := newPollUC(codes, &fakeUsers{}, &fakeSessions{}, &fakeBus{})
	_, err := uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"})
	if !errors.Is(err, domain.ErrCodeNotFound) {
		t.Fatalf("expected ErrCodeNotFound, got %v", err)
	}
}

func TestPollTelegramCode_BadCodeFormat(t *testing.T) {
	uc := newPollUC(newFakeCodes(), &fakeUsers{}, &fakeSessions{}, &fakeBus{})
	_, err := uc.Do(context.Background(), PollTelegramCodeInput{Code: "lower-case", IP: "1.1.1.1"})
	if err == nil {
		t.Fatal("expected error for bad code format")
	}
}

func TestPollTelegramCode_Authenticated(t *testing.T) {
	codes := newFakeCodes()
	c, _ := domain.GenerateTelegramCode()
	_ = codes.SetPending(context.Background(), c)
	_ = codes.Fill(context.Background(), c, domain.TelegramPayload{
		ID: 42, FirstName: "Sergey", Username: "serg", PhotoURL: "https://t.me/i/userpic/x.jpg", AuthDate: time.Now().Unix(),
	})
	uid := uuid.New()
	users := &fakeUsers{created: true, user: domain.User{ID: uid, Username: "serg", Role: enums.UserRoleUser}}
	sess := &fakeSessions{}
	bus := &fakeBus{}
	uc := newPollUC(codes, users, sess, bus)

	res, err := uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1", UserAgent: "go-test"})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !res.IsNewUser {
		t.Fatal("expected IsNewUser=true")
	}
	if res.Tokens.AccessToken == "" {
		t.Fatal("empty access token")
	}
	if !codes.deleted[c] {
		t.Fatal("code not deleted on success (single-use violated)")
	}
	if users.gotIn.AvatarURL != "https://t.me/i/userpic/x.jpg" {
		t.Fatalf("avatar url not propagated: %q", users.gotIn.AvatarURL)
	}
	if users.gotIn.Provider != enums.AuthProviderTelegram {
		t.Fatalf("provider %q want telegram", users.gotIn.Provider)
	}
}

func TestPollTelegramCode_DoublePoll_SecondTime410(t *testing.T) {
	codes := newFakeCodes()
	c, _ := domain.GenerateTelegramCode()
	_ = codes.SetPending(context.Background(), c)
	_ = codes.Fill(context.Background(), c, domain.TelegramPayload{ID: 1, AuthDate: time.Now().Unix()})
	uid := uuid.New()
	users := &fakeUsers{user: domain.User{ID: uid, Username: "x", Role: enums.UserRoleUser}}
	uc := newPollUC(codes, users, &fakeSessions{}, &fakeBus{})

	if _, err := uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"}); err != nil {
		t.Fatalf("first poll failed: %v", err)
	}
	_, err := uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"})
	if !errors.Is(err, domain.ErrCodeNotFound) {
		t.Fatalf("second poll: expected ErrCodeNotFound, got %v", err)
	}
}

// TestPollTelegramCode_AvatarNotPropagatedWhenEmpty verifies a Telegram payload
// without photo_url leaves UpsertOAuthInput.AvatarURL empty (so the Postgres
// UpdateUserAvatar query becomes a no-op — see auth.sql).
func TestPollTelegramCode_AvatarNotPropagatedWhenEmpty(t *testing.T) {
	codes := newFakeCodes()
	c, _ := domain.GenerateTelegramCode()
	_ = codes.SetPending(context.Background(), c)
	_ = codes.Fill(context.Background(), c, domain.TelegramPayload{
		ID: 1, FirstName: "X", AuthDate: time.Now().Unix(), // PhotoURL omitted
	})
	users := &fakeUsers{user: domain.User{ID: uuid.New(), Username: "x", Role: enums.UserRoleUser}}
	uc := newPollUC(codes, users, &fakeSessions{}, &fakeBus{})
	if _, err := uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if users.gotIn.AvatarURL != "" {
		t.Fatalf("avatar URL %q should be empty", users.gotIn.AvatarURL)
	}
}

// TestPollTelegramCode_DisplayNameComposed ensures First+Last are joined.
func TestPollTelegramCode_DisplayNameComposed(t *testing.T) {
	codes := newFakeCodes()
	c, _ := domain.GenerateTelegramCode()
	_ = codes.SetPending(context.Background(), c)
	_ = codes.Fill(context.Background(), c, domain.TelegramPayload{
		ID: 1, FirstName: "Sergey", LastName: "Smirnov", AuthDate: time.Now().Unix(),
	})
	users := &fakeUsers{user: domain.User{ID: uuid.New(), Username: "x", Role: enums.UserRoleUser}}
	uc := newPollUC(codes, users, &fakeSessions{}, &fakeBus{})
	if _, err := uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if users.gotIn.DisplayName != "Sergey Smirnov" {
		t.Fatalf("display name %q", users.gotIn.DisplayName)
	}
}

// TestPollTelegramCode_UsernameFallback covers tg_<id> fallback when the
// Telegram username is empty (private profile).
func TestPollTelegramCode_UsernameFallback(t *testing.T) {
	codes := newFakeCodes()
	c, _ := domain.GenerateTelegramCode()
	_ = codes.SetPending(context.Background(), c)
	_ = codes.Fill(context.Background(), c, domain.TelegramPayload{
		ID: 12345, AuthDate: time.Now().Unix(), // Username omitted
	})
	users := &fakeUsers{user: domain.User{ID: uuid.New(), Username: "x", Role: enums.UserRoleUser}}
	uc := newPollUC(codes, users, &fakeSessions{}, &fakeBus{})
	if _, err := uc.Do(context.Background(), PollTelegramCodeInput{Code: c, IP: "1.1.1.1"}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if users.gotIn.UsernameHint != "tg_12345" {
		t.Fatalf("username hint %q want tg_12345", users.gotIn.UsernameHint)
	}
}

func TestPollTelegramCode_RateLimited(t *testing.T) {
	uc := &PollTelegramCode{
		Codes:      newFakeCodes(),
		Users:      &fakeUsers{},
		Sessions:   &fakeSessions{},
		Limiter:    &fakeLimiter{rejectKeyPrefix: "rl:auth:tg:poll:", retry: 7},
		Bus:        &fakeBus{},
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
