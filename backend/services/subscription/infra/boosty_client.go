package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// BoostyClient — REST-обёртка для Boosty Creator API (api.boosty.to/v1/...).
//
// ⚠️  Важно: Boosty публичный API документирован плохо и меняется. Реальные
// endpoints и формы response'ов нужно проверять ПЕРЕД проД-деплоем вместе
// с Boosty-саппортом или через reverse-engineering dev-tools на
// boosty.to/creator/{slug}. Текущая реализация — **scaffolding**: структуры
// соответствуют тому что было документировано на 2026-Q2 в community-
// gist'ах, но оператор должен подтвердить path'ы через smoke-test.
//
// Флоу: креатор (мы) сгенерировал long-lived access_token в личном кабинете
// Boosty и выставил его в env BOOSTY_ACCESS_TOKEN. Клиент шлёт Bearer-auth
// на каждый запрос. Юзеры через OAuth НЕ ходят — creator-ключ читает
// **своих** subscriber'ов от лица креатора.
type BoostyClient struct {
	baseURL     string
	blogSlug    string // URL-slug нашего Boosty-блога (из BOOSTY_BLOG_SLUG)
	accessToken string // long-lived creator token
	http        *http.Client
	now         func() time.Time
}

// BoostyClientConfig — конфиг из env.
type BoostyClientConfig struct {
	BaseURL     string // default "https://api.boosty.to"
	BlogSlug    string // e.g. "druz9"
	AccessToken string
	Timeout     time.Duration // default 10s
}

// NewBoostyClient — конструктор. Если AccessToken или BlogSlug пустые,
// возвращает nil — wire-up должен скипать регистрацию sync worker'а.
func NewBoostyClient(cfg BoostyClientConfig) *BoostyClient {
	if cfg.AccessToken == "" || cfg.BlogSlug == "" {
		return nil
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.boosty.to"
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 10 * time.Second
	}
	return &BoostyClient{
		baseURL:     cfg.BaseURL,
		blogSlug:    cfg.BlogSlug,
		accessToken: cfg.AccessToken,
		http:        &http.Client{Timeout: cfg.Timeout},
		now:         func() time.Time { return time.Now().UTC() },
	}
}

// BoostySubscriber — результат одной записи из /v1/blog/{slug}/subscribers.
// Поля ограничены тем что мы реально используем — лишние поля Boosty
// response'а игнорируются json-декодером.
type BoostySubscriber struct {
	// SubscriberID — Boosty-internal id подписки. Уникален на нашем блоге,
	// используется как provider_sub_id в нашем subscriptions.
	SubscriberID string
	// Username — screen name подписчика (то что юзер вводит при /link).
	Username string
	// TierName — сырое имя уровня у Boosty ("Поддержка", "Вознёсшийся"…).
	// Маппинг в наш Tier — в app-слое через config BOOSTY_TIER_MAPPING.
	TierName string
	// ExpiresAt — когда Boosty считает подписку истёкшей.
	ExpiresAt *time.Time
	// IsActive — Boosty API возвращает флаг (active/on_pause/cancelled).
	// True → подписка живая, false → пора ставить status=cancelled.
	IsActive bool
}

// ListSubscribers — тянет всех подписчиков блога. Параметр limit (default
// 100) работает как page-size; полный список достигается пагинацией через
// cursor (offset) — для >1000 подписчиков понадобится paged-вариант.
// В MVP list'им одной страницей ≤1000 (Boosty hard-cap).
//
// TODO (оператор): подтвердить реальный path — /v1/blog/{slug}/subscribers
// это то что document'ит unofficial boosty-community repo. Если отличается
// (напр. /v2/creator/subscribers) — поменять здесь + update smoke-test.
func (c *BoostyClient) ListSubscribers(ctx context.Context, limit int) ([]BoostySubscriber, error) {
	if limit <= 0 {
		limit = 30
	}
	// Boosty API rejects limit > 30 with status 400 «invalid_param: limit».
	// Раньше cap был 1000 (предположение из community-doc'а), но реальный
	// upper-bound — 30. Если у блога больше 30 sub'ов, нужна пагинация —
	// TODO когда понадобится; для MVP 30 достаточно.
	if limit > 30 {
		limit = 30
	}
	url := fmt.Sprintf("%s/v1/blog/%s/subscribers?limit=%d", c.baseURL, c.blogSlug, limit)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("boosty.ListSubscribers: new request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("boosty.ListSubscribers: transport: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("boosty.ListSubscribers: status %d: %s", resp.StatusCode, string(body))
	}

	// Ожидаемая форма response'а (проверить на реальных данных):
	//   {"data":[{"id":"...","user":{"name":"alice"},"level":{"name":"Поддержка"},
	//             "next_pay_time":1735689600,"on_pause":false}]}
	var parsed struct {
		Data []struct {
			ID   string `json:"id"`
			User struct {
				Name string `json:"name"`
			} `json:"user"`
			Level struct {
				Name string `json:"name"`
			} `json:"level"`
			NextPayTime int64 `json:"next_pay_time"`
			OnPause     bool  `json:"on_pause"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("boosty.ListSubscribers: decode: %w", err)
	}

	out := make([]BoostySubscriber, 0, len(parsed.Data))
	for _, d := range parsed.Data {
		sub := BoostySubscriber{
			SubscriberID: d.ID,
			Username:     d.User.Name,
			TierName:     d.Level.Name,
			IsActive:     !d.OnPause,
		}
		if d.NextPayTime > 0 {
			t := time.Unix(d.NextPayTime, 0).UTC()
			sub.ExpiresAt = &t
		}
		out = append(out, sub)
	}
	return out, nil
}

// ErrBoostyUnconfigured — когда клиент nil (нет ключа). App-слой логирует
// один раз на старте и пропускает sync до выкатки ключей.
var ErrBoostyUnconfigured = errors.New("boosty: client not configured (BOOSTY_ACCESS_TOKEN/BOOSTY_BLOG_SLUG missing)")
