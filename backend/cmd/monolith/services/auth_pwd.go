// Package services — email/password auth wiring.
//
// The auth domain ships with OAuth-only login flows (Yandex / Telegram)
// driven by Connect-RPC + proto. Adding email+password through the same
// pipeline would require a proto change and codegen — instead, this file
// exposes two plain chi REST endpoints that share the existing primitives:
//
//	POST /api/v1/auth/register
//	POST /api/v1/auth/login
//
// Both:
//   - normalise email to lower-case (case-insensitive lookup),
//   - validate basic shape (regexp + min length),
//   - use bcrypt cost=10 for password_hash (matches the column added in
//     migration 00001_init_core.sql),
//   - persist a refresh session via the same Redis SessionRepo and mint a
//     JWT access token via the shared TokenIssuer,
//   - write the refresh cookie on the same path/secure flags as the
//     OAuth flows do (see auth/ports/server.go).
//
// Errors return JSON `{error: {code, message}}` with proper HTTP codes.
package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	authApp "druz9/auth/app"
	authDomain "druz9/auth/domain"
	authInfra "druz9/auth/infra"
	"druz9/shared/enums"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// emailRe — pragmatic shape check; full RFC 5322 is not the goal.
var emailRe = regexp.MustCompile(`^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$`)

const (
	minPasswordLen = 8
	bcryptCost     = 10
)

// NewAuthPassword returns a Module that mounts the two REST endpoints.
// It piggybacks on AuthModule for the JWT issuer + Redis session store +
// refresh-cookie configuration.
func NewAuthPassword(d Deps, am *AuthModule, secureCookies bool, cookieDomain string) *Module {
	h := &authPwdHandler{
		pool:          d.Pool,
		log:           d.Log,
		issuer:        am.Issuer,
		sessions:      am.Sessions,
		refreshTTL:    am.RefreshTTL,
		secureCookies: secureCookies,
		cookieDomain:  cookieDomain,
	}
	return &Module{
		MountREST: func(r chi.Router) {
			r.Post("/auth/register", h.register)
			r.Post("/auth/login", h.login)
		},
	}
}

type authPwdHandler struct {
	pool          *pgxpool.Pool
	log           *slog.Logger
	issuer        *authApp.TokenIssuer
	sessions      *authInfra.RedisSessions
	refreshTTL    time.Duration
	secureCookies bool
	cookieDomain  string
}

// ── request / response types ──────────────────────────────────────────────

type credentialsRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Username string `json:"username,omitempty"` // optional on register
}

type authSuccessResponse struct {
	AccessToken string   `json:"access_token"`
	ExpiresIn   int      `json:"expires_in"`
	User        userView `json:"user"`
}

type userView struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

// errorResponse mirrors the shape suggested by the task description.
type errorResponse struct {
	Error errorBody `json:"error"`
}
type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ── handlers ──────────────────────────────────────────────────────────────

func (h *authPwdHandler) register(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	req, err := decodeCreds(r)
	if err != nil {
		writeAuthErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if msg, ok := validateEmail(req.Email); !ok {
		writeAuthErr(w, http.StatusBadRequest, "invalid_email", msg)
		return
	}
	if msg, ok := validatePassword(req.Password); !ok {
		writeAuthErr(w, http.StatusBadRequest, "weak_password", msg)
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	username := normaliseUsernameFromEmail(req.Username, email)

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		h.log.ErrorContext(ctx, "auth.register: bcrypt", slog.Any("err", err))
		writeAuthErr(w, http.StatusInternalServerError, "internal", "hash failure")
		return
	}

	uid, finalUsername, role, createErr := h.createUser(ctx, email, username, string(hash))
	if createErr != nil {
		switch {
		case errors.Is(createErr, errEmailTaken):
			writeAuthErr(w, http.StatusConflict, "email_taken", "email already registered")
		case errors.Is(createErr, errUsernameTaken):
			writeAuthErr(w, http.StatusConflict, "username_taken", "username already taken")
		default:
			h.log.ErrorContext(ctx, "auth.register: createUser", slog.Any("err", createErr))
			writeAuthErr(w, http.StatusInternalServerError, "internal", "could not create user")
		}
		return
	}

	h.issueAndWrite(w, r, uid, email, finalUsername, role, http.StatusCreated)
}

func (h *authPwdHandler) login(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	req, err := decodeCreds(r)
	if err != nil {
		writeAuthErr(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.Email == "" || req.Password == "" {
		writeAuthErr(w, http.StatusBadRequest, "missing_credentials", "email and password are required")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))

	uid, username, role, hash, err := h.findCreds(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeAuthErr(w, http.StatusUnauthorized, "invalid_credentials", "invalid email or password")
			return
		}
		h.log.ErrorContext(ctx, "auth.login: findCreds", slog.Any("err", err))
		writeAuthErr(w, http.StatusInternalServerError, "internal", "lookup failure")
		return
	}
	if hash == "" {
		// User exists but registered via OAuth — no password set.
		writeAuthErr(w, http.StatusUnauthorized, "invalid_credentials", "invalid email or password")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
		writeAuthErr(w, http.StatusUnauthorized, "invalid_credentials", "invalid email or password")
		return
	}

	h.issueAndWrite(w, r, uid, email, username, role, http.StatusOK)
}

// ── token issuance + cookie ───────────────────────────────────────────────

func (h *authPwdHandler) issueAndWrite(
	w http.ResponseWriter, r *http.Request,
	uid uuid.UUID, email, username, role string, status int,
) {
	ctx := r.Context()
	roleEnum := enums.UserRole(role)
	if !roleEnum.IsValid() {
		roleEnum = enums.UserRoleUser
	}
	access, expiresIn, err := h.issuer.Mint(uid, roleEnum, enums.AuthProvider("password"))
	if err != nil {
		h.log.ErrorContext(ctx, "auth.issue: mint", slog.Any("err", err))
		writeAuthErr(w, http.StatusInternalServerError, "internal", "token mint failure")
		return
	}
	// Persist refresh session via the auth Redis SessionRepo.
	refresh, sid := authApp.NewRefreshToken()
	expires := time.Now().Add(h.refreshTTL).UTC()
	if err := h.persistSession(ctx, sid, uid, expires, r); err != nil {
		h.log.ErrorContext(ctx, "auth.issue: persist session", slog.Any("err", err))
		writeAuthErr(w, http.StatusInternalServerError, "internal", "session persist failure")
		return
	}

	// Refresh cookie — match the path/secure attributes used by the OAuth
	// flows (see auth/ports/server.go setRefreshCookieString).
	cookie := &http.Cookie{
		Name:     "druz9_refresh",
		Value:    refresh,
		Path:     "/api/v1/auth",
		Domain:   h.cookieDomain,
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   h.secureCookies,
		SameSite: http.SameSiteLaxMode,
	}
	http.SetCookie(w, cookie)

	writeJSON(w, status, authSuccessResponse{
		AccessToken: access,
		ExpiresIn:   expiresIn,
		User: userView{
			ID:       uid.String(),
			Email:    email,
			Username: username,
			Role:     roleEnum.String(),
		},
	})
}

// persistSession writes a refresh-token row in Redis via the same
// SessionRepo the OAuth flows use.
func (h *authPwdHandler) persistSession(ctx context.Context, sid, uid uuid.UUID, expires time.Time, r *http.Request) error {
	if h.sessions == nil {
		return fmt.Errorf("session store not wired")
	}
	if err := h.sessions.Create(ctx, authDomain.Session{
		ID:        sid,
		UserID:    uid,
		CreatedAt: time.Now().UTC(),
		ExpiresAt: expires,
		UserAgent: r.UserAgent(),
		IP:        clientIP(r),
	}); err != nil {
		return fmt.Errorf("auth_pwd: create session: %w", err)
	}
	return nil
}

// ── DB ops ────────────────────────────────────────────────────────────────

var (
	errEmailTaken    = errors.New("email taken")
	errUsernameTaken = errors.New("username taken")
)

// createUser inserts a new row into `users` with email + bcrypt hash.
// Returns (id, finalUsername, role).
func (h *authPwdHandler) createUser(ctx context.Context, email, usernameHint, hash string) (uuid.UUID, string, string, error) {
	if h.pool == nil {
		return uuid.Nil, "", "", fmt.Errorf("no pg pool")
	}
	// 1. Reject duplicate email up front (cheap explicit check — the
	// UNIQUE constraint would also catch it but we want a typed error).
	var taken bool
	if err := h.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE lower(email) = $1)`, email).Scan(&taken); err != nil {
		return uuid.Nil, "", "", fmt.Errorf("check email: %w", err)
	}
	if taken {
		return uuid.Nil, "", "", errEmailTaken
	}

	// 2. Resolve username collision — try hint, then hint_xxxx up to 5 times.
	username, err := ensureUniqueUsernamePool(ctx, h.pool, usernameHint)
	if err != nil {
		return uuid.Nil, "", "", err
	}

	// 3. Insert.
	var (
		id   uuid.UUID
		role string
	)
	err = h.pool.QueryRow(ctx, `
		INSERT INTO users(email, username, password_hash, role, locale)
		VALUES ($1, $2, $3, 'user', 'ru')
		RETURNING id, role
	`, email, username, hash).Scan(&id, &role)
	if err != nil {
		// Race with another concurrent insert — surface as conflict.
		if isUniqueViolation(err) {
			return uuid.Nil, "", "", errEmailTaken
		}
		return uuid.Nil, "", "", fmt.Errorf("insert user: %w", err)
	}
	return id, username, role, nil
}

// findCreds loads the user row by email plus its (possibly null) password
// hash. ErrNoRows means no such email.
func (h *authPwdHandler) findCreds(ctx context.Context, email string) (uuid.UUID, string, string, string, error) {
	if h.pool == nil {
		return uuid.Nil, "", "", "", fmt.Errorf("no pg pool")
	}
	var (
		id       uuid.UUID
		username string
		role     string
		hash     *string
	)
	err := h.pool.QueryRow(ctx, `
		SELECT id, username, role, password_hash
		  FROM users
		 WHERE lower(email) = $1
		 LIMIT 1
	`, email).Scan(&id, &username, &role, &hash)
	if err != nil {
		return uuid.Nil, "", "", "", fmt.Errorf("auth_pwd: scan user: %w", err)
	}
	h2 := ""
	if hash != nil {
		h2 = *hash
	}
	return id, username, role, h2, nil
}

func ensureUniqueUsernamePool(ctx context.Context, pool *pgxpool.Pool, hint string) (string, error) {
	hint = strings.TrimSpace(hint)
	if hint == "" {
		hint = "user_" + uuid.New().String()[:8]
	}
	for i := 0; i < 5; i++ {
		candidate := hint
		if i > 0 {
			candidate = fmt.Sprintf("%s_%s", hint, uuid.New().String()[:4])
		}
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)`, candidate).Scan(&exists); err != nil {
			return "", fmt.Errorf("check username: %w", err)
		}
		if !exists {
			return candidate, nil
		}
	}
	return fmt.Sprintf("%s_%s", hint, uuid.New().String()[:8]), nil
}

func isUniqueViolation(err error) bool {
	// 23505 unique_violation in pgx
	return err != nil && strings.Contains(err.Error(), "SQLSTATE 23505")
}

// ── helpers ───────────────────────────────────────────────────────────────

func decodeCreds(r *http.Request) (credentialsRequest, error) {
	var c credentialsRequest
	defer func() { _ = r.Body.Close() }()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		return c, fmt.Errorf("invalid json: %w", err)
	}
	return c, nil
}

func validateEmail(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "email is required", false
	}
	if len(s) > 254 {
		return "email too long", false
	}
	if !emailRe.MatchString(s) {
		return "invalid email format", false
	}
	return "", true
}

func validatePassword(s string) (string, bool) {
	if len(s) < minPasswordLen {
		return fmt.Sprintf("password must be at least %d characters", minPasswordLen), false
	}
	if len(s) > 256 {
		return "password too long", false
	}
	return "", true
}

func normaliseUsernameFromEmail(hint, email string) string {
	hint = strings.TrimSpace(hint)
	if hint != "" {
		return hint
	}
	if at := strings.IndexByte(email, '@'); at > 0 {
		return strings.ToLower(email[:at])
	}
	return "user"
}

func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		if i := strings.IndexByte(v, ','); i >= 0 {
			return strings.TrimSpace(v[:i])
		}
		return strings.TrimSpace(v)
	}
	if v := r.Header.Get("X-Real-IP"); v != "" {
		return v
	}
	return r.RemoteAddr
}

func writeAuthErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, errorResponse{Error: errorBody{Code: code, Message: msg}})
}
