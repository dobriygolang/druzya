package app

import (
	"context"
	"fmt"

	"druz9/auth/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"
)

// publishLoginEvent fans the right post-auth event onto the shared bus.
// `created` switches between UserRegistered (first-time signup) and
// UserLoggedIn (returning user). All four entry points — LoginYandex,
// LoginTelegram, PollTelegramCode, DevLogin — share this helper so the
// event semantics stay identical regardless of provider.
//
// `base.At` is package-private in shared/domain — events published from
// outside carry a zero OccurredAt. The in-process bus does not depend on
// this field; when migrating to NATS the bus adapter will stamp its own.
func publishLoginEvent(ctx context.Context, bus sharedDomain.Bus, user domain.User, p enums.AuthProvider, created bool) error {
	var ev sharedDomain.Event
	if created {
		ev = sharedDomain.UserRegistered{
			UserID:   user.ID,
			Username: user.Username,
			Provider: p,
		}
	} else {
		ev = sharedDomain.UserLoggedIn{
			UserID:   user.ID,
			Provider: p,
		}
	}
	if err := bus.Publish(ctx, ev); err != nil {
		return fmt.Errorf("publish %s: %w", ev.Topic(), err)
	}
	return nil
}
