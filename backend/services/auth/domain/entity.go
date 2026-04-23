package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// User — корневой агрегат аутентификации. Минимальная форма: насыщенные
// данные профиля живут в bounded-контексте profile и подтягиваются там.
type User struct {
	ID          uuid.UUID
	Email       string // nullable в источнике; пустая строка означает отсутствие email (случай Telegram).
	Username    string
	Role        enums.UserRole
	Locale      string
	DisplayName string
	AvatarURL   string // URL аватара (Yandex islands-200 / Telegram photo_url); пустая строка == "показать инициалы".
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// OAuthAccount — внешняя идентичность, привязанная к User.
type OAuthAccount struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	Provider        enums.AuthProvider
	ProviderUserID  string
	AccessTokenEnc  []byte // шифротекст AES-256-GCM
	RefreshTokenEnc []byte
	TokenExpiresAt  *time.Time
	CreatedAt       time.Time
}

// Session — активная сессия refresh-токена в Redis.
// Access-токены — stateless JWT; только refresh хранится здесь, чтобы можно было отозвать.
type Session struct {
	ID        uuid.UUID // id сессии == jti refresh
	UserID    uuid.UUID
	CreatedAt time.Time
	ExpiresAt time.Time
	UserAgent string
	IP        string
}

// TokenPair — то, что use case возвращает HTTP-слою.
type TokenPair struct {
	AccessToken     string
	AccessExpiresIn int // секунды
	RefreshToken    string
	SessionID       uuid.UUID
	RefreshExpires  time.Time
}

// YandexUserInfo — релевантная часть ответа Yandex /info.
type YandexUserInfo struct {
	ID              string // числовой id Яндекса в виде строки
	Login           string // login = кандидат в username
	DisplayName     string
	DefaultEmail    string
	DefaultAvatarID string // если есть — строим URL вида https://avatars.yandex.net/get-yapic/<id>/islands-200
	IsAvatarEmpty   bool   // Yandex может вернуть is_avatar_empty=true → не показываем
}

// YandexAvatarURL — каноническая «islands-200» ссылка на аватар Яндекса.
// Возвращает пустую строку для пустого id или is_avatar_empty=true.
func YandexAvatarURL(info YandexUserInfo) string {
	if info.DefaultAvatarID == "" || info.IsAvatarEmpty {
		return ""
	}
	return "https://avatars.yandex.net/get-yapic/" + info.DefaultAvatarID + "/islands-200"
}

// TelegramProfile — верифицированный payload Telegram Login Widget.
type TelegramProfile struct {
	ID        int64
	FirstName string
	LastName  string
	Username  string
	PhotoURL  string
	AuthDate  int64
}
