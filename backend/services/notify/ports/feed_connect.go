// feed_connect.go — Connect-RPC adapters for /notifications + /support/ticket.
//
// The chi handlers (user_notifications_handler.go, support_handler.go) stay
// for tests but are no longer mounted by the wirer.
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"connectrpc.com/connect"

	"druz9/notify/app"
	"druz9/notify/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
)

func (s *NotifyServer) ListNotifications(
	ctx context.Context,
	req *connect.Request[pb.ListNotificationsRequest],
) (*connect.Response[pb.NotificationList], error) {
	if s.List == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	f := domain.NotificationFilter{
		Channel:    req.Msg.Channel,
		OnlyUnread: req.Msg.OnlyUnread,
		Limit:      int(req.Msg.Limit),
	}
	if req.Msg.Before != "" {
		if t, err := time.Parse(time.RFC3339, req.Msg.Before); err == nil {
			f.Before = t
		}
	}
	rows, err := s.List.Do(ctx, uid, f)
	if err != nil {
		s.logErr(ctx, "ListNotifications", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	out := &pb.NotificationList{Items: make([]*pb.UserNotification, 0, len(rows))}
	for _, n := range rows {
		out.Items = append(out.Items, notificationToProto(n))
	}
	return connect.NewResponse(out), nil
}

func (s *NotifyServer) CountUnread(
	ctx context.Context,
	_ *connect.Request[pb.CountUnreadRequest],
) (*connect.Response[pb.UnreadCount], error) {
	if s.Unread == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	n, err := s.Unread.Do(ctx, uid)
	if err != nil {
		s.logErr(ctx, "CountUnread", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.UnreadCount{Count: int64(n)}), nil
}

func (s *NotifyServer) MarkRead(
	ctx context.Context,
	req *connect.Request[pb.MarkReadRequest],
) (*connect.Response[pb.MarkReadResponse], error) {
	if s.MarkReadUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if err := s.MarkReadUC.Do(ctx, req.Msg.Id, uid); err != nil {
		s.logErr(ctx, "MarkRead", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.MarkReadResponse{Ok: true}), nil
}

func (s *NotifyServer) MarkAllRead(
	ctx context.Context,
	_ *connect.Request[pb.MarkAllReadRequest],
) (*connect.Response[pb.MarkAllReadResponse], error) {
	if s.MarkAllReadUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	n, err := s.MarkAllReadUC.Do(ctx, uid)
	if err != nil {
		s.logErr(ctx, "MarkAllRead", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.MarkAllReadResponse{Updated: n}), nil
}

// CreateSupportTicket re-uses SupportHandler.create logic via direct repo
// access. Telegram bot notification — best-effort, identical to the chi
// path.
func (s *NotifyServer) CreateSupportTicket(
	ctx context.Context,
	req *connect.Request[pb.CreateSupportTicketRequest],
) (*connect.Response[pb.CreateSupportTicketResponse], error) {
	if s.Support == nil || s.Support.Repo == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	contactKind := req.Msg.ContactKind
	if contactKind == "" {
		contactKind = "telegram" // schema_v2 single-value default
	}
	if contactKind != "telegram" {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("contact_kind must be 'telegram'"))
	}
	contactValue := strings.TrimSpace(req.Msg.ContactValue)
	if contactValue == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("contact_value required"))
	}
	message := strings.TrimSpace(req.Msg.Message)
	if message == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("message required"))
	}
	maxMessage := s.Support.MaxMessage
	if maxMessage <= 0 {
		maxMessage = 5000
	}
	if len(message) > maxMessage {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("message too long"))
	}
	var kind domain.SupportContactKind = domain.SupportContactKind(contactKind) //nolint:unconvert // typed string conversion is intentional for domain validation
	ticket := &domain.SupportTicket{
		ContactKind:  kind,
		ContactValue: contactValue,
		Subject:      strings.TrimSpace(req.Msg.Subject),
		Message:      message,
	}
	if uid, ok := sharedMw.UserIDFromContext(ctx); ok {
		u := uid
		ticket.UserID = &u
	}
	if err := s.Support.Repo.Create(ctx, ticket); err != nil {
		s.logErr(ctx, "CreateSupportTicket", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	if s.Support.BotNotify != nil {
		go func(t domain.SupportTicket) {
			if err := s.Support.BotNotify.NotifySupport(context.Background(), t); err != nil && s.Log != nil {
				s.Log.Warn("notify.CreateSupportTicket: bot notify failed", slog.Any("err", err))
			}
		}(*ticket)
	}
	return connect.NewResponse(&pb.CreateSupportTicketResponse{
		TicketId:  ticket.ID.String(),
		CreatedAt: ticket.CreatedAt.UTC().Format(time.RFC3339),
	}), nil
}

func (s *NotifyServer) logErr(ctx context.Context, where string, err error) {
	if s.Log == nil {
		return
	}
	s.Log.ErrorContext(ctx, "notify."+where, slog.Any("err", err))
}

func notificationToProto(n domain.UserNotification) *pb.UserNotification {
	out := &pb.UserNotification{
		Id: n.ID, Channel: n.Channel, Type: n.Type,
		Title: n.Title, Body: n.Body, Priority: int32(n.Priority),
		CreatedAt: n.CreatedAt.UTC().Format(time.RFC3339),
	}
	if n.ReadAt != nil {
		out.ReadAt = n.ReadAt.UTC().Format(time.RFC3339)
	}
	if len(n.Payload) > 0 {
		if b, err := json.Marshal(n.Payload); err == nil {
			out.PayloadJson = string(b)
		}
	}
	return out
}

// keep app pkg referenced — Server struct holds app.* pointers; the var
// declaration here ensures the import remains live even if the file is
// edited to remove the type-mention.
var _ = app.ListUserNotifications{}
