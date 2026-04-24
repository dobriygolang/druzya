package app

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"druz9/auth/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ── фейки специфичные для Yandex-flow ─────────────────────────────────────

// fakeStates — in-memory реализация domain.OAuthStateStore. Повторный
// ConsumeState на один и тот же ключ возвращает ErrStateNotFound (одноразовость).
type fakeStates struct {
	mu      sync.Mutex
	data    map[string]string
	saveErr error
	getErr  error
}

func newFakeStates() *fakeStates { return &fakeStates{data: map[string]string{}} }

func (f *fakeStates) SaveState(_ context.Context, state, codeVerifier string, _ time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.saveErr != nil {
		return f.saveErr
	}
	f.data[state] = codeVerifier
	return nil
}

func (f *fakeStates) ConsumeState(_ context.Context, state string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.getErr != nil {
		return "", f.getErr
	}
	v, ok := f.data[state]
	if !ok {
		return "", domain.ErrStateNotFound
	}
	delete(f.data, state)
	return v, nil
}

type fakeYandexOAuth struct {
	tokenResp    YandexTokenResponse
	exchangeErr  error
	info         domain.YandexUserInfo
	infoErr      error
	gotCode      string
	gotVerifier  string
	exchangeHits int
}

func (f *fakeYandexOAuth) Exchange(_ context.Context, code, verifier string) (YandexTokenResponse, error) {
	f.exchangeHits++
	f.gotCode = code
	f.gotVerifier = verifier
	if f.exchangeErr != nil {
		return YandexTokenResponse{}, f.exchangeErr
	}
	return f.tokenResp, nil
}

func (f *fakeYandexOAuth) FetchUserInfo(_ context.Context, _ string) (domain.YandexUserInfo, error) {
	if f.infoErr != nil {
		return domain.YandexUserInfo{}, f.infoErr
	}
	return f.info, nil
}

type fakeEnc struct{}

func (fakeEnc) Encrypt(b []byte) ([]byte, error) { return append([]byte("enc:"), b...), nil }

// ── helpers ───────────────────────────────────────────────────────────────

func newLoginYandexUC(states domain.OAuthStateStore, oauth YandexOAuthClient, users *fakeUsers) *LoginYandex {
	return &LoginYandex{
		OAuth:      oauth,
		Users:      users,
		Sessions:   &fakeSessions{},
		Limiter:    &fakeLimiter{},
		Bus:        &fakeBus{},
		Issuer:     NewTokenIssuer("test-secret-32-bytes-aaaaaaaaaaaaaaaa", time.Minute),
		Enc:        fakeEnc{},
		States:     states,
		RefreshTTL: time.Hour,
		Log:        quietLog(),
	}
}

// ── LoginYandex ───────────────────────────────────────────────────────────

func TestLoginYandex_Happy(t *testing.T) {
	states := newFakeStates()
	const state = "state-aaa"
	const verifier = "verifier-xxx"
	_ = states.SaveState(context.Background(), state, verifier, time.Minute)

	oauth := &fakeYandexOAuth{
		tokenResp: YandexTokenResponse{AccessToken: "at", RefreshToken: "rt", ExpiresIn: 3600},
		info:      domain.YandexUserInfo{ID: "42", Login: "ivan", DisplayName: "Ivan", DefaultEmail: "ivan@ya.ru"},
	}
	users := &fakeUsers{created: true, user: domain.User{ID: uuid.New(), Username: "ivan", Email: "ivan@ya.ru", Role: enums.UserRoleUser}}
	uc := newLoginYandexUC(states, oauth, users)

	res, err := uc.Do(context.Background(), LoginYandexInput{Code: "code-123", State: state, IP: "1.1.1.1"})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if res.Tokens.AccessToken == "" {
		t.Fatal("empty access token")
	}
	if oauth.gotVerifier != verifier {
		t.Fatalf("verifier %q want %q", oauth.gotVerifier, verifier)
	}
	if oauth.gotCode != "code-123" {
		t.Fatalf("code %q want code-123", oauth.gotCode)
	}
	// State должен быть потреблён (one-shot).
	if _, ok := states.data[state]; ok {
		t.Fatal("state not consumed after success")
	}
}

func TestLoginYandex_InvalidState(t *testing.T) {
	states := newFakeStates() // пусто → state неизвестен
	oauth := &fakeYandexOAuth{}
	users := &fakeUsers{}
	uc := newLoginYandexUC(states, oauth, users)

	_, err := uc.Do(context.Background(), LoginYandexInput{Code: "c", State: "bogus", IP: "1.1.1.1"})
	if !errors.Is(err, ErrInvalidState) {
		t.Fatalf("expected ErrInvalidState, got %v", err)
	}
	if oauth.exchangeHits != 0 {
		t.Fatal("Exchange must NOT be called when state is invalid (anti-fallback)")
	}
}

func TestLoginYandex_EmptyState(t *testing.T) {
	states := newFakeStates()
	oauth := &fakeYandexOAuth{}
	users := &fakeUsers{}
	uc := newLoginYandexUC(states, oauth, users)

	_, err := uc.Do(context.Background(), LoginYandexInput{Code: "c", State: "", IP: "1.1.1.1"})
	if !errors.Is(err, ErrInvalidState) {
		t.Fatalf("expected ErrInvalidState for empty state, got %v", err)
	}
	if oauth.exchangeHits != 0 {
		t.Fatal("Exchange called on empty state — anti-fallback violated")
	}
}

func TestLoginYandex_StateReplay(t *testing.T) {
	states := newFakeStates()
	const state = "state-once"
	_ = states.SaveState(context.Background(), state, "v", time.Minute)

	oauth := &fakeYandexOAuth{
		tokenResp: YandexTokenResponse{AccessToken: "at", RefreshToken: "rt"},
		info:      domain.YandexUserInfo{ID: "1"},
	}
	users := &fakeUsers{user: domain.User{ID: uuid.New(), Username: "x", Role: enums.UserRoleUser}}
	uc := newLoginYandexUC(states, oauth, users)

	// Первый callback — успех.
	if _, err := uc.Do(context.Background(), LoginYandexInput{Code: "c", State: state, IP: "1.1.1.1"}); err != nil {
		t.Fatalf("first call: %v", err)
	}
	// Второй с тем же state — отказ (replay защищён GETDEL'ом).
	_, err := uc.Do(context.Background(), LoginYandexInput{Code: "c", State: state, IP: "1.1.1.1"})
	if !errors.Is(err, ErrInvalidState) {
		t.Fatalf("expected ErrInvalidState on replay, got %v", err)
	}
}

func TestLoginYandex_RateLimited(t *testing.T) {
	states := newFakeStates()
	uc := newLoginYandexUC(states, &fakeYandexOAuth{}, &fakeUsers{})
	uc.Limiter = &fakeLimiter{rejectKeyPrefix: "rl:auth:yandex:", retry: 5}

	_, err := uc.Do(context.Background(), LoginYandexInput{Code: "c", State: "s", IP: "1.1.1.1"})
	var rl *RateLimitedError
	if !errors.As(err, &rl) {
		t.Fatalf("expected RateLimitedError, got %v", err)
	}
}

// ── StartLoginYandex ──────────────────────────────────────────────────────

func TestStartLoginYandex_Happy(t *testing.T) {
	states := newFakeStates()
	uc := &StartLoginYandex{
		ClientID:     "client-id-42",
		AuthorizeURL: "https://oauth.yandex.ru/authorize",
		States:       states,
		Limiter:      &fakeLimiter{},
		TTL:          time.Minute,
		Log:          quietLog(),
	}
	res, err := uc.Do(context.Background(), StartLoginYandexInput{
		RedirectURI: "https://app.druz9.ru/auth/callback/yandex",
		IP:          "1.2.3.4",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if res.State == "" {
		t.Fatal("empty state")
	}
	verifier, ok := states.data[res.State]
	if !ok {
		t.Fatal("state not persisted in store")
	}

	u, err := url.Parse(res.AuthorizeURL)
	if err != nil {
		t.Fatalf("authorize URL parse: %v", err)
	}
	q := u.Query()
	if q.Get("response_type") != "code" {
		t.Fatalf("response_type=%q", q.Get("response_type"))
	}
	if q.Get("client_id") != "client-id-42" {
		t.Fatalf("client_id=%q", q.Get("client_id"))
	}
	if q.Get("state") != res.State {
		t.Fatal("state in URL differs from returned state")
	}
	if q.Get("code_challenge_method") != "S256" {
		t.Fatalf("code_challenge_method=%q", q.Get("code_challenge_method"))
	}
	// Challenge должен совпасть с SHA256(verifier) в base64url без padding.
	sum := sha256.Sum256([]byte(verifier))
	want := base64.RawURLEncoding.EncodeToString(sum[:])
	if q.Get("code_challenge") != want {
		t.Fatalf("code_challenge mismatch: got %q want %q", q.Get("code_challenge"), want)
	}
	if strings.HasSuffix(q.Get("code_challenge"), "=") {
		t.Fatal("code_challenge must be base64url without padding")
	}
	if q.Get("redirect_uri") != "https://app.druz9.ru/auth/callback/yandex" {
		t.Fatalf("redirect_uri=%q", q.Get("redirect_uri"))
	}
}

func TestStartLoginYandex_NoClientID(t *testing.T) {
	uc := &StartLoginYandex{States: newFakeStates(), Limiter: &fakeLimiter{}, Log: quietLog()}
	_, err := uc.Do(context.Background(), StartLoginYandexInput{IP: "1.1.1.1"})
	if err == nil {
		t.Fatal("expected error for missing client_id")
	}
}

func TestStartLoginYandex_RateLimited(t *testing.T) {
	uc := &StartLoginYandex{
		ClientID: "cid",
		States:   newFakeStates(),
		Limiter:  &fakeLimiter{rejectKeyPrefix: "rl:auth:yandex:start:", retry: 11},
		TTL:      time.Minute,
		Log:      quietLog(),
	}
	_, err := uc.Do(context.Background(), StartLoginYandexInput{IP: "9.9.9.9"})
	var rl *RateLimitedError
	if !errors.As(err, &rl) {
		t.Fatalf("expected RateLimitedError, got %v", err)
	}
	if rl.RetryAfterSec != 11 {
		t.Fatalf("retry %d want 11", rl.RetryAfterSec)
	}
}
