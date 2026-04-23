// Package ports wires the admin domain to HTTP via Connect-RPC.
//
// ROLE GATE — every method of AdminServer returns PermissionDenied unless
// the caller has role=admin. The check uses sharedMw.UserRoleFromContext
// (populated by requireAuth in main.go). main.go still wraps the transcoder
// in requireAuth; this port adds the admin role check on top. Mirrors the
// Phase A/B pattern — the handler never dips into app/ before the role is
// confirmed.
//
// SOLUTION_HINT EXCEPTION
// Every other domain in druz9 treats tasks.solution_hint as a secret that
// MUST NEVER cross the HTTP boundary (bible §3.14). The admin domain is the
// one legitimate exception: curators explicitly need to author, review and
// edit the hint text as part of the CMS. The role check in this file is the
// load-bearing guard — without role=admin the request never lands at the
// app layer and the hint never appears in a response body.
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"

	"druz9/admin/app"
	"druz9/admin/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// adminRole is the exact claim string that unlocks admin routes.
const adminRole = string(enums.UserRoleAdmin)

// Compile-time assertion — AdminServer satisfies the generated handler.
var _ druz9v1connect.AdminServiceHandler = (*AdminServer)(nil)

// AdminServer adapts admin use cases to Connect.
//
// Field names use the UC suffix to avoid collision with generated method
// names (ListTasks / CreateTask / UpdateTask / …).
//
// Newer surfaces (dashboard / users / reports / status) are nilable on
// purpose — older callers that wire the legacy constructor still compile,
// and the handler returns CodeUnimplemented when a UC isn't bound. The
// monolith's services/admin.go always sets every field.
type AdminServer struct {
	ListTasksUC     *app.ListTasks
	CreateTaskUC    *app.CreateTask
	UpdateTaskUC    *app.UpdateTask
	ListCompaniesUC *app.ListCompanies
	UpsertCompanyUC *app.UpsertCompany
	ListConfigUC    *app.ListConfig
	UpdateConfigUC  *app.UpdateConfig
	ListAnticheatUC *app.ListAnticheat

	// Dashboard / users / reports / status surfaces (Group B).
	GetDashboardUC *app.GetDashboard
	ListUsersUC    *app.ListUsers
	BanUserUC      *app.BanUser
	UnbanUserUC    *app.UnbanUser
	ListReportsUC  *app.ListReports
	GetStatusUC    *app.GetStatus

	Log *slog.Logger
}

// NewAdminServer wires an AdminServer.
func NewAdminServer(
	listTasks *app.ListTasks,
	createTask *app.CreateTask,
	updateTask *app.UpdateTask,
	listCompanies *app.ListCompanies,
	upsertCompany *app.UpsertCompany,
	listConfig *app.ListConfig,
	updateConfig *app.UpdateConfig,
	listAnticheat *app.ListAnticheat,
	log *slog.Logger,
) *AdminServer {
	return &AdminServer{
		ListTasksUC: listTasks, CreateTaskUC: createTask, UpdateTaskUC: updateTask,
		ListCompaniesUC: listCompanies, UpsertCompanyUC: upsertCompany,
		ListConfigUC: listConfig, UpdateConfigUC: updateConfig,
		ListAnticheatUC: listAnticheat,
		Log:             log,
	}
}

// requireAdmin returns the caller's id + true on success. On failure it
// returns the Connect error the caller should propagate.
func (s *AdminServer) requireAdmin(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.Nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	role, rok := sharedMw.UserRoleFromContext(ctx)
	if !rok || role != adminRole {
		return uuid.Nil, connect.NewError(connect.CodePermissionDenied, errors.New("admin role required"))
	}
	return uid, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────

func (s *AdminServer) ListTasks(
	ctx context.Context,
	req *connect.Request[pb.ListAdminTasksRequest],
) (*connect.Response[pb.AdminTaskList], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	m := req.Msg
	f := domain.TaskFilter{
		Page:  int(m.GetPage()),
		Limit: int(m.GetLimit()),
	}
	if pbSec := m.GetSection(); pbSec != pb.Section_SECTION_UNSPECIFIED {
		sec := sectionFromProtoAdmin(pbSec)
		f.Section = &sec
	}
	if pbDiff := m.GetDifficulty(); pbDiff != pb.Difficulty_DIFFICULTY_UNSPECIFIED {
		d := difficultyFromProtoAdmin(pbDiff)
		f.Difficulty = &d
	}
	if m.GetIsActiveSet() {
		v := m.GetIsActive()
		f.IsActive = &v
	}
	page, err := s.ListTasksUC.Do(ctx, f)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.AdminTaskList{
		Total: int32(page.Total),
		Page:  int32(page.Page),
		Items: make([]*pb.AdminTask, 0, len(page.Items)),
	}
	for _, t := range page.Items {
		out.Items = append(out.Items, toAdminTaskProto(t))
	}
	return connect.NewResponse(out), nil
}

func (s *AdminServer) CreateTask(
	ctx context.Context,
	req *connect.Request[pb.CreateAdminTaskRequest],
) (*connect.Response[pb.AdminTask], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	body := req.Msg.GetTask()
	if body == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("task body required"))
	}
	out, err := s.CreateTaskUC.Do(ctx, taskUpsertFromProto(body))
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toAdminTaskProto(out)), nil
}

func (s *AdminServer) UpdateTask(
	ctx context.Context,
	req *connect.Request[pb.UpdateAdminTaskRequest],
) (*connect.Response[pb.AdminTask], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	taskID, err := uuid.Parse(req.Msg.GetTaskId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid task_id: %w", err))
	}
	body := req.Msg.GetTask()
	if body == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("task body required"))
	}
	out, err := s.UpdateTaskUC.Do(ctx, taskID, taskUpsertFromProto(body))
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toAdminTaskProto(out)), nil
}

// ─────────────────────────────────────────────────────────────────────────
// Companies
// ─────────────────────────────────────────────────────────────────────────

func (s *AdminServer) ListCompanies(
	ctx context.Context,
	_ *connect.Request[pb.ListCompaniesRequest],
) (*connect.Response[pb.CompanyList], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	list, err := s.ListCompaniesUC.Do(ctx)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.CompanyList{Items: make([]*pb.Company, 0, len(list))}
	for _, c := range list {
		out.Items = append(out.Items, toCompanyProto(c))
	}
	return connect.NewResponse(out), nil
}

func (s *AdminServer) CreateCompany(
	ctx context.Context,
	req *connect.Request[pb.CreateCompanyRequest],
) (*connect.Response[pb.Company], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	body := req.Msg.GetCompany()
	if body == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("company body required"))
	}
	in := domain.CompanyUpsert{
		Slug:             body.GetSlug(),
		Name:             body.GetName(),
		Difficulty:       dungeonTierFromProto(body.GetDifficulty()),
		MinLevelRequired: int(body.GetMinLevelRequired()),
	}
	out, err := s.UpsertCompanyUC.Do(ctx, in)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toCompanyProto(out)), nil
}

// ─────────────────────────────────────────────────────────────────────────
// Dynamic config
// ─────────────────────────────────────────────────────────────────────────

func (s *AdminServer) ListConfig(
	ctx context.Context,
	_ *connect.Request[pb.ListConfigRequest],
) (*connect.Response[pb.ConfigEntryList], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	list, err := s.ListConfigUC.Do(ctx)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.ConfigEntryList{Items: make([]*pb.ConfigEntry, 0, len(list))}
	for _, c := range list {
		out.Items = append(out.Items, toConfigEntryProto(c))
	}
	return connect.NewResponse(out), nil
}

func (s *AdminServer) UpdateConfig(
	ctx context.Context,
	req *connect.Request[pb.UpdateConfigRequest],
) (*connect.Response[pb.ConfigEntry], error) {
	uid, err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	m := req.Msg
	if m.GetKey() == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("key required"))
	}
	// Re-serialise the opaque Value into JSON bytes so the app layer can
	// round-trip it against the stored type discriminator (same flow as the
	// apigen-era ConfigEntry_Value union).
	raw, err := valueToJSON(m.GetValue())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("value: %w", err))
	}
	in := app.UpdateConfigInput{
		Key:       m.GetKey(),
		Value:     raw,
		UpdatedBy: &uid,
	}
	out, err := s.UpdateConfigUC.Do(ctx, in)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toConfigEntryProto(out)), nil
}

// ─────────────────────────────────────────────────────────────────────────
// Anticheat
// ─────────────────────────────────────────────────────────────────────────

func (s *AdminServer) ListAnticheat(
	ctx context.Context,
	req *connect.Request[pb.ListAnticheatRequest],
) (*connect.Response[pb.AnticheatSignalList], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	m := req.Msg
	f := domain.AnticheatFilter{Limit: int(m.GetLimit())}
	if pbSev := m.GetSeverity(); pbSev != pb.SeverityLevel_SEVERITY_LEVEL_UNSPECIFIED {
		sev := severityFromProto(pbSev)
		f.Severity = &sev
	}
	if m.GetFrom() != nil {
		t := m.GetFrom().AsTime()
		f.From = &t
	}
	list, err := s.ListAnticheatUC.Do(ctx, f)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.AnticheatSignalList{Items: make([]*pb.AnticheatSignal, 0, len(list))}
	for _, sig := range list {
		out.Items = append(out.Items, toAnticheatProto(sig))
	}
	return connect.NewResponse(out), nil
}

// ─────────────────────────────────────────────────────────────────────────
// Error mapping
// ─────────────────────────────────────────────────────────────────────────

func (s *AdminServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrConflict):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, domain.ErrInvalidInput):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		if s.Log != nil {
			s.Log.Error("admin: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("admin failure"))
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Converters (domain → proto)
// ─────────────────────────────────────────────────────────────────────────

func toAdminTaskProto(t domain.AdminTask) *pb.AdminTask {
	out := &pb.AdminTask{
		Id:            t.ID.String(),
		Slug:          t.Slug,
		TitleRu:       t.TitleRU,
		TitleEn:       t.TitleEN,
		DescriptionRu: t.DescriptionRU,
		DescriptionEn: t.DescriptionEN,
		Difficulty:    difficultyToProtoAdmin(t.Difficulty),
		Section:       sectionToProtoAdmin(t.Section),
		TimeLimitSec:  int32(t.TimeLimitSec),
		MemoryLimitMb: int32(t.MemoryLimitMB),
		SolutionHint:  t.SolutionHint, // admin-only — see package doc.
		Version:       int32(t.Version),
		IsActive:      t.IsActive,
	}
	for _, c := range t.TestCases {
		out.TestCases = append(out.TestCases, &pb.AdminTaskTestCase{
			Id:             c.ID.String(),
			Input:          c.Input,
			ExpectedOutput: c.ExpectedOutput,
			IsHidden:       c.IsHidden,
			OrderNum:       int32(c.OrderNum),
		})
	}
	for _, q := range t.FollowUpQuestions {
		out.FollowUpQuestions = append(out.FollowUpQuestions, &pb.AdminTaskFollowUpQuestion{
			QuestionRu: q.QuestionRU,
			QuestionEn: q.QuestionEN,
			AnswerHint: q.AnswerHint,
			OrderNum:   int32(q.OrderNum),
		})
	}
	return out
}

func taskUpsertFromProto(in *pb.AdminTaskUpsert) domain.TaskUpsert {
	out := domain.TaskUpsert{
		Slug:          in.GetSlug(),
		TitleRU:       in.GetTitleRu(),
		TitleEN:       in.GetTitleEn(),
		DescriptionRU: in.GetDescriptionRu(),
		DescriptionEN: in.GetDescriptionEn(),
		Difficulty:    difficultyFromProtoAdmin(in.GetDifficulty()),
		Section:       sectionFromProtoAdmin(in.GetSection()),
		TimeLimitSec:  int(in.GetTimeLimitSec()),
		MemoryLimitMB: int(in.GetMemoryLimitMb()),
		SolutionHint:  in.GetSolutionHint(),
		IsActive:      in.GetIsActive(),
	}
	// Preserve the apigen default behaviour — empty limits fall back to
	// 60s / 256 MB. Without this the domain validation would reject the row.
	if out.TimeLimitSec <= 0 {
		out.TimeLimitSec = 60
	}
	if out.MemoryLimitMB <= 0 {
		out.MemoryLimitMB = 256
	}
	for _, c := range in.GetTestCases() {
		out.TestCases = append(out.TestCases, domain.TestCase{
			Input:          c.GetInput(),
			ExpectedOutput: c.GetExpectedOutput(),
			IsHidden:       c.GetIsHidden(),
			OrderNum:       int(c.GetOrderNum()),
		})
	}
	for _, q := range in.GetFollowUpQuestions() {
		out.FollowUpQuestions = append(out.FollowUpQuestions, domain.FollowUpQuestion{
			QuestionRU: q.GetQuestionRu(),
			QuestionEN: q.GetQuestionEn(),
			AnswerHint: q.GetAnswerHint(),
			OrderNum:   int(q.GetOrderNum()),
		})
	}
	return out
}

func toCompanyProto(c domain.AdminCompany) *pb.Company {
	out := &pb.Company{
		Id:               c.ID.String(),
		Slug:             c.Slug,
		Name:             c.Name,
		Difficulty:       dungeonTierToProto(c.Difficulty),
		MinLevelRequired: int32(c.MinLevelRequired),
	}
	for _, s := range c.Sections {
		out.Sections = append(out.Sections, sectionToProtoAdmin(s))
	}
	return out
}

func toConfigEntryProto(e domain.ConfigEntry) *pb.ConfigEntry {
	out := &pb.ConfigEntry{
		Key:         e.Key,
		Type:        configTypeToProto(e.Type),
		Description: e.Description,
	}
	if !e.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(e.UpdatedAt.UTC())
	}
	if e.UpdatedBy != nil {
		out.UpdatedBy = e.UpdatedBy.String()
	}
	// Populate Value from the raw bytes per the type discriminator — same
	// logic as the apigen fillConfigValue helper, but flowing into a
	// structpb.Value instead of the oneOf union.
	if v, err := valueFromConfig(e); err == nil {
		out.Value = v
	}
	return out
}

func toAnticheatProto(sig domain.AnticheatSignal) *pb.AnticheatSignal {
	out := &pb.AnticheatSignal{
		Id:       sig.ID.String(),
		UserId:   sig.UserID.String(),
		Username: sig.Username,
		Type:     string(sig.Type),
		Severity: severityToProto(sig.Severity),
	}
	if !sig.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(sig.CreatedAt.UTC())
	}
	if sig.MatchID != nil {
		out.MatchId = sig.MatchID.String()
	}
	if len(sig.Metadata) > 0 {
		var meta any
		if err := json.Unmarshal(sig.Metadata, &meta); err == nil {
			if v, err := structpb.NewValue(meta); err == nil {
				out.Metadata = v
			}
		}
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────
// structpb.Value helpers
// ─────────────────────────────────────────────────────────────────────────

// valueToJSON serialises a structpb.Value into the raw JSON bytes the app
// layer expects. nil Value maps to the JSON literal `null`.
func valueToJSON(v *structpb.Value) ([]byte, error) {
	if v == nil {
		return []byte("null"), nil
	}
	b, err := protojson.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal structpb value: %w", err)
	}
	return b, nil
}

// valueFromConfig builds a structpb.Value from the raw JSON stored on a
// ConfigEntry. The OpenAPI oneOf constraint (number|string|bool|object) is
// preserved by switching on the stored type.
func valueFromConfig(e domain.ConfigEntry) (*structpb.Value, error) {
	if len(e.Value) == 0 {
		return structpb.NewNullValue(), nil
	}
	switch e.Type {
	case domain.ConfigTypeInt:
		n, err := strconv.ParseInt(string(e.Value), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse int config value: %w", err)
		}
		return structpb.NewNumberValue(float64(n)), nil
	case domain.ConfigTypeFloat:
		var f float64
		if err := json.Unmarshal(e.Value, &f); err != nil {
			return nil, fmt.Errorf("unmarshal float config value: %w", err)
		}
		return structpb.NewNumberValue(f), nil
	case domain.ConfigTypeString:
		var s string
		if err := json.Unmarshal(e.Value, &s); err != nil {
			return nil, fmt.Errorf("unmarshal string config value: %w", err)
		}
		return structpb.NewStringValue(s), nil
	case domain.ConfigTypeBool:
		var b bool
		if err := json.Unmarshal(e.Value, &b); err != nil {
			return nil, fmt.Errorf("unmarshal bool config value: %w", err)
		}
		return structpb.NewBoolValue(b), nil
	case domain.ConfigTypeJSON:
		var any any
		if err := json.Unmarshal(e.Value, &any); err != nil {
			return nil, fmt.Errorf("unmarshal json config value: %w", err)
		}
		v, err := structpb.NewValue(any)
		if err != nil {
			return nil, fmt.Errorf("build structpb value: %w", err)
		}
		return v, nil
	default:
		// Unknown type — surface the raw bytes via NewValue as a best
		// effort.
		var any any
		if err := json.Unmarshal(e.Value, &any); err == nil {
			v, vErr := structpb.NewValue(any)
			if vErr != nil {
				return nil, fmt.Errorf("build structpb value: %w", vErr)
			}
			return v, nil
		}
		return structpb.NewNullValue(), nil
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Enum adapters
// ─────────────────────────────────────────────────────────────────────────

func sectionToProtoAdmin(s enums.Section) pb.Section {
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

func sectionFromProtoAdmin(s pb.Section) enums.Section {
	switch s {
	case pb.Section_SECTION_UNSPECIFIED:
		return ""
	case pb.Section_SECTION_ALGORITHMS:
		return enums.SectionAlgorithms
	case pb.Section_SECTION_SQL:
		return enums.SectionSQL
	case pb.Section_SECTION_GO:
		return enums.SectionGo
	case pb.Section_SECTION_SYSTEM_DESIGN:
		return enums.SectionSystemDesign
	case pb.Section_SECTION_BEHAVIORAL:
		return enums.SectionBehavioral
	default:
		return ""
	}
}

func difficultyToProtoAdmin(d enums.Difficulty) pb.Difficulty {
	switch d {
	case enums.DifficultyEasy:
		return pb.Difficulty_DIFFICULTY_EASY
	case enums.DifficultyMedium:
		return pb.Difficulty_DIFFICULTY_MEDIUM
	case enums.DifficultyHard:
		return pb.Difficulty_DIFFICULTY_HARD
	default:
		return pb.Difficulty_DIFFICULTY_UNSPECIFIED
	}
}

func difficultyFromProtoAdmin(d pb.Difficulty) enums.Difficulty {
	switch d {
	case pb.Difficulty_DIFFICULTY_UNSPECIFIED:
		return ""
	case pb.Difficulty_DIFFICULTY_EASY:
		return enums.DifficultyEasy
	case pb.Difficulty_DIFFICULTY_MEDIUM:
		return enums.DifficultyMedium
	case pb.Difficulty_DIFFICULTY_HARD:
		return enums.DifficultyHard
	default:
		return ""
	}
}

func dungeonTierToProto(t enums.DungeonTier) pb.DungeonTier {
	switch t {
	case enums.DungeonTierNormal:
		return pb.DungeonTier_DUNGEON_TIER_NORMAL
	case enums.DungeonTierHard:
		return pb.DungeonTier_DUNGEON_TIER_HARD
	case enums.DungeonTierBoss:
		return pb.DungeonTier_DUNGEON_TIER_BOSS
	default:
		return pb.DungeonTier_DUNGEON_TIER_UNSPECIFIED
	}
}

func dungeonTierFromProto(t pb.DungeonTier) enums.DungeonTier {
	switch t {
	case pb.DungeonTier_DUNGEON_TIER_UNSPECIFIED:
		return ""
	case pb.DungeonTier_DUNGEON_TIER_NORMAL:
		return enums.DungeonTierNormal
	case pb.DungeonTier_DUNGEON_TIER_HARD:
		return enums.DungeonTierHard
	case pb.DungeonTier_DUNGEON_TIER_BOSS:
		return enums.DungeonTierBoss
	default:
		return ""
	}
}

func severityToProto(s enums.SeverityLevel) pb.SeverityLevel {
	switch s {
	case enums.SeverityLow:
		return pb.SeverityLevel_SEVERITY_LEVEL_LOW
	case enums.SeverityMedium:
		return pb.SeverityLevel_SEVERITY_LEVEL_MEDIUM
	case enums.SeverityHigh:
		return pb.SeverityLevel_SEVERITY_LEVEL_HIGH
	default:
		return pb.SeverityLevel_SEVERITY_LEVEL_UNSPECIFIED
	}
}

func severityFromProto(s pb.SeverityLevel) enums.SeverityLevel {
	switch s {
	case pb.SeverityLevel_SEVERITY_LEVEL_UNSPECIFIED:
		return ""
	case pb.SeverityLevel_SEVERITY_LEVEL_LOW:
		return enums.SeverityLow
	case pb.SeverityLevel_SEVERITY_LEVEL_MEDIUM:
		return enums.SeverityMedium
	case pb.SeverityLevel_SEVERITY_LEVEL_HIGH:
		return enums.SeverityHigh
	default:
		return ""
	}
}

func configTypeToProto(t domain.ConfigType) pb.ConfigEntryType {
	switch t {
	case domain.ConfigTypeInt:
		return pb.ConfigEntryType_CONFIG_ENTRY_TYPE_INT
	case domain.ConfigTypeFloat:
		return pb.ConfigEntryType_CONFIG_ENTRY_TYPE_FLOAT
	case domain.ConfigTypeString:
		return pb.ConfigEntryType_CONFIG_ENTRY_TYPE_STRING
	case domain.ConfigTypeBool:
		return pb.ConfigEntryType_CONFIG_ENTRY_TYPE_BOOL
	case domain.ConfigTypeJSON:
		return pb.ConfigEntryType_CONFIG_ENTRY_TYPE_JSON
	default:
		return pb.ConfigEntryType_CONFIG_ENTRY_TYPE_UNSPECIFIED
	}
}
