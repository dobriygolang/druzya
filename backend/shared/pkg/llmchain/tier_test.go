package llmchain

import (
	"context"
	"errors"
	"log/slog"
	"testing"

	"druz9/shared/enums"
)

func TestModelRequiresTier(t *testing.T) {
	cases := []struct {
		model string
		want  enums.SubscriptionPlan
	}{
		{"qwen/qwen3-coder:free", enums.SubscriptionPlanFree},            // не в карте → free
		{"llama-3.3-70b-versatile", enums.SubscriptionPlanFree},          // не в карте → free
		{"openai/gpt-4.1-mini", enums.SubscriptionPlanPro},           // paid-cheap
		{"openai/gpt-4.1", enums.SubscriptionPlanMax},                // paid-premium
		{"anthropic/claude-haiku-4.5", enums.SubscriptionPlanPro},     // paid-cheap
		{"anthropic/claude-sonnet-4.5", enums.SubscriptionPlanMax},    // paid-premium
		{"deepseek-chat", enums.SubscriptionPlanPro},                  // paid V3
		{"deepseek-reasoner", enums.SubscriptionPlanPro},              // paid R1
	}
	for _, c := range cases {
		if got := ModelRequiresTier(c.model); got != c.want {
			t.Errorf("ModelRequiresTier(%q) = %s, want %s", c.model, got, c.want)
		}
	}
}

func TestTierCovers(t *testing.T) {
	cases := []struct {
		user, required enums.SubscriptionPlan
		want           bool
	}{
		{"", enums.SubscriptionPlanFree, true}, // empty = free, free covers free
		{enums.SubscriptionPlanFree, enums.SubscriptionPlanFree, true},
		{enums.SubscriptionPlanFree, enums.SubscriptionPlanPro, false},
		{enums.SubscriptionPlanPro, enums.SubscriptionPlanFree, true},
		{enums.SubscriptionPlanPro, enums.SubscriptionPlanPro, true},
		{enums.SubscriptionPlanPro, enums.SubscriptionPlanMax, false},
		{enums.SubscriptionPlanMax, enums.SubscriptionPlanPro, true},
		{enums.SubscriptionPlanMax, enums.SubscriptionPlanMax, true},
	}
	for _, c := range cases {
		if got := TierCovers(c.user, c.required); got != c.want {
			t.Errorf("TierCovers(%s,%s) = %v, want %v", c.user, c.required, got, c.want)
		}
	}
}

func TestCandidates_VirtualModel_TierGate(t *testing.T) {
	ch, err := NewChain(map[Provider]Driver{
		ProviderGroq: stubDriver(ProviderGroq),
	}, Options{
		Order: []Provider{ProviderGroq},
		Log:   slog.Default(),
	})
	if err != nil {
		t.Fatal(err)
	}

	// free юзер просит druz9/pro → ErrTierRequired
	_, err = ch.candidates(Request{ModelOverride: VirtualPro})
	if !errors.Is(err, ErrTierRequired) {
		t.Fatalf("want ErrTierRequired for free→pro, got %v", err)
	}

	// pro-юзер на druz9/pro → expand (возможно 0 звеньев если драйверы не
	// зарегистрированы, но не ErrTierRequired — это уже задача chain.Chat
	// вернуть AllProvidersUnavailable).
	_, err = ch.candidates(Request{
		ModelOverride: VirtualPro, UserTier: enums.SubscriptionPlanPro,
	})
	if errors.Is(err, ErrTierRequired) {
		t.Fatal("pro must pass druz9/pro tier-gate")
	}

	// max → druz9/ultra
	_, err = ch.candidates(Request{
		ModelOverride: VirtualUltra, UserTier: enums.SubscriptionPlanMax,
	})
	if errors.Is(err, ErrTierRequired) {
		t.Fatal("max must pass druz9/ultra tier-gate")
	}

	// pro на druz9/ultra → ErrTierRequired
	_, err = ch.candidates(Request{
		ModelOverride: VirtualUltra, UserTier: enums.SubscriptionPlanPro,
	})
	if !errors.Is(err, ErrTierRequired) {
		t.Fatalf("pro→ultra must be rejected, got %v", err)
	}
}

func TestCandidates_ConcreteModel_TierGate(t *testing.T) {
	ch, err := NewChain(map[Provider]Driver{
		ProviderOpenRouter: stubDriver(ProviderOpenRouter),
	}, Options{
		Order: []Provider{ProviderOpenRouter},
		Log:   slog.Default(),
	})
	if err != nil {
		t.Fatal(err)
	}

	// free юзер на gpt-4.1-mini → reject
	_, err = ch.candidates(Request{ModelOverride: "openai/gpt-4.1-mini"})
	if !errors.Is(err, ErrTierRequired) {
		t.Fatalf("want ErrTierRequired, got %v", err)
	}

	// pro — проходит
	_, err = ch.candidates(Request{
		ModelOverride: "openai/gpt-4.1-mini", UserTier: enums.SubscriptionPlanPro,
	})
	if err != nil {
		t.Fatalf("pro must pass: %v", err)
	}

	// Free-модель всем OK.
	_, err = ch.candidates(Request{
		ModelOverride: "qwen/qwen3-coder:free",
	})
	if err != nil {
		t.Fatalf("free model, free user, expected no err, got %v", err)
	}
}

func TestIsVirtualModel(t *testing.T) {
	cases := []struct {
		id   string
		want bool
	}{
		{"druz9/turbo", true},
		{"druz9/pro", true},
		{"druz9/ultra", true},
		{"druz9/reasoning", true},
		{"openai/gpt-4o", false},
		{"", false},
	}
	for _, c := range cases {
		if got := IsVirtualModel(c.id); got != c.want {
			t.Errorf("IsVirtualModel(%q) = %v, want %v", c.id, got, c.want)
		}
	}
}

// stubDriver — минимальный no-op driver для теста candidates(). Реальный Chat
// не вызывается.
func stubDriver(p Provider) Driver {
	return &stubDrv{provider: p}
}

type stubDrv struct{ provider Provider }

func (s *stubDrv) Provider() Provider { return s.provider }
func (s *stubDrv) Chat(_ context.Context, _ string, _ Request) (Response, error) {
	return Response{}, nil
}
func (s *stubDrv) ChatStream(_ context.Context, _ string, _ Request) (<-chan StreamEvent, error) {
	return nil, nil
}
func (s *stubDrv) Capabilities() Capabilities {
	return Capabilities{JSONMode: true, Tools: true}
}
