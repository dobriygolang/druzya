package subclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"druz9/shared/enums"
)

// Tier — alias на канонический shared/enums.SubscriptionPlan.
type Tier = enums.SubscriptionPlan

const (
	TierFree      = enums.SubscriptionPlanFree
	TierSeeker    = enums.SubscriptionPlanSeeker
	TierAscendant = enums.SubscriptionPlanAscendant
)

// DefaultTimeout — 500ms. Tier-lookup на критическом пути LLM-запроса,
// поэтому не ждём долго; fail-open гарантирует graceful degrade.
const DefaultTimeout = 500 * time.Millisecond

// Client — тонкая обёртка над Connect-RPC endpoint'ом сервиса.
type Client struct {
	base    string
	token   string
	http    *http.Client
	log     *slog.Logger
	timeout time.Duration
}

// New конструирует клиент. logger может быть nil — тогда будет slog.Default().
// baseURL без trailing slash. bearer — токен service-to-service аутентификации.
func New(baseURL, bearerToken string, logger *slog.Logger) *Client {
	if logger == nil {
		logger = slog.Default()
	}
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	return &Client{
		base:    base,
		token:   bearerToken,
		http:    &http.Client{Timeout: DefaultTimeout},
		log:     logger,
		timeout: DefaultTimeout,
	}
}

// WithTimeout — override дефолтного 500ms (для local-dev где допустимо
// подождать). НЕ рекомендуется в prod.
func (c *Client) WithTimeout(d time.Duration) *Client {
	c.timeout = d
	c.http.Timeout = d
	return c
}

// GetTier возвращает tier по userID. ВСЕГДА возвращает валидный Tier — на
// любой ошибке (сеть / не-200 / bad JSON) отдаёт TierFree и логирует WARN.
// Возвращаемая ошибка нужна только для observability/тестов, caller может её
// игнорировать.
func (c *Client) GetTier(ctx context.Context, userID string) (Tier, error) {
	if c.base == "" {
		return TierFree, errors.New("subclient: empty baseURL")
	}
	if userID == "" {
		return TierFree, errors.New("subclient: empty userID")
	}

	payload, err := json.Marshal(map[string]string{"user_id": userID})
	if err != nil {
		return TierFree, fmt.Errorf("subclient.GetTier: marshal: %w", err)
	}

	url := c.base + "/druz9.v1.SubscriptionService/GetTierByUserID"
	reqCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return TierFree, fmt.Errorf("subclient.GetTier: new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Connect-Protocol-Version", "1")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		c.log.WarnContext(ctx, "subclient.GetTier: transport error — fail-open to free",
			slog.String("user_id", userID),
			slog.Any("err", err))
		return TierFree, fmt.Errorf("subclient.GetTier: transport: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		c.log.WarnContext(ctx, "subclient.GetTier: non-200 — fail-open to free",
			slog.String("user_id", userID),
			slog.Int("status", resp.StatusCode),
			slog.String("body", string(body)))
		return TierFree, fmt.Errorf("subclient.GetTier: status %d", resp.StatusCode)
	}

	var parsed struct {
		Tier string `json:"tier"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		c.log.WarnContext(ctx, "subclient.GetTier: decode — fail-open to free",
			slog.String("user_id", userID),
			slog.Any("err", err))
		return TierFree, fmt.Errorf("subclient.GetTier: decode: %w", err)
	}

	tier := Tier(parsed.Tier)
	if !tier.IsValid() {
		c.log.WarnContext(ctx, "subclient.GetTier: unknown tier value — fail-open to free",
			slog.String("user_id", userID),
			slog.String("tier_raw", parsed.Tier))
		return TierFree, fmt.Errorf("subclient.GetTier: unknown tier %q", parsed.Tier)
	}
	return tier, nil
}

// HasAccess — публичный helper для caller'ов, которые НЕ хотят импортить
// subscription/domain напрямую (оно в service-module).
func HasAccess(userTier, required Tier) bool {
	return tierRank(userTier) >= tierRank(required)
}

func tierRank(t Tier) int {
	switch t {
	case TierFree:
		return 0
	case TierSeeker:
		return 1
	case TierAscendant:
		return 2
	}
	return 0
}
