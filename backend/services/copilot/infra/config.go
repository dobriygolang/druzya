package infra

import (
	"context"
	"encoding/json"
	"os"
	"strings"

	"druz9/copilot/domain"
	"druz9/shared/enums"

	"github.com/jackc/pgx/v5/pgxpool"
)

const PlansConfigKey = "copilot_plans"

type CopilotPlanConfig struct {
	ID            string   `json:"id"`
	DisplayName   string   `json:"display_name"`
	PriceLabel    string   `json:"price_label"`
	Tagline       string   `json:"tagline"`
	Bullets       []string `json:"bullets"`
	CTALabel      string   `json:"cta_label"`
	SubscribeURL  string   `json:"subscribe_url"`
	RequestsCap   int      `json:"requests_cap"`
	ModelsAllowed []string `json:"models_allowed"`
}

type copilotPlansConfig struct {
	DefaultModelID string                       `json:"default_model_id"`
	Plans          map[string]CopilotPlanConfig `json:"plans"`
	Order          []string                     `json:"order"`
}

// StaticConfigProvider serves a hardcoded DesktopConfig baked into the
// binary. This is the MVP implementation; a future DB-backed provider will
// let us ship config changes without a redeploy.
//
// Rev is fixed — bump it by hand when editing defaults.
type StaticConfigProvider struct {
	cfg domain.DesktopConfig
}

// NewStaticConfigProvider returns a provider serving DefaultDesktopConfig.
func NewStaticConfigProvider() *StaticConfigProvider {
	return &StaticConfigProvider{cfg: DefaultDesktopConfig()}
}

func NewConfigProvider(pool *pgxpool.Pool) domain.ConfigProvider {
	if pool == nil {
		return NewStaticConfigProvider()
	}
	return &DynamicConfigProvider{pool: pool}
}

// NewDynamicConfigProvider — concrete constructor for cmd/ wiring that
// needs PlanForTier (in addition to the domain.ConfigProvider Load).
// Always returns a non-nil pointer; if pool is nil it gracefully serves
// the hardcoded default (PlanForTier falls back to PlanConfigFor("", tier)).
func NewDynamicConfigProvider(pool *pgxpool.Pool) *DynamicConfigProvider {
	return &DynamicConfigProvider{pool: pool}
}

// Load implements domain.ConfigProvider.
func (p *StaticConfigProvider) Load(_ context.Context) (domain.DesktopConfig, error) {
	return p.cfg, nil
}

type DynamicConfigProvider struct {
	pool *pgxpool.Pool
}

func (p *DynamicConfigProvider) Load(ctx context.Context) (domain.DesktopConfig, error) {
	cfg := DefaultDesktopConfig()
	raw := ""
	if p != nil && p.pool != nil {
		_ = p.pool.QueryRow(ctx, `SELECT value FROM dynamic_config WHERE key = $1`, PlansConfigKey).Scan(&raw)
	}
	if raw == "" {
		return cfg, nil
	}
	plansCfg := DecodePlansConfig(raw)
	if strings.TrimSpace(plansCfg.DefaultModelID) != "" {
		cfg.DefaultModelID = strings.TrimSpace(plansCfg.DefaultModelID)
	}
	paywall := PaywallFromPlansConfig(plansCfg)
	if len(paywall) > 0 {
		cfg.Paywall = paywall
	}
	return cfg, nil
}

func DecodePlansConfig(raw string) copilotPlansConfig {
	cfg := copilotPlansConfig{Plans: DefaultPlanConfigs(), Order: []string{"free", "pro", "max"}}
	if strings.TrimSpace(raw) == "" {
		return cfg
	}
	var override copilotPlansConfig
	if err := json.Unmarshal([]byte(raw), &override); err != nil {
		return cfg
	}
	if strings.TrimSpace(override.DefaultModelID) != "" {
		cfg.DefaultModelID = strings.TrimSpace(override.DefaultModelID)
	}
	if len(override.Order) > 0 {
		cfg.Order = override.Order
	}
	for id, plan := range override.Plans {
		norm := normalizePlanID(id)
		if norm == "" {
			continue
		}
		base := cfg.Plans[norm]
		plan.ID = norm
		cfg.Plans[norm] = mergePlanConfig(base, plan)
	}
	return cfg
}

func PlanConfigFor(raw string, tier enums.SubscriptionPlan) CopilotPlanConfig {
	cfg := DecodePlansConfig(raw)
	id := normalizePlanID(string(tier))
	if id == "" {
		id = "free"
	}
	if p, ok := cfg.Plans[id]; ok {
		return p
	}
	return cfg.Plans["free"]
}

// PlanForTier — единственная точка чтения copilot_plans конфига для
// квоты пользователя. Вызывается из subscription tier-changed hook'а
// (cmd-side wiring). Хранение запроса здесь, а не в cmd/, держит
// прямые pool.* вне фасада per services/README.md.
//
// При nil-pool / отсутствии row / парсинг-ошибке отдаёт хардкод-
// дефолт через PlanConfigFor("", tier) — это сохраняет старое
// fail-soft-поведение (юзер не теряет доступ если admin-config битый).
func (p *DynamicConfigProvider) PlanForTier(ctx context.Context, tier enums.SubscriptionPlan) CopilotPlanConfig {
	raw := ""
	if p != nil && p.pool != nil {
		_ = p.pool.QueryRow(ctx,
			`SELECT value FROM dynamic_config WHERE key = $1`,
			PlansConfigKey,
		).Scan(&raw)
	}
	return PlanConfigFor(raw, tier)
}

// StaticConfigProvider тоже умеет PlanForTier — отдаёт дефолтный
// набор без обращения к БД. Симметрия по интерфейсу позволяет cmd/
// держать одну фабрику NewConfigProvider и не разветвляться.
func (p *StaticConfigProvider) PlanForTier(_ context.Context, tier enums.SubscriptionPlan) CopilotPlanConfig {
	return PlanConfigFor("", tier)
}

func DefaultPlanConfigs() map[string]CopilotPlanConfig {
	return map[string]CopilotPlanConfig{
		"free": {
			ID:            "free",
			DisplayName:   "Free",
			PriceLabel:    "Бесплатно",
			Tagline:       "Для знакомства с продуктом",
			Bullets:       []string{"20 запросов в день", "Только Турбо-цепочка", "Только macOS"},
			CTALabel:      "Текущий план",
			RequestsCap:   20,
			ModelsAllowed: []string{"druz9/turbo"},
		},
		"pro": {
			ID:            "pro",
			DisplayName:   "Pro",
			PriceLabel:    "499 ₽/мес",
			Tagline:       "Для ежедневной работы",
			Bullets:       []string{"200 запросов в день", "Расширенные модели", "История с облачной синхронизацией"},
			CTALabel:      "Оформить подписку",
			SubscribeURL:  boostyURLForTier("pro"),
			RequestsCap:   200,
			ModelsAllowed: nil,
		},
		"max": {
			ID:            "max",
			DisplayName:   "Max",
			PriceLabel:    "1490 ₽/мес",
			Tagline:       "Для интенсивной работы",
			Bullets:       []string{"Безлимитные запросы", "Все модели", "Приоритетная поддержка"},
			CTALabel:      "Оформить подписку",
			SubscribeURL:  boostyURLForTier("max"),
			RequestsCap:   -1,
			ModelsAllowed: nil,
		},
	}
}

func PaywallFromPlansConfig(cfg copilotPlansConfig) []domain.PaywallCopy {
	out := make([]domain.PaywallCopy, 0, len(cfg.Order))
	for _, id := range cfg.Order {
		p, ok := cfg.Plans[normalizePlanID(id)]
		if !ok {
			continue
		}
		out = append(out, domain.PaywallCopy{
			PlanID:       p.ID,
			DisplayName:  p.DisplayName,
			PriceLabel:   p.PriceLabel,
			Tagline:      p.Tagline,
			Bullets:      append([]string(nil), p.Bullets...),
			CTALabel:     p.CTALabel,
			SubscribeURL: p.SubscribeURL,
		})
	}
	return out
}

func normalizePlanID(id string) string {
	switch strings.TrimSpace(strings.ToLower(id)) {
	case "", "free":
		return "free"
	case "pro", "seeker":
		return "pro"
	case "max", "ascendant", "ascended":
		return "max"
	default:
		return ""
	}
}

func mergePlanConfig(base, override CopilotPlanConfig) CopilotPlanConfig {
	out := base
	if override.ID != "" {
		out.ID = override.ID
	}
	if override.DisplayName != "" {
		out.DisplayName = override.DisplayName
	}
	if override.PriceLabel != "" {
		out.PriceLabel = override.PriceLabel
	}
	if override.Tagline != "" {
		out.Tagline = override.Tagline
	}
	if override.Bullets != nil {
		out.Bullets = append([]string(nil), override.Bullets...)
	}
	if override.CTALabel != "" {
		out.CTALabel = override.CTALabel
	}
	if override.SubscribeURL != "" {
		out.SubscribeURL = override.SubscribeURL
	}
	if override.RequestsCap != 0 {
		out.RequestsCap = override.RequestsCap
	}
	if override.ModelsAllowed != nil {
		out.ModelsAllowed = append([]string(nil), override.ModelsAllowed...)
	}
	return out
}

// DefaultDesktopConfig is the fallback payload shipped when no dynamic
// config source is wired. All client-visible values — model catalogue,
// pricing copy, hotkey defaults — live here so the desktop client can stay
// dumb. Bump Rev on every change.
func DefaultDesktopConfig() domain.DesktopConfig {
	return domain.DesktopConfig{
		Rev: 5,
		Models: []domain.ProviderModel{
			// ── Turbo (auto-routing) — the virtual model backed by the
			// server-side llmchain. Goes first so it's the obvious pick.
			{
				ID:                     "druz9/turbo",
				DisplayName:            "Турбо ⚡ (авто)",
				ProviderName:           "Druz9",
				SpeedClass:             domain.ModelSpeedClassFast,
				SupportsVision:         false,
				SupportsReasoning:      true,
				TypicalLatencyMs:       800,
				ContextWindowTokens:    131_072,
				AvailableOnCurrentPlan: true,
			},
			// ── Direct free upstream models. Listed for paid/admin visibility,
			// but free users are pinned to druz9/turbo so every request uses
			// the server-side circuit-breaker chain.
			{
				ID:                     "openai/gpt-oss-120b:free",
				DisplayName:            "GPT-OSS 120B · free",
				ProviderName:           "OpenRouter",
				SpeedClass:             domain.ModelSpeedClassBalanced,
				SupportsVision:         false,
				SupportsReasoning:      true,
				TypicalLatencyMs:       2600,
				ContextWindowTokens:    131_072,
				AvailableOnCurrentPlan: false,
			},
			{
				ID:                     "qwen/qwen3-coder:free",
				DisplayName:            "Qwen3 Coder · free",
				ProviderName:           "OpenRouter",
				SpeedClass:             domain.ModelSpeedClassFast,
				SupportsVision:         false,
				SupportsReasoning:      false,
				TypicalLatencyMs:       1400,
				ContextWindowTokens:    262_144,
				AvailableOnCurrentPlan: false,
			},
			{
				ID:                     "minimax/minimax-m2.5:free",
				DisplayName:            "MiniMax M2.5 · free",
				ProviderName:           "OpenRouter",
				SpeedClass:             domain.ModelSpeedClassBalanced,
				SupportsVision:         false,
				SupportsReasoning:      false,
				TypicalLatencyMs:       1800,
				ContextWindowTokens:    200_000,
				AvailableOnCurrentPlan: false,
			},
			{
				ID:                     "liquid/lfm-2.5-1.2b-thinking:free",
				DisplayName:            "Liquid LFM 1.2B Thinking · free",
				ProviderName:           "OpenRouter",
				SpeedClass:             domain.ModelSpeedClassReasoning,
				SupportsVision:         false,
				SupportsReasoning:      true,
				TypicalLatencyMs:       1200,
				ContextWindowTokens:    32_000,
				AvailableOnCurrentPlan: false,
			},
			// ── Paid tier (OpenAI / Anthropic / Google / xAI proper).
			{
				ID:                     "openai/gpt-4o-mini",
				DisplayName:            "GPT Fast",
				ProviderName:           "OpenAI",
				SpeedClass:             domain.ModelSpeedClassFast,
				SupportsVision:         true,
				SupportsReasoning:      false,
				TypicalLatencyMs:       1100,
				ContextWindowTokens:    128_000,
				AvailableOnCurrentPlan: false,
			},
			{
				ID:                     "openai/gpt-4o",
				DisplayName:            "GPT Smart",
				ProviderName:           "OpenAI",
				SpeedClass:             domain.ModelSpeedClassBalanced,
				SupportsVision:         true,
				SupportsReasoning:      false,
				TypicalLatencyMs:       1600,
				ContextWindowTokens:    128_000,
				AvailableOnCurrentPlan: false,
			},
			{
				ID:                     "anthropic/claude-sonnet-4",
				DisplayName:            "Claude Smart",
				ProviderName:           "Anthropic",
				SpeedClass:             domain.ModelSpeedClassBalanced,
				SupportsVision:         true,
				SupportsReasoning:      false,
				TypicalLatencyMs:       4200,
				ContextWindowTokens:    200_000,
				AvailableOnCurrentPlan: false,
			},
			{
				ID:                     "anthropic/claude-opus-4",
				DisplayName:            "Claude Analytical",
				ProviderName:           "Anthropic",
				SpeedClass:             domain.ModelSpeedClassReasoning,
				SupportsVision:         true,
				SupportsReasoning:      true,
				TypicalLatencyMs:       3700,
				ContextWindowTokens:    200_000,
				AvailableOnCurrentPlan: false,
			},
			{
				ID:                     "google/gemini-pro-1.5",
				DisplayName:            "Gemini Pro",
				ProviderName:           "Google",
				SpeedClass:             domain.ModelSpeedClassBalanced,
				SupportsVision:         true,
				SupportsReasoning:      false,
				TypicalLatencyMs:       2400,
				ContextWindowTokens:    1_000_000,
				AvailableOnCurrentPlan: false,
			},
			{
				ID:                     "google/gemini-flash-2.0",
				DisplayName:            "Gemini Flash",
				ProviderName:           "Google",
				SpeedClass:             domain.ModelSpeedClassFast,
				SupportsVision:         true,
				SupportsReasoning:      false,
				TypicalLatencyMs:       900,
				ContextWindowTokens:    1_000_000,
				AvailableOnCurrentPlan: false,
			},
			{
				ID:                     "xai/grok-2",
				DisplayName:            "Grok 2",
				ProviderName:           "xAI",
				SpeedClass:             domain.ModelSpeedClassBalanced,
				SupportsVision:         true,
				SupportsReasoning:      false,
				TypicalLatencyMs:       2100,
				ContextWindowTokens:    128_000,
				AvailableOnCurrentPlan: false,
			},
		},
		DefaultModelID: "druz9/turbo",
		DefaultHotkeys: []domain.HotkeyBinding{
			{Action: domain.HotkeyActionScreenshotArea, Accelerator: "CommandOrControl+Shift+S"},
			{Action: domain.HotkeyActionScreenshotFull, Accelerator: "CommandOrControl+Shift+A"},
			{Action: domain.HotkeyActionVoiceInput, Accelerator: "CommandOrControl+Shift+V"},
			{Action: domain.HotkeyActionToggleWindow, Accelerator: "CommandOrControl+Shift+D"},
			{Action: domain.HotkeyActionQuickPrompt, Accelerator: "CommandOrControl+Shift+Q"},
			{Action: domain.HotkeyActionClearConversation, Accelerator: "CommandOrControl+Shift+K"},
			{Action: domain.HotkeyActionCursorFreezeToggle, Accelerator: "CommandOrControl+Shift+Y"},
		},
		Flags: []domain.FeatureFlag{
			{Key: "voice_input", Enabled: false},
			{Key: "masquerade", Enabled: true},
			// byo_api_key removed after BYOK was cut — keys no longer
			// cross the client boundary; all dispatch goes via the server.
			{Key: "stealth_overlay", Enabled: true},
		},
		Paywall:         paywallFromEnv(),
		StealthWarnings: []domain.StealthCompatEntry{
			// Seed list — add entries here as we discover broken versions.
		},
		UpdateFeedURL:      "",
		MinClientVersion:   "0.1.0",
		AnalyticsPolicyKey: "v1-opt-in-default-off",
	}
}

// boostyURLForTier — единая точка чтения Boosty subscribe URL по
// tier-id. Канонические env-имена в free/pro/max схеме:
//
//	BOOSTY_CHECKOUT_URL_PRO  — Pro tier
//	BOOSTY_CHECKOUT_URL_MAX  — Max tier
//
// Legacy aliases (BOOSTY_CHECKOUT_URL_SEEKER / _ASCENDANT) поддерживаются
// для совместимости с существующими deploy-конфигами; будут удалены
// после ротации env по всем окружениям.
func boostyURLForTier(tier string) string {
	switch tier {
	case "pro":
		if v := os.Getenv("BOOSTY_CHECKOUT_URL_PRO"); v != "" {
			return v
		}
		return os.Getenv("BOOSTY_CHECKOUT_URL_SEEKER")
	case "max":
		if v := os.Getenv("BOOSTY_CHECKOUT_URL_MAX"); v != "" {
			return v
		}
		return os.Getenv("BOOSTY_CHECKOUT_URL_ASCENDANT")
	}
	return ""
}

// paywallFromEnv — собирает paywall copy с subscribe URL'ами из env vars.
// См. boostyURLForTier для канонических env-имён.
//
// Если env пуста — frontend получит пустой URL и кнопка станет disabled
// + покажется hint «coming soon». Это намеренная degradation: лучше
// disabled-кнопка чем ссылка на 404.
func paywallFromEnv() []domain.PaywallCopy {
	seekerURL := boostyURLForTier("pro")
	ascendantURL := boostyURLForTier("max")
	return []domain.PaywallCopy{
		{
			PlanID:       "free",
			DisplayName:  "Free",
			PriceLabel:   "Бесплатно",
			Tagline:      "Для знакомства с продуктом",
			Bullets:      []string{"20 запросов в день", "Только Турбо-цепочка", "Только macOS"},
			CTALabel:     "Текущий план",
			SubscribeURL: "",
		},
		{
			PlanID:      "pro",
			DisplayName: "Pro",
			PriceLabel:  "499 ₽/мес",
			Tagline:     "Для ежедневной работы",
			Bullets: []string{
				"Безлимитные запросы",
				"Все модели, включая Claude",
				"История с облачной синхронизацией",
				"Приоритетная поддержка",
			},
			CTALabel:     "Оформить подписку",
			SubscribeURL: seekerURL,
		},
		{
			PlanID:      "max",
			DisplayName: "Max",
			PriceLabel:  "1490 ₽/мес",
			Tagline:     "Для интенсивной работы",
			Bullets: []string{
				"Всё из Pro",
				"До 5 сидов в команде",
				"SSO через Telegram / Yandex",
				"Приоритетная поддержка в течение 4 часов",
			},
			CTALabel:     "Оформить подписку",
			SubscribeURL: ascendantURL,
		},
	}
}

// Interface guard.
var _ domain.ConfigProvider = (*StaticConfigProvider)(nil)
