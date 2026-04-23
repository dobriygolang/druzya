package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"druz9/auth/app"
	"druz9/auth/domain"
)

// YandexOAuth talks to Яндекс OAuth 2.0 (https://yandex.ru/dev/id/doc/dg/oauth/reference/auto-code-client.html).
type YandexOAuth struct {
	clientID     string
	clientSecret string
	httpc        *http.Client
	tokenURL     string
	infoURL      string
}

// NewYandexOAuth wires a client with sane 5s timeouts.
func NewYandexOAuth(clientID, clientSecret string) *YandexOAuth {
	return &YandexOAuth{
		clientID:     clientID,
		clientSecret: clientSecret,
		httpc:        &http.Client{Timeout: 5 * time.Second},
		tokenURL:     "https://oauth.yandex.ru/token",
		infoURL:      "https://login.yandex.ru/info",
	}
}

// Exchange calls /token with grant_type=authorization_code.
func (y *YandexOAuth) Exchange(ctx context.Context, code string) (app.YandexTokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("client_id", y.clientID)
	form.Set("client_secret", y.clientSecret)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, y.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return app.YandexTokenResponse{}, fmt.Errorf("auth.YandexOAuth.Exchange: new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := y.httpc.Do(req)
	if err != nil {
		return app.YandexTokenResponse{}, fmt.Errorf("auth.YandexOAuth.Exchange: do: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		return app.YandexTokenResponse{}, fmt.Errorf("auth.YandexOAuth.Exchange: status %d", resp.StatusCode)
	}
	var raw struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return app.YandexTokenResponse{}, fmt.Errorf("auth.YandexOAuth.Exchange: decode: %w", err)
	}
	return app.YandexTokenResponse{
		AccessToken:  raw.AccessToken,
		RefreshToken: raw.RefreshToken,
		ExpiresIn:    raw.ExpiresIn,
	}, nil
}

// FetchUserInfo calls /info?format=json with OAuth bearer.
func (y *YandexOAuth) FetchUserInfo(ctx context.Context, accessToken string) (domain.YandexUserInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, y.infoURL+"?format=json", nil)
	if err != nil {
		return domain.YandexUserInfo{}, fmt.Errorf("auth.YandexOAuth.FetchUserInfo: new request: %w", err)
	}
	req.Header.Set("Authorization", "OAuth "+accessToken)
	resp, err := y.httpc.Do(req)
	if err != nil {
		return domain.YandexUserInfo{}, fmt.Errorf("auth.YandexOAuth.FetchUserInfo: do: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		return domain.YandexUserInfo{}, fmt.Errorf("auth.YandexOAuth.FetchUserInfo: status %d", resp.StatusCode)
	}
	var raw struct {
		ID              string `json:"id"`
		Login           string `json:"login"`
		DisplayName     string `json:"display_name"`
		RealName        string `json:"real_name"`
		DefaultEmail    string `json:"default_email"`
		DefaultAvatarID string `json:"default_avatar_id"`
		IsAvatarEmpty   bool   `json:"is_avatar_empty"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return domain.YandexUserInfo{}, fmt.Errorf("auth.YandexOAuth.FetchUserInfo: decode: %w", err)
	}
	name := raw.DisplayName
	if name == "" {
		name = raw.RealName
	}
	return domain.YandexUserInfo{
		ID:              raw.ID,
		Login:           raw.Login,
		DisplayName:     name,
		DefaultEmail:    raw.DefaultEmail,
		DefaultAvatarID: raw.DefaultAvatarID,
		IsAvatarEmpty:   raw.IsAvatarEmpty,
	}, nil
}
