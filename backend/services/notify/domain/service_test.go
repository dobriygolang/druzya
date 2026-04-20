package domain

import (
	"testing"
	"time"

	"druz9/shared/enums"
)

func hm(h, m int) time.Time {
	return time.Date(2026, 1, 1, h, m, 0, 0, time.UTC)
}

func TestInQuietHours(t *testing.T) {
	tests := []struct {
		name   string
		from   time.Time
		to     time.Time
		now    time.Time
		expect bool
	}{
		{"not set", time.Time{}, time.Time{}, hm(22, 0), false},
		{"simple inside", hm(9, 0), hm(17, 0), hm(12, 0), true},
		{"simple boundary from=now", hm(9, 0), hm(17, 0), hm(9, 0), true},
		{"simple boundary to=now", hm(9, 0), hm(17, 0), hm(17, 0), false},
		{"simple outside", hm(9, 0), hm(17, 0), hm(8, 59), false},
		{"wrap inside late", hm(22, 0), hm(8, 0), hm(23, 30), true},
		{"wrap inside early", hm(22, 0), hm(8, 0), hm(3, 0), true},
		{"wrap outside", hm(22, 0), hm(8, 0), hm(10, 0), false},
		{"wrap at 08:00 (to boundary)", hm(22, 0), hm(8, 0), hm(8, 0), false},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			set := !tc.from.IsZero() || !tc.to.IsZero()
			q := QuietHours{From: tc.from, To: tc.to, Set: set}
			got := InQuietHours(q, tc.now)
			if got != tc.expect {
				t.Fatalf("want %v, got %v (q=%+v now=%v)", tc.expect, got, q, tc.now)
			}
		})
	}
}

func TestShouldNotify_QuietHoursBlocks(t *testing.T) {
	p := DefaultPreferences()
	p.Quiet = QuietHours{From: hm(22, 0), To: hm(8, 0), Set: true}
	// 23:00 inside wrap window → blocked.
	ok, reason := ShouldNotify(p, enums.NotificationTypeDailyKata, hm(23, 0), nil, false)
	if ok {
		t.Fatalf("expected blocked, got ok")
	}
	if reason != "quiet_hours" {
		t.Fatalf("want quiet_hours, got %s", reason)
	}
}

func TestShouldNotify_ForceBypassesQuiet(t *testing.T) {
	p := DefaultPreferences()
	p.Quiet = QuietHours{From: hm(22, 0), To: hm(8, 0), Set: true}
	ok, _ := ShouldNotify(p, enums.NotificationTypeMatchFound, hm(23, 0), nil, true)
	if !ok {
		t.Fatalf("expected delivery with force=true")
	}
}

func TestShouldNotify_DedupWindow(t *testing.T) {
	p := DefaultPreferences()
	recent := hm(12, 0)
	// now is 10 min after → within 30 min window → blocked.
	now := recent.Add(10 * time.Minute)
	ok, reason := ShouldNotify(p, enums.NotificationTypeMatchResult, now, &recent, false)
	if ok {
		t.Fatalf("expected dedup block")
	}
	if reason != "dedup_window" {
		t.Fatalf("want dedup_window, got %s", reason)
	}

	// 31 min after → allowed.
	ok, _ = ShouldNotify(p, enums.NotificationTypeMatchResult, recent.Add(31*time.Minute), &recent, false)
	if !ok {
		t.Fatalf("expected allow after dedup window")
	}
}

func TestShouldNotify_WeeklyReportOptOut(t *testing.T) {
	p := DefaultPreferences()
	p.WeeklyReportEnabled = false
	ok, reason := ShouldNotify(p, enums.NotificationTypeWeeklyReport, hm(10, 0), nil, false)
	if ok {
		t.Fatalf("expected opt-out block")
	}
	if reason != "weekly_report_disabled" {
		t.Fatalf("want weekly_report_disabled, got %s", reason)
	}
}

func TestShouldNotify_SkillDecayOptOut(t *testing.T) {
	p := DefaultPreferences()
	p.SkillDecayWarningsEnabled = false
	ok, reason := ShouldNotify(p, enums.NotificationTypeSkillDecay, hm(10, 0), nil, false)
	if ok || reason != "skill_decay_disabled" {
		t.Fatalf("want blocked with skill_decay_disabled, got %v/%s", ok, reason)
	}
}

func TestShouldNotify_NoChannels(t *testing.T) {
	p := Preferences{} // zero value, no channels
	ok, reason := ShouldNotify(p, enums.NotificationTypeDailyKata, hm(10, 0), nil, false)
	if ok {
		t.Fatalf("expected block")
	}
	if reason != "no_channels" {
		t.Fatalf("want no_channels, got %s", reason)
	}
}

func TestPickChannel_Priority(t *testing.T) {
	// email+push both enabled, no telegram → email wins.
	p := Preferences{Channels: []enums.NotificationChannel{
		enums.NotificationChannelPush,
		enums.NotificationChannelEmail,
	}}
	got, ok := PickChannel(p)
	if !ok || got != enums.NotificationChannelEmail {
		t.Fatalf("want email, got %v (ok=%v)", got, ok)
	}

	// telegram wins when present.
	p.Channels = append(p.Channels, enums.NotificationChannelTelegram)
	got, ok = PickChannel(p)
	if !ok || got != enums.NotificationChannelTelegram {
		t.Fatalf("want telegram, got %v", got)
	}

	// empty → (empty,false).
	if _, ok := PickChannel(Preferences{}); ok {
		t.Fatalf("want no channel")
	}
}

func TestValidateChannels(t *testing.T) {
	good := []enums.NotificationChannel{enums.NotificationChannelTelegram, enums.NotificationChannelEmail}
	if err := ValidateChannels(good); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
	bad := []enums.NotificationChannel{"smoke_signal"}
	if err := ValidateChannels(bad); err == nil {
		t.Fatalf("want err")
	}
}

func TestHasChannel(t *testing.T) {
	p := Preferences{Channels: []enums.NotificationChannel{
		enums.NotificationChannelTelegram,
		enums.NotificationChannelEmail,
	}}
	if !p.HasChannel(enums.NotificationChannelTelegram) {
		t.Fatalf("want telegram true")
	}
	if p.HasChannel(enums.NotificationChannelPush) {
		t.Fatalf("want push false")
	}
}
