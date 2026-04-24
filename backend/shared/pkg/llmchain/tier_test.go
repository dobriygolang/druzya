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
		{"openai/gpt-4.1-mini", enums.SubscriptionPlanSeeker},            // paid-cheap
		{"openai/gpt-4.1", enums.SubscriptionPlanAscendant},              // paid-premium
		{"anthropic/claude-haiku-4.5", enums.SubscriptionPlanSeeker},     // paid-cheap
		{"anthropic/claude-sonnet-4.5", enums.SubscriptionPlanAscendant}, // paid-premium
		{"deepseek-chat", enums.SubscriptionPlanSeeker},                  // paid V3
		{"deepseek-reasoner", enums.SubscriptionPlanSeeker},              // paid R1
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
		{enums.SubscriptionPlanFree, enums.SubscriptionPlanSeeker, false},
		{enums.SubscriptionPlanSeeker, enums.SubscriptionPlanFree, true},
		{enums.SubscriptionPlanSeeker, enums.SubscriptionPlanSeeker, true},
		{enums.SubscriptionPlanSeeker, enums.SubscriptionPlanAscendant, false},
		{enums.SubscriptionPlanAscendant, enums.SubscriptionPlanSeeker, true},
		{enums.SubscriptionPlanAscendant, enums.SubscriptionPlanAscendant, true},
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

	// seeker-юзер на druz9/pro → expand (возможно 0 звеньев если драйверы не
	// зарегистрированы, но не ErrTierRequired — это уже задача chain.Chat
	// вернуть AllProvidersUnavailable).
	_, err = ch.candidates(Request{
		ModelOverride: VirtualPro, UserTier: enums.SubscriptionPlanSeeker,
	})
	if errors.Is(err, ErrTierRequired) {
		t.Fatal("seeker must pass druz9/pro tier-gate")
	}

	// ascendant → druz9/ultra
	_, err = ch.candidates(Request{
		ModelOverride: VirtualUltra, UserTier: enums.SubscriptionPlanAscendant,
	})
	if errors.Is(err, ErrTierRequired) {
		t.Fatal("ascendant must pass druz9/ultra tier-gate")
	}

	// seeker на druz9/ultra → ErrTierRequired
	_, err = ch.candidates(Request{
		ModelOverride: VirtualUltra, UserTier: enums.SubscriptionPlanSeeker,
	})
	if !errors.Is(err, ErrTierRequired) {
		t.Fatalf("seeker→ultra must be rejected, got %v", err)
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

	// seeker — проходит
	_, err = ch.candidates(Request{
		ModelOverride: "openai/gpt-4.1-mini", UserTier: enums.SubscriptionPlanSeeker,
	})
	if err != nil {
		t.Fatalf("seeker must pass: %v", err)
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
