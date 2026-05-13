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
	authmocks "druz9/auth/domain/mocks"
	appmocks "druz9/auth/app/mocks"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ── stateStore ────────────────────────────────────────────────────────────
//
// In-test state-machine для domain.OAuthStateStore, аналог codeStore — ровно
// один цикл Save → Consume. Повторный ConsumeState возвращает
// ErrStateNotFound (one-shot anti-replay). Подключается к
// mocks.MockOAuthStateStore через DoAndReturn.

type stateStore struct {
	mu   sync.Mutex
	data map[string]string
}

func newStateStore() *stateStore { return &stateStore{data: map[string]string{}} }

func wireMockOAuthStateStore(ctrl *gomock.Controller, store *stateStore) *authmocks.MockOAuthStateStore {
	m := authmocks.NewMockOAuthStateStore(ctrl)
	m.EXPECT().SaveState(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, state, codeVerifier string, _ time.Duration) error {
			store.mu.Lock()
			defer store.mu.Unlock()
			store.data[state] = codeVerifier
			return nil
		},
	).AnyTimes()
	m.EXPECT().ConsumeState(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, state string) (string, error) {
			store.mu.Lock()
			defer store.mu.Unlock()
			v, ok := store.data[state]
			if !ok {
				return "", domain.ErrStateNotFound
			}
			delete(store.data, state)
			return v, nil
		},
	).AnyTimes()
	return m
}

// wireMockYandexOAuth — поведенческий mock с захватом аргументов Exchange.
type yandexCalls struct {
	exchangeHits int
	gotCode      string
	gotVerifier  string
}

func wireMockYandexOAuth(ctrl *gomock.Controller, tokenResp domain.YandexTokenResponse, exchangeErr error, info domain.YandexUserInfo, infoErr error, calls *yandexCalls) *appmocks.MockYandexOAuthClient {
	m := appmocks.NewMockYandexOAuthClient(ctrl)
	m.EXPECT().Exchange(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, code, verifier string) (domain.YandexTokenResponse, error) {
			calls.exchangeHits++
			calls.gotCode = code
			calls.gotVerifier = verifier
			if exchangeErr != nil {
				return domain.YandexTokenResponse{}, exchangeErr
			}
			return tokenResp, nil
		},
	).AnyTimes()
	m.EXPECT().FetchUserInfo(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ string) (domain.YandexUserInfo, error) {
			if infoErr != nil {
				return domain.YandexUserInfo{}, infoErr
			}
			return info, nil
		},
	).AnyTimes()
	return m
}

// wireMockEnc — encrypt = prepend "enc:".
func wireMockEnc(ctrl *gomock.Controller) *appmocks.MockTokenEncryptor {
	m := appmocks.NewMockTokenEncryptor(ctrl)
	m.EXPECT().Encrypt(gomock.Any()).DoAndReturn(
		func(b []byte) ([]byte, error) {
			return append([]byte("enc:"), b...), nil
		},
	).AnyTimes()
	return m
}

// ── helpers ───────────────────────────────────────────────────────────────

// loginYandexHarness — wraps everything для readable yandex-tests.
type loginYandexHarness struct {
	uc      *LoginYandex
	states  *stateStore
	calls   *yandexCalls
	gotIn   *domain.UpsertOAuthInput
	bus     *fakeBus
}

func newLoginYandexUC(t *testing.T, user domain.User, created bool, tokenResp domain.YandexTokenResponse, info domain.YandexUserInfo) *loginYandexHarness {
	t.Helper()
	ctrl := gomock.NewController(t)
	store := newStateStore()
	calls := &yandexCalls{}
	gotIn := &domain.UpsertOAuthInput{}
	sessions := &[]domain.Session{}
	bus := &fakeBus{}
	return &loginYandexHarness{
		uc: &LoginYandex{
			OAuth:      wireMockYandexOAuth(ctrl, tokenResp, nil, info, nil, calls),
			Users:      wireMockUsersUpsert(ctrl, user, created, gotIn, nil),
			Sessions:   wireMockSessionsCreateOnly(ctrl, sessions),
			Limiter:    wireMockRateLimiter(ctrl, "", 0),
			Bus:        bus,
			Issuer:     NewTokenIssuer("test-secret-32-bytes-aaaaaaaaaaaaaaaa", time.Minute),
			Enc:        wireMockEnc(ctrl),
			States:     wireMockOAuthStateStore(ctrl, store),
			RefreshTTL: time.Hour,
			Log:        quietLog(),
		},
		states: store,
		calls:  calls,
		gotIn:  gotIn,
		bus:    bus,
	}
}

// ── LoginYandex ───────────────────────────────────────────────────────────

func TestLoginYandex_Happy(t *testing.T) {
	const state = "state-aaa"
	const verifier = "verifier-xxx"

	h := newLoginYandexUC(t,
		domain.User{ID: uuid.New(), Username: "ivan", Role: enums.UserRoleUser},
		true,
		domain.YandexTokenResponse{AccessToken: "at", RefreshToken: "rt", ExpiresIn: 3600},
		domain.YandexUserInfo{ID: "42", Login: "ivan", DisplayName: "Ivan"},
	)
	_ = h.uc.States.SaveState(context.Background(), state, verifier, time.Minute)

	res, err := h.uc.Do(context.Background(), LoginYandexInput{Code: "code-123", State: state, IP: "1.1.1.1"})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if res.Tokens.AccessToken == "" {
		t.Fatal("empty access token")
	}
	if h.calls.gotVerifier != verifier {
		t.Fatalf("verifier %q want %q", h.calls.gotVerifier, verifier)
	}
	if h.calls.gotCode != "code-123" {
		t.Fatalf("code %q want code-123", h.calls.gotCode)
	}
	// State должен быть потреблён (one-shot).
	h.states.mu.Lock()
	_, ok := h.states.data[state]
	h.states.mu.Unlock()
	if ok {
		t.Fatal("state not consumed after success")
	}
}

func TestLoginYandex_InvalidState(t *testing.T) {
	h := newLoginYandexUC(t, domain.User{}, false, domain.YandexTokenResponse{}, domain.YandexUserInfo{})
	// states пустой — state «bogus» неизвестен.

	_, err := h.uc.Do(context.Background(), LoginYandexInput{Code: "c", State: "bogus", IP: "1.1.1.1"})
	if !errors.Is(err, ErrInvalidState) {
		t.Fatalf("expected ErrInvalidState, got %v", err)
	}
	if h.calls.exchangeHits != 0 {
		t.Fatal("Exchange must NOT be called when state is invalid (anti-fallback)")
	}
}

func TestLoginYandex_EmptyState(t *testing.T) {
	h := newLoginYandexUC(t, domain.User{}, false, domain.YandexTokenResponse{}, domain.YandexUserInfo{})

	_, err := h.uc.Do(context.Background(), LoginYandexInput{Code: "c", State: "", IP: "1.1.1.1"})
	if !errors.Is(err, ErrInvalidState) {
		t.Fatalf("expected ErrInvalidState for empty state, got %v", err)
	}
	if h.calls.exchangeHits != 0 {
		t.Fatal("Exchange called on empty state — anti-fallback violated")
	}
}

func TestLoginYandex_StateReplay(t *testing.T) {
	const state = "state-once"
	h := newLoginYandexUC(t,
		domain.User{ID: uuid.New(), Username: "x", Role: enums.UserRoleUser},
		false,
		domain.YandexTokenResponse{AccessToken: "at", RefreshToken: "rt"},
		domain.YandexUserInfo{ID: "1"},
	)
	_ = h.uc.States.SaveState(context.Background(), state, "v", time.Minute)

	// Первый callback — успех.
	if _, err := h.uc.Do(context.Background(), LoginYandexInput{Code: "c", State: state, IP: "1.1.1.1"}); err != nil {
		t.Fatalf("first call: %v", err)
	}
	// Второй с тем же state — отказ (replay защищён GETDEL'ом).
	_, err := h.uc.Do(context.Background(), LoginYandexInput{Code: "c", State: state, IP: "1.1.1.1"})
	if !errors.Is(err, ErrInvalidState) {
		t.Fatalf("expected ErrInvalidState on replay, got %v", err)
	}
}

func TestLoginYandex_RateLimited(t *testing.T) {
	ctrl := gomock.NewController(t)
	store := newStateStore()
	calls := &yandexCalls{}
	gotIn := &domain.UpsertOAuthInput{}
	sessions := &[]domain.Session{}
	uc := &LoginYandex{
		OAuth:      wireMockYandexOAuth(ctrl, domain.YandexTokenResponse{}, nil, domain.YandexUserInfo{}, nil, calls),
		Users:      wireMockUsersUpsert(ctrl, domain.User{}, false, gotIn, nil),
		Sessions:   wireMockSessionsCreateOnly(ctrl, sessions),
		Limiter:    wireMockRateLimiter(ctrl, "rl:auth:yandex:", 5),
		Bus:        &fakeBus{},
		Issuer:     NewTokenIssuer("test-secret-32-bytes-aaaaaaaaaaaaaaaa", time.Minute),
		Enc:        wireMockEnc(ctrl),
		States:     wireMockOAuthStateStore(ctrl, store),
		RefreshTTL: time.Hour,
		Log:        quietLog(),
	}
	_, err := uc.Do(context.Background(), LoginYandexInput{Code: "c", State: "s", IP: "1.1.1.1"})
	var rl *RateLimitedError
	if !errors.As(err, &rl) {
		t.Fatalf("expected RateLimitedError, got %v", err)
	}
}

// ── StartLoginYandex ──────────────────────────────────────────────────────

func TestStartLoginYandex_Happy(t *testing.T) {
	ctrl := gomock.NewController(t)
	store := newStateStore()
	uc := &StartLoginYandex{
		ClientID:     "client-id-42",
		AuthorizeURL: "https://oauth.yandex.ru/authorize",
		States:       wireMockOAuthStateStore(ctrl, store),
		Limiter:      wireMockRateLimiter(ctrl, "", 0),
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
	store.mu.Lock()
	verifier, ok := store.data[res.State]
	store.mu.Unlock()
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
	ctrl := gomock.NewController(t)
	store := newStateStore()
	uc := &StartLoginYandex{
		States:  wireMockOAuthStateStore(ctrl, store),
		Limiter: wireMockRateLimiter(ctrl, "", 0),
		Log:     quietLog(),
	}
	_, err := uc.Do(context.Background(), StartLoginYandexInput{IP: "1.1.1.1"})
	if err == nil {
		t.Fatal("expected error for missing client_id")
	}
}

func TestStartLoginYandex_RateLimited(t *testing.T) {
	ctrl := gomock.NewController(t)
	store := newStateStore()
	uc := &StartLoginYandex{
		ClientID: "cid",
		States:   wireMockOAuthStateStore(ctrl, store),
		Limiter:  wireMockRateLimiter(ctrl, "rl:auth:yandex:start:", 11),
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
