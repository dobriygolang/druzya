package infra

import (
	"context"

	"druz9/copilot/domain"
)

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

// Load implements domain.ConfigProvider.
func (p *StaticConfigProvider) Load(_ context.Context) (domain.DesktopConfig, error) {
	return p.cfg, nil
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
			// ── Free tier — served via OpenRouter's zero-cost :free lane.
			{
				ID:                     "openai/gpt-oss-120b:free",
				DisplayName:            "GPT-OSS 120B · free",
				ProviderName:           "OpenRouter",
				SpeedClass:             domain.ModelSpeedClassBalanced,
				SupportsVision:         false,
				SupportsReasoning:      true,
				TypicalLatencyMs:       2600,
				ContextWindowTokens:    131_072,
				AvailableOnCurrentPlan: true,
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
				AvailableOnCurrentPlan: true,
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
				AvailableOnCurrentPlan: true,
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
				AvailableOnCurrentPlan: true,
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
		Paywall: []domain.PaywallCopy{
			{
				PlanID:       "free",
				DisplayName:  "Free",
				PriceLabel:   "Бесплатно",
				Tagline:      "Для знакомства с продуктом",
				Bullets:      []string{"20 запросов в день", "Qwen3 Coder / GPT-OSS / MiniMax / Liquid (free)", "Только macOS"},
				CTALabel:     "Текущий план",
				SubscribeURL: "",
			},
			{
				PlanID:      "seeker",
				DisplayName: "Pro",
				PriceLabel:  "499 ₽/мес",
				Tagline:     "Для ежедневной работы",
				Bullets: []string{
					"Безлимитные запросы",
					"Все модели, включая Claude",
					"История с облачной синхронизацией",
					"Приоритетная поддержка",
				},
				CTALabel: "Оформить подписку",
				// SubscribeURL будет выдан централизованным subscription-сервисом
				// (M1+M3) — он формирует одноразовый checkout-URL через Boosty/
				// ЮKassa API с привязкой user_id и tier. Пустой → frontend
				// показывает "Coming soon" / скрывает кнопку до выкатки M3.
				SubscribeURL: "",
			},
			{
				PlanID:      "ascendant",
				DisplayName: "Team",
				PriceLabel:  "1490 ₽/мес",
				Tagline:     "Для команд, работающих с прод-кодом",
				Bullets: []string{
					"Всё из Pro",
					"До 5 сидов в команде",
					"SSO через Telegram / Yandex",
					"Приоритетная поддержка в течение 4 часов",
				},
				CTALabel:     "Оформить подписку",
				SubscribeURL: "",
			},
		},
		StealthWarnings: []domain.StealthCompatEntry{
			// Seed list — add entries here as we discover broken versions.
		},
		UpdateFeedURL:      "",
		MinClientVersion:   "0.1.0",
		AnalyticsPolicyKey: "v1-opt-in-default-off",
	}
}

// Interface guard.
var _ domain.ConfigProvider = (*StaticConfigProvider)(nil)
