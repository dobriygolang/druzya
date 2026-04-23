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
		Rev: 2,
		Models: []domain.ProviderModel{
			{
				ID:                     "openai/gpt-4o-mini",
				DisplayName:            "GPT Fast",
				ProviderName:           "OpenAI",
				SpeedClass:             domain.ModelSpeedClassFast,
				SupportsVision:         true,
				SupportsReasoning:      false,
				TypicalLatencyMs:       1100,
				ContextWindowTokens:    128_000,
				AvailableOnCurrentPlan: true,
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
		DefaultModelID: "openai/gpt-4o-mini",
		DefaultHotkeys: []domain.HotkeyBinding{
			{Action: domain.HotkeyActionScreenshotArea, Accelerator: "CommandOrControl+Shift+S"},
			{Action: domain.HotkeyActionScreenshotFull, Accelerator: "CommandOrControl+Shift+A"},
			{Action: domain.HotkeyActionVoiceInput, Accelerator: "CommandOrControl+Shift+V"},
			{Action: domain.HotkeyActionToggleWindow, Accelerator: "CommandOrControl+Shift+D"},
			{Action: domain.HotkeyActionQuickPrompt, Accelerator: "CommandOrControl+Shift+Q"},
			{Action: domain.HotkeyActionClearConversation, Accelerator: "CommandOrControl+Shift+K"},
		},
		Flags: []domain.FeatureFlag{
			{Key: "voice_input", Enabled: false},
			{Key: "masquerade", Enabled: true},
			{Key: "byo_api_key", Enabled: true},
			{Key: "stealth_overlay", Enabled: true},
		},
		Paywall: []domain.PaywallCopy{
			{
				PlanID:      "free",
				DisplayName: "Free",
				PriceLabel:  "Бесплатно",
				Tagline:     "Для знакомства с продуктом",
				Bullets: []string{
					"20 запросов в день",
					"GPT Fast",
					"Только macOS",
				},
				CTALabel: "Текущий план",
			},
			{
				PlanID:      "seeker",
				DisplayName: "Pro",
				PriceLabel:  "$15/мес",
				Tagline:     "Для ежедневной работы",
				Bullets: []string{
					"Безлимитные запросы",
					"Все модели, включая Claude",
					"История с облачной синхронизацией",
					"Приоритетная поддержка",
				},
				CTALabel: "Обновить до Pro",
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
