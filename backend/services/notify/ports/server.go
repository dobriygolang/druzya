// Package ports exposes the notify domain via Connect-RPC.
//
// NotifyServer implements druz9v1connect.NotifyServiceHandler (generated from
// proto/druz9/v1/notify.proto). It is mounted in main.go via
// NewNotifyServiceHandler + vanguard, so the same handlers serve both the
// native Connect path (/druz9.v1.NotifyService/*) and the REST paths declared
// via google.api.http (/api/v1/notify/preferences).
//
// The Telegram bot webhook (/api/v1/notify/telegram/webhook) is intentionally
// NOT modelled in the proto — it's a raw chi route that verifies its own
// shared secret and stays out of Connect. See main.go for that mount.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/notify/app"
	"druz9/notify/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
)

// Compile-time assertion — NotifyServer satisfies the generated handler.
var _ druz9v1connect.NotifyServiceHandler = (*NotifyServer)(nil)

// NotifyServer adapts notify use cases to Connect.
type NotifyServer struct {
	Get    *app.GetPreferences
	Update *app.UpdatePreferences
	Log    *slog.Logger
}

// NewNotifyServer wires a NotifyServer.
func NewNotifyServer(get *app.GetPreferences, update *app.UpdatePreferences, log *slog.Logger) *NotifyServer {
	return &NotifyServer{Get: get, Update: update, Log: log}
}

// GetPreferences implements druz9.v1.NotifyService/GetPreferences.
func (s *NotifyServer) GetPreferences(
	ctx context.Context,
	_ *connect.Request[pb.GetNotifyPreferencesRequest],
) (*connect.Response[pb.NotificationPreferences], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	p, err := s.Get.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("notify.GetPreferences: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toPreferencesProto(p)), nil
}

// UpdatePreferences implements druz9.v1.NotifyService/UpdatePreferences.
func (s *NotifyServer) UpdatePreferences(
	ctx context.Context,
	req *connect.Request[pb.UpdateNotifyPreferencesRequest],
) (*connect.Response[pb.NotificationPreferences], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	prefs := req.Msg.GetPreferences()
	if prefs == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("preferences is required"))
	}
	p := fromPreferencesProto(uid.String(), prefs)
	p.UserID = uid
	if err := domain.ValidateChannels(p.Channels); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	out, err := s.Update.Do(ctx, p)
	if err != nil {
		return nil, fmt.Errorf("notify.UpdatePreferences: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toPreferencesProto(out)), nil
}

func (s *NotifyServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrInvalidChannel):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		s.Log.Error("notify: unexpected error", slog.Any("err", err))
		return connect.NewError(connect.CodeInternal, errors.New("notify failure"))
	}
}

// ── converters ─────────────────────────────────────────────────────────────

func toPreferencesProto(p domain.Preferences) *pb.NotificationPreferences {
	channels := make([]pb.NotificationChannel, 0, len(p.Channels))
	for _, c := range p.Channels {
		channels = append(channels, notificationChannelToProto(c))
	}
	out := &pb.NotificationPreferences{
		Channels:                  channels,
		TelegramChatId:            p.TelegramChatID,
		WeeklyReportEnabled:       p.WeeklyReportEnabled,
		SkillDecayWarningsEnabled: p.SkillDecayWarningsEnabled,
	}
	if p.Quiet.Set {
		out.QuietHours = &pb.QuietHours{
			From: p.Quiet.From.Format("15:04"),
			To:   p.Quiet.To.Format("15:04"),
		}
	}
	return out
}

// fromPreferencesProto accepts the raw id-as-string and rebuilds a domain
// record. The caller overwrites UserID with the ctx-resolved UUID.
func fromPreferencesProto(_ string, in *pb.NotificationPreferences) domain.Preferences {
	p := domain.Preferences{}
	if chs := in.GetChannels(); len(chs) > 0 {
		out := make([]enums.NotificationChannel, 0, len(chs))
		for _, c := range chs {
			out = append(out, notificationChannelFromProto(c))
		}
		p.Channels = out
	}
	p.TelegramChatID = in.GetTelegramChatId()
	p.WeeklyReportEnabled = in.GetWeeklyReportEnabled()
	p.SkillDecayWarningsEnabled = in.GetSkillDecayWarningsEnabled()
	if q := in.GetQuietHours(); q != nil {
		qh := domain.QuietHours{Set: true}
		if t, err := time.Parse("15:04", q.GetFrom()); err == nil {
			qh.From = t
		}
		if t, err := time.Parse("15:04", q.GetTo()); err == nil {
			qh.To = t
		}
		p.Quiet = qh
	}
	return p
}

// ── enum adapters ──────────────────────────────────────────────────────────

func notificationChannelToProto(c enums.NotificationChannel) pb.NotificationChannel {
	switch c {
	case enums.NotificationChannelTelegram:
		return pb.NotificationChannel_NOTIFICATION_CHANNEL_TELEGRAM
	case enums.NotificationChannelEmail:
		return pb.NotificationChannel_NOTIFICATION_CHANNEL_EMAIL
	case enums.NotificationChannelPush:
		return pb.NotificationChannel_NOTIFICATION_CHANNEL_PUSH
	default:
		return pb.NotificationChannel_NOTIFICATION_CHANNEL_UNSPECIFIED
	}
}

func notificationChannelFromProto(c pb.NotificationChannel) enums.NotificationChannel {
	switch c {
	case pb.NotificationChannel_NOTIFICATION_CHANNEL_TELEGRAM:
		return enums.NotificationChannelTelegram
	case pb.NotificationChannel_NOTIFICATION_CHANNEL_EMAIL:
		return enums.NotificationChannelEmail
	case pb.NotificationChannel_NOTIFICATION_CHANNEL_PUSH:
		return enums.NotificationChannelPush
	default:
		return ""
	}
}
