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
//
// Если req.IncludeShareToken=true, бэк дополнительно выпускает токен
// публичной ссылки через ProfileRepo.IssueShareToken и кладёт его в
// WeeklyReport.share_token. Используется кнопкой «Поделиться» на /weekly.
// Сбой выдачи токена НЕ роняет основной запрос — отчёт отдаётся без поля.
func (s *ProfileServer) GetMyReport(
	ctx context.Context,
	req *connect.Request[pb.GetMyReportRequest],
) (*connect.Response[pb.WeeklyReport], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	v, err := s.fetchReport(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("profile.GetMyReport: %w", s.toConnectErr(err))
	}
	resp := toReportProto(v)
	if req.Msg.GetIncludeShareToken() {
		weekISO := isoWeekKey(v.WeekEnd)
		if s.H.Repo != nil {
			tok, terr := s.H.Repo.IssueShareToken(ctx, uid, weekISO)
			if terr != nil {
				s.H.Log.WarnContext(ctx, "profile.GetMyReport: issue share token",
					slog.Any("err", terr))
			} else {
				resp.ShareToken = tok.Token
			}
		}
	}
	return connect.NewResponse(resp), nil
}

// GetWeeklyShare implements (/profile/weekly/share/{token}). Public — no
// bearer auth. Resolves the token to (user_id, week_iso) via ProfileRepo,
// then assembles the WeeklyReport for that week.
//
// Anti-fallback: 404 on missing/expired token. We do NOT return a 200 with
// an empty payload — the share page must be able to distinguish.
func (s *ProfileServer) GetWeeklyShare(
	ctx context.Context,
	req *connect.Request[pb.GetWeeklyShareRequest],
) (*connect.Response[pb.WeeklyReport], error) {
	token := req.Msg.GetToken()
	if token == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("token is required"))
	}
	if s.H.Repo == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("share lookup unavailable"))
	}
	resv, err := s.H.Repo.ResolveShareToken(ctx, token)
	if err != nil {
		return nil, fmt.Errorf("profile.GetWeeklyShare: resolve: %w", s.toConnectErr(err))
	}
	now := weekEndFromISO(resv.WeekISO)
	v, err := s.H.GetReport.Do(ctx, resv.UserID, now)
	if err != nil {
		return nil, fmt.Errorf("profile.GetWeeklyShare: report: %w", s.toConnectErr(err))
	}
	resp := toReportProto(v)
	// Echo the token back so the public page can show "this is share link".
	resp.ShareToken = token
	return connect.NewResponse(resp), nil
}

// isoWeekKey форматирует время в "YYYY-Www" (ISO 8601 неделя). Используется
// как ключ weekly_share_tokens.week_iso.
func isoWeekKey(t time.Time) string {
	y, w := t.UTC().ISOWeek()
	return fmt.Sprintf("%04d-W%02d", y, w)
}

// weekEndFromISO возвращает воскресенье 23:59:59 UTC для week_iso "YYYY-Www".
// Используется в GetWeeklyShare как `now` для GetReport.Do (он вычисляет
// окно как [now-7d, now]). При невалидной строке возвращает time.Now().
func weekEndFromISO(iso string) time.Time {
	var year, week int
	if _, err := fmt.Sscanf(iso, "%4d-W%2d", &year, &week); err != nil {
		return time.Now().UTC()
	}
	// 4 января всегда в неделе 1 по ISO 8601.
	jan4 := time.Date(year, time.January, 4, 0, 0, 0, 0, time.UTC)
	_, w1 := jan4.ISOWeek()
	mondayWeek1 := jan4.AddDate(0, 0, -int(jan4.Weekday()-time.Monday))
	if jan4.Weekday() == time.Sunday {
		mondayWeek1 = jan4.AddDate(0, 0, -6)
	}
	monday := mondayWeek1.AddDate(0, 0, (week-w1)*7)
	// week-end = monday + 7d (включая весь воскресный день).
	return monday.AddDate(0, 0, 7)
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

// ── error mapping ──────────────────────────────────────────────────────────

func (s *ProfileServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	default:
		s.H.Log.Error("profile: unexpected error", slog.Any("err", err))
		return connect.NewError(connect.CodeInternal, errors.New("profile failure"))
	}
}

// ── converters (domain → proto) ────────────────────────────────────────────

func toProfileFullProto(v app.ProfileView) *pb.ProfileFull {
	b := v.Bundle
	out := &pb.ProfileFull{
		Id:               b.User.ID.String(),
		Username:         b.User.Username,
		DisplayName:      b.User.DisplayName,
		Email:            b.User.Email,
		AvatarFrame:      b.Profile.AvatarFrame,
		Title:            b.Profile.Title,
		Level:            int32(b.Profile.Level),
		Xp:               int32(b.Profile.XP),
		XpToNext:         int32(v.XPToNext),
		CharClass:        charClassToProto(b.Profile.CharClass),
		GlobalPowerScore: int32(v.GlobalPowerScore),
		CareerStage:      b.Profile.CareerStage.String(),
		AiCredits:        int32(b.AICredits),
		Attributes: &pb.Attributes{
			Intellect: int32(v.Attributes.Intellect),
			Strength:  int32(v.Attributes.Strength),
			Dexterity: int32(v.Attributes.Dexterity),
			Will:      int32(v.Attributes.Will),
		},
		Subscription: &pb.ProfileSubscription{
			Plan: subscriptionPlanToProto(b.Subscription.Plan),
		},
	}
	if b.Subscription.CurrentPeriodEnd != nil {
		out.Subscription.CurrentPeriodEnd = timestamppb.New(b.Subscription.CurrentPeriodEnd.UTC())
	}
	if !b.User.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(b.User.CreatedAt.UTC())
	}
	return out
}

func toProfilePublicProto(v app.PublicView) *pb.ProfilePublic {
	b := v.PublicBundle
	out := &pb.ProfilePublic{
		Username:         b.User.Username,
		DisplayName:      b.User.DisplayName,
		Title:            b.Profile.Title,
		Level:            int32(b.Profile.Level),
		CharClass:        charClassToProto(b.Profile.CharClass),
		CareerStage:      b.Profile.CareerStage.String(),
		GlobalPowerScore: int32(v.GlobalPowerScore),
	}
	now := time.Now()
	for _, r := range b.Ratings {
		out.Ratings = append(out.Ratings, &pb.ProfileSectionRating{
			Section:      sectionToProto(r.Section),
			Elo:          int32(r.Elo),
			MatchesCount: int32(r.MatchesCount),
			// Percentile is intentionally 0 here: the public profile lives in
			// the profile service and does not call into rating to keep the
			// service boundary clean. Frontends should treat 0 as "not
			// available on this surface" and prefer GET /rating/me when the
			// caller is the profile owner. Anti-fallback: do NOT invent a
			// stand-in median value (the previous 50 was misleading UX).
			Percentile: 0,
			Decaying:   isDecaying(r.LastMatchAt, now),
		})
	}
	return out
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
		ActionsCount:   int32(r.ActionsCount),
		StreakDays:     int32(r.StreakDays),
		BestStreak:     int32(r.BestStreak),
		PrevXpEarned:   int32(r.PrevXPEarned),
		AiInsight:      r.AIInsight,
		FeaturedMetric: r.FeaturedMetric,
	}
	for _, s := range r.StrongSections {
		out.StrongSections = append(out.StrongSections, &pb.SectionBreakdown{
			Section:    sectionToProto(s.Section),
			Matches:    int32(s.Matches),
			Wins:       int32(s.Wins),
			Losses:     int32(s.Losses),
			XpDelta:    int32(s.XPDelta),
			WinRatePct: int32(s.WinRatePct),
		})
	}
	for _, s := range r.WeakSections {
		out.WeakSections = append(out.WeakSections, &pb.SectionBreakdown{
			Section:    sectionToProto(s.Section),
			Matches:    int32(s.Matches),
			Wins:       int32(s.Wins),
			Losses:     int32(s.Losses),
			XpDelta:    int32(s.XPDelta),
			WinRatePct: int32(s.WinRatePct),
		})
	}
	for _, w := range r.WeeklyXP {
		out.WeeklyXp = append(out.WeeklyXp, &pb.WeekComparison{
			Label: w.Label,
			Xp:    int32(w.XP),
			Pct:   int32(w.Pct),
		})
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
	switch s {
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
	case enums.SubscriptionPlanSeeker:
		return pb.SubscriptionPlan_SUBSCRIPTION_PLAN_SEEKER
	case enums.SubscriptionPlanAscendant:
		return pb.SubscriptionPlan_SUBSCRIPTION_PLAN_ASCENDANT
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
