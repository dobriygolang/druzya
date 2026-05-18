package subscription

import (
	"io"
	"log/slog"
	"testing"

	monolithServices "druz9/cmd/monolith/services"
)

// TestWireSubscriptionQuota_FillsDepsByReference — regression-guard за тонкой
// зависимостью: WireSubscriptionQuota должен модифицировать переданный
// *Deps так, чтобы последующие модули видели валидные QuotaResolver /
// QuotaTierGetter / QuotaUsageReader / TrialProGranter.
//
// Если поломать (передать by-value вместо by-pointer или пропустить
// присваивание) — все enforce-гейты молча fall-through'ят в permissive
// ветку, и платящий юзер получает free-tier лимиты.
func TestWireSubscriptionQuota_FillsDepsByReference(t *testing.T) {
	t.Parallel()
	deps := monolithServices.Deps{
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	WireSubscriptionQuota(&deps)

	if deps.QuotaResolver == nil {
		t.Fatal("deps.QuotaResolver is nil after WireSubscriptionQuota")
	}
	if deps.QuotaTierGetter == nil {
		t.Fatal("deps.QuotaTierGetter is nil after WireSubscriptionQuota")
	}
	if deps.QuotaUsageReader == nil {
		t.Fatal("deps.QuotaUsageReader is nil after WireSubscriptionQuota")
	}
	if deps.SetTierUC == nil {
		t.Fatal("deps.SetTierUC is nil after WireSubscriptionQuota")
	}
	if deps.TrialProGranter == nil {
		t.Fatal("deps.TrialProGranter is nil after WireSubscriptionQuota")
	}
}
