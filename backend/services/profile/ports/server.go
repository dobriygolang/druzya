// Package ports exposes the profile domain via Connect-RPC.
//
// ProfileServer implements druz9v1connect.ProfileServiceHandler (generated
// from proto/druz9/v1/profile.proto). It is mounted in main.go via
// NewProfileServiceHandler + vanguard, so the same handlers serve both the
// native Connect path (/druz9.v1.ProfileService/*) and the REST paths
// declared via google.api.http (/api/v1/profile/*).
//
// GetPublicProfile (/api/v1/profile/{username}) is PUBLIC in OpenAPI; here
// the bearer-auth carve-out is still applied by the REST gate, and the native
// Connect path enforces the same via the main.go connectMux wiring.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/profile/app"
	"druz9/profile/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion — ProfileServer satisfies the generated handler.
var _ druz9v1connect.ProfileServiceHandler = (*ProfileServer)(nil)

// ProfileServer adapts profile use cases to Connect.
type ProfileServer struct {
	H *Handler
}

// NewProfileServer wires a ProfileServer around the Handler.
func NewProfileServer(h *Handler) *ProfileServer { return &ProfileServer{H: h} }

// GetMyProfile implements (/profile/me).
func (s *ProfileServer) GetMyProfile(
	ctx context.Context,
	_ *connect.Request[pb.GetMyProfileRequest],
) (*connect.Response[pb.ProfileFull], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	v, err := s.H.GetProfile.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("profile.GetMyProfile: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toProfileFullProto(v)), nil
}

// GetMyAtlas implements (/profile/me/atlas).
func (s *ProfileServer) GetMyAtlas(
	ctx context.Context,
	_ *connect.Request[pb.GetMyAtlasRequest],
) (*connect.Response[pb.SkillAtlas], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	v, err := s.H.GetAtlas.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("profile.GetMyAtlas: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toAtlasProto(v)), nil
}

// GetMyReport implements (/profile/me/report).
func (s *ProfileServer) GetMyReport(
	ctx context.Context,
	_ *connect.Request[pb.GetMyReportRequest],
) (*connect.Response[pb.WeeklyReport], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	v, err := s.fetchReport(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("profile.GetMyReport: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toReportProto(v)), nil
}

// GetWeeklyShare — share flow удалён, метод оставлен как stub до regen pb.go.
func (s *ProfileServer) GetWeeklyShare(
	_ context.Context,
	_ *connect.Request[pb.GetWeeklyShareRequest],
) (*connect.Response[pb.WeeklyReport], error) {
	return nil, connect.NewError(connect.CodeNotFound, errors.New("share flow removed"))
}

// fetchReport prefers the cached ReportFetcher when configured; otherwise it
// falls back to the un-cached use case directly. Keeping the branch here
// (instead of in cmd wiring) makes the test that exercises the fallback
// trivial: leave H.ReportFetcher nil.
func (s *ProfileServer) fetchReport(ctx context.Context, uid uuid.UUID) (app.ReportView, error) {
	if s.H.ReportFetcher != nil {
		v, err := s.H.ReportFetcher.Get(ctx, uid)
		if err != nil {
			return app.ReportView{}, fmt.Errorf("profile.fetchReport: %w", err)
		}
		return v, nil
	}
	v, err := s.H.GetReport.Do(ctx, uid, time.Now())
	if err != nil {
		return app.ReportView{}, fmt.Errorf("profile.fetchReport: %w", err)
	}
	return v, nil
}

// UpdateSettings implements (PUT /profile/me/settings).
func (s *ProfileServer) UpdateSettings(
	ctx context.Context,
	req *connect.Request[pb.UpdateProfileSettingsRequest],
) (*connect.Response[pb.ProfileSettings], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	in := req.Msg.GetSettings()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("settings is required"))
	}
	settings := fromSettingsProto(in)
	out, err := s.H.UpdateSettings.Do(ctx, uid, settings)
	if err != nil {
		return nil, fmt.Errorf("profile.UpdateSettings: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toSettingsProto(out)), nil
}

// BecomeInterviewer implements (POST /profile/me/become-interviewer).
// Creates a pending application — admin moderation flips the role.
func (s *ProfileServer) BecomeInterviewer(
	ctx context.Context,
	req *connect.Request[pb.BecomeInterviewerRequest],
) (*connect.Response[pb.InterviewerApplication], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	app, err := s.H.BecomeUC.Do(ctx, uid, req.Msg.GetMotivation())
	if err != nil {
		return nil, fmt.Errorf("profile.BecomeInterviewer: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toInterviewerAppProto(app)), nil
}

// GetMyInterviewerApplication implements (GET /profile/me/interviewer-application).
// "Never applied" is a normal empty state, not an error. We return an
// empty response with status="not_submitted" so the frontend can render
// the apply button without catching a 404.
func (s *ProfileServer) GetMyInterviewerApplication(
	ctx context.Context,
	_ *connect.Request[pb.GetMyInterviewerApplicationRequest],
) (*connect.Response[pb.InterviewerApplication], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	app, err := s.H.GetMyAppUC.Do(ctx, uid)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return connect.NewResponse(&pb.InterviewerApplication{
				UserId: uid.String(),
				Status: pb.InterviewerApplicationStatus_INTERVIEWER_APPLICATION_STATUS_NOT_SUBMITTED,
			}), nil
		}
		return nil, fmt.Errorf("profile.GetMyInterviewerApplication: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toInterviewerAppProto(app)), nil
}

// ListInterviewerApplications — admin-only.
func (s *ProfileServer) ListInterviewerApplications(
	ctx context.Context,
	req *connect.Request[pb.ListInterviewerApplicationsRequest],
) (*connect.Response[pb.InterviewerApplicationList], error) {
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	rows, err := s.H.ListAppsUC.Do(ctx, interviewerAppStatusFromProto(req.Msg.GetStatus()))
	if err != nil {
		return nil, fmt.Errorf("profile.ListInterviewerApplications: %w", s.toConnectErr(err))
	}
	out := &pb.InterviewerApplicationList{Items: make([]*pb.InterviewerApplication, 0, len(rows))}
	for _, r := range rows {
		out.Items = append(out.Items, toInterviewerAppProto(r))
	}
	return connect.NewResponse(out), nil
}

func (s *ProfileServer) ApproveInterviewerApplication(
	ctx context.Context,
	req *connect.Request[pb.ApproveInterviewerApplicationRequest],
) (*connect.Response[pb.InterviewerApplication], error) {
	adminID, err := requireAdminUID(ctx)
	if err != nil {
		return nil, err
	}
	appID, err := uuid.Parse(req.Msg.GetApplicationId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid application_id: %w", err))
	}
	app, err := s.H.ApproveAppUC.Do(ctx, appID, adminID, req.Msg.GetNote())
	if err != nil {
		return nil, fmt.Errorf("profile.ApproveInterviewerApplication: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toInterviewerAppProto(app)), nil
}

func (s *ProfileServer) RejectInterviewerApplication(
	ctx context.Context,
	req *connect.Request[pb.RejectInterviewerApplicationRequest],
) (*connect.Response[pb.InterviewerApplication], error) {
	adminID, err := requireAdminUID(ctx)
	if err != nil {
		return nil, err
	}
	appID, err := uuid.Parse(req.Msg.GetApplicationId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid application_id: %w", err))
	}
	app, err := s.H.RejectAppUC.Do(ctx, appID, adminID, req.Msg.GetNote())
	if err != nil {
		return nil, fmt.Errorf("profile.RejectInterviewerApplication: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toInterviewerAppProto(app)), nil
}

// requireAdmin returns Unauthenticated/PermissionDenied unless the caller
// has role=admin in their JWT claims.
func requireAdmin(ctx context.Context) error {
	if _, err := requireAdminUID(ctx); err != nil {
		return err
	}
	return nil
}

func requireAdminUID(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.Nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	role, _ := sharedMw.UserRoleFromContext(ctx)
	if role != string(enums.UserRoleAdmin) {
		return uuid.Nil, connect.NewError(connect.CodePermissionDenied, errors.New("admin role required"))
	}
	return uid, nil
}

// interviewerAppStatusToProto переводит domain string-status в proto enum.
// Unknown/empty → UNSPECIFIED — frontend через нормализатор покажет
// безопасный fallback.
func interviewerAppStatusToProto(s string) pb.InterviewerApplicationStatus {
	switch s {
	case "not_submitted":
		return pb.InterviewerApplicationStatus_INTERVIEWER_APPLICATION_STATUS_NOT_SUBMITTED
	case "pending":
		return pb.InterviewerApplicationStatus_INTERVIEWER_APPLICATION_STATUS_PENDING
	case "approved":
		return pb.InterviewerApplicationStatus_INTERVIEWER_APPLICATION_STATUS_APPROVED
	case "rejected":
		return pb.InterviewerApplicationStatus_INTERVIEWER_APPLICATION_STATUS_REJECTED
	default:
		return pb.InterviewerApplicationStatus_INTERVIEWER_APPLICATION_STATUS_UNSPECIFIED
	}
}

// interviewerAppStatusFromProto — обратное преобразование для filter-input
// в ListInterviewerApplications. UNSPECIFIED → "" (caller defaults to pending).
func interviewerAppStatusFromProto(s pb.InterviewerApplicationStatus) string {
	switch s {
	case pb.InterviewerApplicationStatus_INTERVIEWER_APPLICATION_STATUS_NOT_SUBMITTED:
		return "not_submitted"
	case pb.InterviewerApplicationStatus_INTERVIEWER_APPLICATION_STATUS_PENDING:
		return "pending"
	case pb.InterviewerApplicationStatus_INTERVIEWER_APPLICATION_STATUS_APPROVED:
		return "approved"
	case pb.InterviewerApplicationStatus_INTERVIEWER_APPLICATION_STATUS_REJECTED:
		return "rejected"
	case pb.InterviewerApplicationStatus_INTERVIEWER_APPLICATION_STATUS_UNSPECIFIED:
		return ""
	default:
		return ""
	}
}

func toInterviewerAppProto(a domain.InterviewerApplication) *pb.InterviewerApplication {
	out := &pb.InterviewerApplication{
		Id:              a.ID.String(),
		UserId:          a.UserID.String(),
		Motivation:      a.Motivation,
		Status:          interviewerAppStatusToProto(a.Status),
		DecisionNote:    a.DecisionNote,
		UserUsername:    a.UserUsername,
		UserDisplayName: a.UserDisplayName,
	}
	if !a.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(a.CreatedAt.UTC())
	}
	if a.ReviewedBy != nil {
		out.ReviewedBy = a.ReviewedBy.String()
	}
	if a.ReviewedAt != nil {
		out.ReviewedAt = timestamppb.New(a.ReviewedAt.UTC())
	}
	return out
}

// GetPublicProfile implements (/profile/{username}).
func (s *ProfileServer) GetPublicProfile(
	ctx context.Context,
	req *connect.Request[pb.GetPublicProfileRequest],
) (*connect.Response[pb.ProfilePublic], error) {
	username := req.Msg.GetUsername()
	if username == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("username is required"))
	}
	v, err := s.H.GetPublic.Do(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("profile.GetPublicProfile: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toProfilePublicProto(v)), nil
}

// GetUserTracks implements (/profile/me/tracks).
func (s *ProfileServer) GetUserTracks(
	ctx context.Context,
	_ *connect.Request[pb.GetUserTracksRequest],
) (*connect.Response[pb.UserTracks], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.H.GetUserTracks == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("tracks UC not wired"))
	}
	items, err := s.H.GetUserTracks.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("profile.GetUserTracks: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toUserTracksProto(items)), nil
}

// SetUserTracks implements (/profile/me/tracks PUT). Replaces the user's
// track list atomically. Empty list and missing primary are 400's.
func (s *ProfileServer) SetUserTracks(
	ctx context.Context,
	req *connect.Request[pb.SetUserTracksRequest],
) (*connect.Response[pb.UserTracks], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.H.SetUserTracks == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("tracks UC not wired"))
	}
	items, err := tracksFromProto(req.Msg.Items)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	out, err := s.H.SetUserTracks.Do(ctx, uid, items)
	if err != nil {
		return nil, fmt.Errorf("profile.SetUserTracks: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toUserTracksProto(out)), nil
}

// ── error mapping ──────────────────────────────────────────────────────────

func (s *ProfileServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrInvalidTracks):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		s.H.Log.Error("profile: unexpected error", slog.Any("err", err))
		return connect.NewError(connect.CodeInternal, errors.New("profile failure"))
	}
}

// ── converters (domain → proto) ────────────────────────────────────────────

func toProfileFullProto(v app.ProfileView) *pb.ProfileFull {
	b := v.Bundle
	out := &pb.ProfileFull{
		Id:          b.User.ID.String(),
		Username:    b.User.Username,
		DisplayName: b.User.DisplayName,
		Email:       b.User.Email,
		Level:       int32(b.Profile.Level),
		Xp:          int32(b.Profile.XP),
		XpToNext:    int32(v.XPToNext),
		CharClass:   charClassToProto(b.Profile.CharClass),
		Subscription: &pb.ProfileSubscription{
			Plan: subscriptionPlanToProto(b.Subscription.Plan),
		},
		Role: userRoleToProto(b.User.Role),
	}
	if b.Subscription.CurrentPeriodEnd != nil {
		out.Subscription.CurrentPeriodEnd = timestamppb.New(b.Subscription.CurrentPeriodEnd.UTC())
	}
	if !b.User.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(b.User.CreatedAt.UTC())
	}
	return out
}

// userRoleToProto mirrors the auth-service helper. Lives here too to keep the
// profile package free of cross-service imports.
func userRoleToProto(r enums.UserRole) pb.UserRole {
	switch r {
	case enums.UserRoleUser:
		return pb.UserRole_USER_ROLE_USER
	case enums.UserRoleInterviewer:
		return pb.UserRole_USER_ROLE_INTERVIEWER
	case enums.UserRoleAdmin:
		return pb.UserRole_USER_ROLE_ADMIN
	case enums.UserRoleGuest:
		// Guests don't have public profiles surfaced via this endpoint;
		// returning UNSPECIFIED is correct (proto-regen for GUEST is a
		// future increment).
		return pb.UserRole_USER_ROLE_UNSPECIFIED
	default:
		return pb.UserRole_USER_ROLE_UNSPECIFIED
	}
}

func toProfilePublicProto(v app.PublicView) *pb.ProfilePublic {
	b := v.PublicBundle
	return &pb.ProfilePublic{
		Username:    b.User.Username,
		DisplayName: b.User.DisplayName,
		Level:       int32(b.Profile.Level),
		CharClass:   charClassToProto(b.Profile.CharClass),
	}
}

func toAtlasProto(v app.AtlasView) *pb.SkillAtlas {
	out := &pb.SkillAtlas{
		CenterNode: v.CenterNode,
		Nodes:      make([]*pb.SkillNode, 0, len(v.Nodes)),
		Edges:      make([]*pb.SkillEdge, 0, len(v.Edges)),
	}
	for _, n := range v.Nodes {
		node := &pb.SkillNode{
			Key:         n.Key,
			Title:       n.Title,
			Description: n.Description,
			Section:     sectionToProto(n.Section),
			Kind:        n.Kind,
			Cluster:     n.Cluster,
			Progress:    int32(n.Progress),
			Unlocked:    n.Unlocked,
			Decaying:    n.Decaying,
			Reachable:   n.Reachable,
			SolvedCount: int32(n.SolvedCount),
			TotalCount:  int32(n.TotalCount),
			IsUserOwned: n.IsUserOwned,
			Pinned:      n.Pinned,
			Hidden:      n.Hidden,
		}
		if n.PosX != nil && n.PosY != nil {
			node.PosX = int32(*n.PosX)
			node.PosY = int32(*n.PosY)
			node.PosSet = true
		}
		if n.LastSolvedAt != nil {
			node.LastSolvedAt = timestamppb.New(*n.LastSolvedAt)
		}
		if len(n.RecommendedKata) > 0 {
			node.RecommendedKata = make([]*pb.KataRef, 0, len(n.RecommendedKata))
			for _, k := range n.RecommendedKata {
				node.RecommendedKata = append(node.RecommendedKata, &pb.KataRef{
					Id:               k.ID,
					Title:            k.Title,
					Difficulty:       k.Difficulty,
					EstimatedMinutes: int32(k.EstimatedMinutes),
				})
			}
		}
		out.Nodes = append(out.Nodes, node)
	}
	for _, e := range v.Edges {
		out.Edges = append(out.Edges, &pb.SkillEdge{From: e.From, To: e.To, Kind: e.Kind})
	}
	return out
}

func toReportProto(r app.ReportView) *pb.WeeklyReport {
	out := &pb.WeeklyReport{
		WeekStart: r.WeekStart.Format("2006-01-02"),
		WeekEnd:   r.WeekEnd.Format("2006-01-02"),
		Metrics: &pb.ReportMetrics{
			TasksSolved:  int32(r.Metrics.TasksSolved),
			MatchesWon:   int32(r.Metrics.MatchesWon),
			RatingChange: int32(r.Metrics.RatingChange),
			XpEarned:     int32(r.Metrics.XPEarned),
			TimeMinutes:  int32(r.Metrics.TimeMinutes),
		},
		Strengths:      append([]string{}, r.Strengths...),
		StressAnalysis: r.StressAnalysis,
		AiInsight:      r.AIInsight,
	}
	if len(r.Heatmap) > 0 {
		out.Heatmap = make([]int32, 0, len(r.Heatmap))
		for _, h := range r.Heatmap {
			out.Heatmap = append(out.Heatmap, int32(h))
		}
	}
	for _, w := range r.Weaknesses {
		out.Weaknesses = append(out.Weaknesses, &pb.ReportWeakness{
			AtlasNodeKey: w.AtlasNodeKey,
			Reason:       w.Reason,
		})
	}
	for _, rec := range r.Recommendations {
		// OpenAPI's params allow any JSON; proto collapses to map<string,string>.
		var params map[string]string
		if len(rec.Params) > 0 {
			params = make(map[string]string, len(rec.Params))
			for k, v := range rec.Params {
				params[k] = fmt.Sprintf("%v", v)
			}
		}
		out.Recommendations = append(out.Recommendations, &pb.Recommendation{
			Title:       rec.Title,
			Description: rec.Description,
			Action: &pb.RecommendationAction{
				Kind:   rec.ActionKind,
				Params: params,
			},
		})
	}
	return out
}

func toSettingsProto(s domain.Settings) *pb.ProfileSettings {
	// onboarding_completed + focus_class are proto3 `optional` so we always
	// emit a pointer; the read path returns the derived/stored value, so a
	// pointer is always safe to set (even when value == zero).
	onboarding := s.OnboardingCompleted
	focus := s.FocusClass
	out := &pb.ProfileSettings{
		DisplayName:         s.DisplayName,
		DefaultLanguage:     languageToProto(s.DefaultLanguage),
		Locale:              s.Locale,
		VoiceModeEnabled:    s.VoiceModeEnabled,
		AiInsightModel:      s.AIInsightModel,
		OnboardingCompleted: &onboarding,
		FocusClass:          &focus,
	}
	channels := make([]pb.NotificationChannel, 0, len(s.Notifications.Channels))
	for _, c := range s.Notifications.Channels {
		channels = append(channels, notificationChannelToProto(c))
	}
	out.Notifications = &pb.NotificationPreferences{
		Channels:                  channels,
		TelegramChatId:            s.Notifications.TelegramChatID,
		WeeklyReportEnabled:       s.Notifications.WeeklyReportEnabled,
		SkillDecayWarningsEnabled: s.Notifications.SkillDecayWarningsEnabled,
	}
	return out
}

func fromSettingsProto(req *pb.ProfileSettings) domain.Settings {
	s := domain.Settings{
		DisplayName:      req.GetDisplayName(),
		VoiceModeEnabled: req.GetVoiceModeEnabled(),
		Locale:           req.GetLocale(),
		AIInsightModel:   req.GetAiInsightModel(),
	}
	// Wave-10: optional proto3 fields carry presence so a PUT that omits
	// focus_class / onboarding_completed leaves the DB column untouched.
	if req.OnboardingCompleted != nil {
		s.HasOnboardingCompleted = true
		s.OnboardingCompleted = req.GetOnboardingCompleted()
	}
	if req.FocusClass != nil {
		s.HasFocusClass = true
		s.FocusClass = req.GetFocusClass()
	}
	if req.GetDefaultLanguage() != pb.Language_LANGUAGE_UNSPECIFIED {
		s.DefaultLanguage = languageFromProto(req.GetDefaultLanguage())
	}
	if n := req.GetNotifications(); n != nil {
		chs := n.GetChannels()
		channels := make([]enums.NotificationChannel, 0, len(chs))
		for _, c := range chs {
			channels = append(channels, notificationChannelFromProto(c))
		}
		s.Notifications = domain.NotificationPrefs{
			Channels:                  channels,
			TelegramChatID:            n.GetTelegramChatId(),
			WeeklyReportEnabled:       n.GetWeeklyReportEnabled(),
			SkillDecayWarningsEnabled: n.GetSkillDecayWarningsEnabled(),
		}
	}
	return s
}

// ── enum adapters ──────────────────────────────────────────────────────────

func sectionToProto(s enums.Section) pb.Section {
	switch s { //nolint:exhaustive // free-form sections fall through to default
	case enums.SectionAlgorithms:
		return pb.Section_SECTION_ALGORITHMS
	case enums.SectionSQL:
		return pb.Section_SECTION_SQL
	case enums.SectionGo:
		return pb.Section_SECTION_GO
	case enums.SectionSystemDesign:
		return pb.Section_SECTION_SYSTEM_DESIGN
	case enums.SectionBehavioral:
		return pb.Section_SECTION_BEHAVIORAL
	default:
		return pb.Section_SECTION_UNSPECIFIED
	}
}

func languageToProto(l enums.Language) pb.Language {
	switch l {
	case enums.LanguageGo:
		return pb.Language_LANGUAGE_GO
	case enums.LanguagePython:
		return pb.Language_LANGUAGE_PYTHON
	case enums.LanguageJavaScript:
		return pb.Language_LANGUAGE_JAVASCRIPT
	case enums.LanguageTypeScript:
		return pb.Language_LANGUAGE_TYPESCRIPT
	case enums.LanguageSQL:
		return pb.Language_LANGUAGE_SQL
	default:
		return pb.Language_LANGUAGE_UNSPECIFIED
	}
}

func languageFromProto(l pb.Language) enums.Language {
	switch l {
	case pb.Language_LANGUAGE_GO:
		return enums.LanguageGo
	case pb.Language_LANGUAGE_PYTHON:
		return enums.LanguagePython
	case pb.Language_LANGUAGE_JAVASCRIPT:
		return enums.LanguageJavaScript
	case pb.Language_LANGUAGE_TYPESCRIPT:
		return enums.LanguageTypeScript
	case pb.Language_LANGUAGE_SQL:
		return enums.LanguageSQL
	case pb.Language_LANGUAGE_UNSPECIFIED:
		return ""
	default:
		return ""
	}
}

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
	case pb.NotificationChannel_NOTIFICATION_CHANNEL_UNSPECIFIED:
		return ""
	default:
		return ""
	}
}

func charClassToProto(c enums.CharClass) pb.CharClass {
	switch c {
	case enums.CharClassNovice:
		return pb.CharClass_CHAR_CLASS_NOVICE
	case enums.CharClassAlgorithmist:
		return pb.CharClass_CHAR_CLASS_ALGORITHMIST
	case enums.CharClassDBA:
		return pb.CharClass_CHAR_CLASS_DBA
	case enums.CharClassBackendDev:
		return pb.CharClass_CHAR_CLASS_BACKEND_DEV
	case enums.CharClassArchitect:
		return pb.CharClass_CHAR_CLASS_ARCHITECT
	case enums.CharClassCommunicator:
		return pb.CharClass_CHAR_CLASS_COMMUNICATOR
	case enums.CharClassAscendant:
		return pb.CharClass_CHAR_CLASS_ASCENDANT
	default:
		return pb.CharClass_CHAR_CLASS_UNSPECIFIED
	}
}

func subscriptionPlanToProto(p enums.SubscriptionPlan) pb.SubscriptionPlan {
	switch p {
	case enums.SubscriptionPlanFree:
		return pb.SubscriptionPlan_SUBSCRIPTION_PLAN_FREE
	case enums.SubscriptionPlanPro:
		return pb.SubscriptionPlan_SUBSCRIPTION_PLAN_PRO
	case enums.SubscriptionPlanMax:
		return pb.SubscriptionPlan_SUBSCRIPTION_PLAN_MAX
	default:
		return pb.SubscriptionPlan_SUBSCRIPTION_PLAN_UNSPECIFIED
	}
}

func isDecaying(last *time.Time, now time.Time) bool {
	if last == nil {
		return false
	}
	return now.Sub(*last) > 7*24*time.Hour
}

// ── tracks converters ──────────────────────────────────────────────────────

func toUserTracksProto(items []domain.UserTrack) *pb.UserTracks {
	out := &pb.UserTracks{Items: make([]*pb.UserTrack, 0, len(items))}
	for _, it := range items {
		out.Items = append(out.Items, &pb.UserTrack{
			Track:        trackToProto(it.Track),
			Seniority:    string(it.Seniority),
			Primary:      it.Primary,
			StartedAt:    timestamppb.New(it.StartedAt),
			LastActiveAt: timestamppb.New(it.LastActiveAt),
		})
	}
	return out
}

// tracksFromProto converts inbound proto items into domain values. The
// timestamps are intentionally ignored — server-authoritative columns
// like started_at must not be writable from the client (a forged old
// started_at would lie to the cohort analysis).
func tracksFromProto(items []*pb.UserTrack) ([]domain.UserTrack, error) {
	out := make([]domain.UserTrack, 0, len(items))
	for i, it := range items {
		if it == nil {
			return nil, fmt.Errorf("items[%d]: nil", i)
		}
		t, err := trackFromProto(it.Track)
		if err != nil {
			return nil, fmt.Errorf("items[%d]: %w", i, err)
		}
		out = append(out, domain.UserTrack{
			Track:     t,
			Seniority: domain.Seniority(it.Seniority),
			Primary:   it.Primary,
		})
	}
	return out, nil
}

func trackToProto(t domain.Track) pb.Track {
	switch t {
	case domain.TrackDev:
		return pb.Track_TRACK_DEV
	case domain.TrackDevSenior:
		return pb.Track_TRACK_DEV_SENIOR
	case domain.TrackSysanalyst:
		return pb.Track_TRACK_SYSANALYST
	case domain.TrackProductAnalyst:
		return pb.Track_TRACK_PRODUCT_ANALYST
	case domain.TrackQA:
		return pb.Track_TRACK_QA
	case domain.TrackEnglish:
		return pb.Track_TRACK_ENGLISH
	default:
		return pb.Track_TRACK_UNSPECIFIED
	}
}

func trackFromProto(t pb.Track) (domain.Track, error) {
	switch t { //nolint:exhaustive // TRACK_UNSPECIFIED is rejected via default branch with a friendly error
	case pb.Track_TRACK_DEV:
		return domain.TrackDev, nil
	case pb.Track_TRACK_DEV_SENIOR:
		return domain.TrackDevSenior, nil
	case pb.Track_TRACK_SYSANALYST:
		return domain.TrackSysanalyst, nil
	case pb.Track_TRACK_PRODUCT_ANALYST:
		return domain.TrackProductAnalyst, nil
	case pb.Track_TRACK_QA:
		return domain.TrackQA, nil
	case pb.Track_TRACK_ENGLISH:
		return domain.TrackEnglish, nil
	default:
		return "", fmt.Errorf("unknown track %v", t)
	}
}
