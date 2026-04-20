package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// User is the aggregate root for authentication. Minimal shape — rich profile
// data lives in the profile bounded context and is hydrated there.
type User struct {
	ID          uuid.UUID
	Email       string // nullable at source; empty string means no email (Telegram case).
	Username    string
	Role        enums.UserRole
	Locale      string
	DisplayName string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// OAuthAccount is the external identity linked to a User.
type OAuthAccount struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	Provider         enums.AuthProvider
	ProviderUserID   string
	AccessTokenEnc   []byte // AES-256-GCM ciphertext
	RefreshTokenEnc  []byte
	TokenExpiresAt   *time.Time
	CreatedAt        time.Time
}

// Session represents an active refresh-token session stored in Redis.
// Access tokens are stateless JWT; only refresh lives here so we can revoke.
type Session struct {
	ID        uuid.UUID // session id == refresh jti
	UserID    uuid.UUID
	CreatedAt time.Time
	ExpiresAt time.Time
	UserAgent string
	IP        string
}

// TokenPair is what a use case hands back to the HTTP layer.
type TokenPair struct {
	AccessToken     string
	AccessExpiresIn int // seconds
	RefreshToken    string
	SessionID       uuid.UUID
	RefreshExpires  time.Time
}

// YandexUserInfo is the relevant slice of Yandex's /info response.
type YandexUserInfo struct {
	ID           string // Yandex numeric id as string
	Login        string // login == username candidate
	DisplayName  string
	DefaultEmail string
}

// TelegramProfile is the verified Telegram Login Widget payload.
type TelegramProfile struct {
	ID        int64
	FirstName string
	LastName  string
	Username  string
	PhotoURL  string
	AuthDate  int64
}
