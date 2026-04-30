// Package ports exposes the Hone domain via Connect-RPC. HoneServer
// implements druz9v1connect.HoneServiceHandler (generated from hone.proto).
//
// Wiring: cmd/monolith/services/hone.go constructs infra + app + NewHoneServer,
// then mounts via druz9v1connect.NewHoneServiceHandler + vanguard so the same
// handlers serve Connect-RPC and REST (/api/v1/hone/*) on the same paths.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/hone/app"
	"druz9/hone/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/shared/pkg/ratelimit"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ForcePlanLimitPerWindow / ForcePlanWindow — лимит на ручную регенерацию
// дневного плана. 1 запрос в 5 минут на пользователя защищает LLM-квоту от
// спама «⌘R, ⌘R, ⌘R» в UI и от случайного цикла при сбое кеш-слоя.
// Автоматические вызовы (force=false) не лимитируются — они возвращают
// кеш за миллисекунды.
const (
	ForcePlanLimitPerWindow = 1
	ForcePlanWindow         = 5 * time.Minute
)

// Compile-time assertion — HoneServer satisfies the generated handler. This
// guard fires the first time `make gen-proto` generates the interface, which
// is also the first time this package can be compiled.
//
// STUB: uncomment once proto is generated (druz9v1connect.HoneServiceHandler
// doesn't exist yet). Kept commented so the package compiles in isolation.
//
// var _ druz9v1connect.HoneServiceHandler = (*HoneServer)(nil)

// Silence unused-import warning until the interface-guard above is enabled.
var _ = druz9v1connect.NewDailyServiceHandler

// HoneServer adapts hone use cases to Connect.
type HoneServer struct {
	H *app.Handler
	// PlanLimiter rate-limits GenerateDailyPlan when force=true. nil-safe:
	// when Redis is not wired (tests, local-dev without redis), force calls
	// pass through unlimited — the only cost is shared LLM-quota burn, which
	// matters in production and not in dev.
	PlanLimiter *ratelimit.RedisFixedWindow
	// Tier nil-safe: когда nil (в dev или когда subscription-сервис не
	// зависел ещё), premium-gate'ы пропускают всех — это сознательный
	// fallback, не fake'им subscription-status.
	Tier domain.TierReader
	// CheckCreateNoteQuota — Phase 2 hook для quota enforcement. Free
	// tier'ы лимитятся по synced_notes (10 by default). Wired в monolith
	// services/hone.go через subscription Deps. nil-safe: passthrough.
	CheckCreateNoteQuota func(ctx context.Context, userID uuid.UUID) error
}

// NewHoneServer wires a HoneServer around the Handler.
func NewHoneServer(h *app.Handler) *HoneServer { return &HoneServer{H: h} }

// WithPlanLimiter returns a copy with the rate-limiter attached. Call from
// monolith wiring once Redis is available.
func (s *HoneServer) WithPlanLimiter(l *ratelimit.RedisFixedWindow) *HoneServer {
	s.PlanLimiter = l
	return s
}

// WithTier — attach subscription tier reader для premium-gate'а.
// nil-safe: не вызывать = все premium-RPC открыты.
func (s *HoneServer) WithTier(t domain.TierReader) *HoneServer {
	s.Tier = t
	return s
}

// WithCreateNoteQuotaCheck — wire quota-check pre-CreateNote. См. Phase 2
// архитектуру в cmd/monolith/services/quota_enforce.go.
func (s *HoneServer) WithCreateNoteQuotaCheck(
	check func(ctx context.Context, userID uuid.UUID) error,
) *HoneServer {
	s.CheckCreateNoteQuota = check
	return s
}

// requirePro проверяет tier перед вызовом premium handler'а. Возвращает
// nil если gate не вооружён (Tier == nil) или пользователь Pro.
func (s *HoneServer) requirePro(ctx context.Context, uid uuid.UUID) error {
	if s.Tier == nil {
		return nil
	}
	ok, err := s.Tier.IsPro(ctx, uid)
	if err != nil {
		// Anti-fallback: surface the real error rather than silently
		// granting Pro access on transient subscription-DB blips. Better
		// a clear 5xx the operator can see in metrics than an opaque
		// "everything looked fine" path that masks a subscription outage.
		s.H.Log.Error("hone.requirePro: tier check failed",
			slog.Any("err", err), slog.String("user_id", uid.String()))
		return fmt.Errorf("hone.requirePro: %w", err)
	}
	if !ok {
		return domain.ErrProRequired
	}
	return nil
}

// ─── Plan ──────────────────────────────────────────────────────────────────

// GenerateDailyPlan implements druz9.v1.HoneService/GenerateDailyPlan.
func (s *HoneServer) GenerateDailyPlan(
	ctx context.Context,
	req *connect.Request[pb.GenerateDailyPlanRequest],
) (*connect.Response[pb.Plan], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	if gerr := s.requirePro(ctx, uid); gerr != nil {
		return nil, fmt.Errorf("hone.GenerateDailyPlan: %w", s.toConnectErr(gerr))
	}
	if req.Msg.GetForce() && s.PlanLimiter != nil {
		key := "rl:hone:plan:force:" + uid.String()
		res, rlErr := s.PlanLimiter.Allow(ctx, key, ForcePlanLimitPerWindow, ForcePlanWindow)
		if rlErr != nil {
			// Anti-fallback: a Redis blip used to silently widen the regen
			// budget. Now we propagate so quota-busting flapping is
			// visible in metrics; the user sees a transient 5xx and retries.
			s.H.Log.Error("hone.GenerateDailyPlan: ratelimit check failed",
				slog.Any("err", rlErr), slog.String("user_id", uid.String()))
			return nil, fmt.Errorf("hone.GenerateDailyPlan: ratelimit: %w", rlErr)
		}
		if !res.Allowed {
			cerr := connect.NewError(
				connect.CodeResourceExhausted,
				fmt.Errorf("force regeneration limited to %d per %s; retry in %ds",
					ForcePlanLimitPerWindow, ForcePlanWindow, res.RetryAfterSec),
			)
			cerr.Meta().Set("Retry-After", fmt.Sprintf("%d", res.RetryAfterSec))
			return nil, cerr
		}
	}
	p, err := s.H.GeneratePlan.Do(ctx, app.GeneratePlanInput{
		UserID: uid,
		Force:  req.Msg.GetForce(),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.GenerateDailyPlan: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toPlanProto(p)), nil
}

// GetDailyPlan implements druz9.v1.HoneService/GetDailyPlan.
func (s *HoneServer) GetDailyPlan(
	ctx context.Context,
	_ *connect.Request[pb.GetDailyPlanRequest],
) (*connect.Response[pb.Plan], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.H.GetPlan.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("hone.GetDailyPlan: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toPlanProto(p)), nil
}

// DismissPlanItem implements druz9.v1.HoneService/DismissPlanItem.
func (s *HoneServer) DismissPlanItem(
	ctx context.Context,
	req *connect.Request[pb.DismissPlanItemRequest],
) (*connect.Response[pb.Plan], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id := req.Msg.GetItemId()
	if id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("item_id required"))
	}
	p, err := s.H.DismissPlanItem.Do(ctx, app.DismissPlanItemInput{UserID: uid, ItemID: id})
	if err != nil {
		return nil, fmt.Errorf("hone.DismissPlanItem: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toPlanProto(p)), nil
}

// CompletePlanItem implements druz9.v1.HoneService/CompletePlanItem.
func (s *HoneServer) CompletePlanItem(
	ctx context.Context,
	req *connect.Request[pb.CompletePlanItemRequest],
) (*connect.Response[pb.Plan], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id := req.Msg.GetItemId()
	if id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("item_id required"))
	}
	p, err := s.H.CompletePlanItem.Do(ctx, app.CompletePlanItemInput{UserID: uid, ItemID: id})
	if err != nil {
		return nil, fmt.Errorf("hone.CompletePlanItem: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toPlanProto(p)), nil
}

// ─── Focus ─────────────────────────────────────────────────────────────────

// StartFocusSession implements druz9.v1.HoneService/StartFocusSession.
func (s *HoneServer) StartFocusSession(
	ctx context.Context,
	req *connect.Request[pb.StartFocusSessionRequest],
) (*connect.Response[pb.FocusSession], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	m := req.Msg
	sess, err := s.H.StartFocus.Do(ctx, app.StartFocusInput{
		UserID:      uid,
		PlanItemID:  m.GetPlanItemId(),
		PinnedTitle: m.GetPinnedTitle(),
		Mode:        domain.FocusMode(m.GetMode()),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.StartFocusSession: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toFocusSessionProto(sess)), nil
}

// EndFocusSession implements druz9.v1.HoneService/EndFocusSession.
func (s *HoneServer) EndFocusSession(
	ctx context.Context,
	req *connect.Request[pb.EndFocusSessionRequest],
) (*connect.Response[pb.FocusSession], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	m := req.Msg
	sid, parseErr := uuid.Parse(m.GetSessionId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid session_id: %w", parseErr))
	}
	sess, err := s.H.EndFocus.Do(ctx, app.EndFocusInput{
		UserID:             uid,
		SessionID:          sid,
		PomodorosCompleted: int(m.GetPomodorosCompleted()),
		SecondsFocused:     int(m.GetSecondsFocused()),
		Reflection:         m.GetReflection(),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.EndFocusSession: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toFocusSessionProto(sess)), nil
}

// GetStats implements druz9.v1.HoneService/GetStats.
func (s *HoneServer) GetStats(
	ctx context.Context,
	req *connect.Request[pb.GetStatsRequest],
) (*connect.Response[pb.Stats], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	var upTo time.Time
	if raw := req.Msg.GetUpToDate(); raw != "" {
		t, parseErr := time.Parse("2006-01-02", raw)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid up_to_date: %w", parseErr))
		}
		upTo = t
	}
	st, err := s.H.GetStats.Do(ctx, app.GetStatsInput{UserID: uid, UpToDate: upTo})
	if err != nil {
		return nil, fmt.Errorf("hone.GetStats: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toStatsProto(st)), nil
}

// ─── Focus Queue ───────────────────────────────────────────────────────────

// ListQueue implements druz9.v1.HoneService/ListQueue.
func (s *HoneServer) ListQueue(
	ctx context.Context,
	req *connect.Request[pb.ListQueueRequest],
) (*connect.Response[pb.ListQueueResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	var date time.Time
	if raw := req.Msg.GetDate(); raw != "" {
		t, parseErr := time.Parse("2006-01-02", raw)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid date: %w", parseErr))
		}
		date = t
	}
	items, err := s.H.ListQueue.Do(ctx, uid, date)
	if err != nil {
		return nil, fmt.Errorf("hone.ListQueue: %w", s.toConnectErr(err))
	}
	out := &pb.ListQueueResponse{Items: make([]*pb.QueueItem, 0, len(items))}
	for _, it := range items {
		out.Items = append(out.Items, toQueueItemProto(it))
	}
	return connect.NewResponse(out), nil
}

// AddQueueItem implements druz9.v1.HoneService/AddQueueItem.
func (s *HoneServer) AddQueueItem(
	ctx context.Context,
	req *connect.Request[pb.AddQueueItemRequest],
) (*connect.Response[pb.QueueItem], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	item, err := s.H.AddUserItem.Do(ctx, app.AddUserItemInput{
		UserID: uid,
		Title:  req.Msg.GetTitle(),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.AddQueueItem: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toQueueItemProto(item)), nil
}

// UpdateQueueItemStatus implements druz9.v1.HoneService/UpdateQueueItemStatus.
func (s *HoneServer) UpdateQueueItemStatus(
	ctx context.Context,
	req *connect.Request[pb.UpdateQueueItemStatusRequest],
) (*connect.Response[pb.QueueItem], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	itemID, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	item, err := s.H.UpdateItemStatus.Do(ctx, app.UpdateItemStatusInput{
		UserID: uid,
		ItemID: itemID,
		Status: domain.QueueItemStatus(req.Msg.GetStatus()),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.UpdateQueueItemStatus: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toQueueItemProto(item)), nil
}

// DeleteQueueItem implements druz9.v1.HoneService/DeleteQueueItem.
func (s *HoneServer) DeleteQueueItem(
	ctx context.Context,
	req *connect.Request[pb.DeleteQueueItemRequest],
) (*connect.Response[pb.DeleteQueueItemResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	itemID, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	if err := s.H.DeleteItem.Do(ctx, app.DeleteItemInput{
		UserID: uid,
		ItemID: itemID,
	}); err != nil {
		return nil, fmt.Errorf("hone.DeleteQueueItem: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.DeleteQueueItemResponse{}), nil
}

// ─── Notes ─────────────────────────────────────────────────────────────────

// CreateNote implements druz9.v1.HoneService/CreateNote.
func (s *HoneServer) CreateNote(
	ctx context.Context,
	req *connect.Request[pb.CreateNoteRequest],
) (*connect.Response[pb.Note], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	// Phase 2 quota enforcement: free-tier юзеры могут синкать только N
	// notes на backend (default 10). Locally хранить unlimited через
	// IndexedDB — frontend gate'ит REST-вызов и пишет local-only.
	// Backend defensive gate здесь — на случай если frontend bypassed
	// (CLI / curl / другой client).
	if s.CheckCreateNoteQuota != nil {
		if qerr := s.CheckCreateNoteQuota(ctx, uid); qerr != nil {
			return nil, connect.NewError(connect.CodeResourceExhausted, qerr)
		}
	}
	var folderID *uuid.UUID
	if fid := req.Msg.FolderId; fid != nil {
		parsed, ferr := uuid.Parse(*fid)
		if ferr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid folder_id: %w", ferr))
		}
		folderID = &parsed
	}
	n, err := s.H.CreateNote.Do(ctx, app.CreateNoteInput{
		UserID:   uid,
		Title:    req.Msg.GetTitle(),
		BodyMD:   req.Msg.GetBodyMd(),
		FolderID: folderID,
	})
	if err != nil {
		return nil, fmt.Errorf("hone.CreateNote: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toNoteProto(n)), nil
}

// UpdateNote implements druz9.v1.HoneService/UpdateNote.
func (s *HoneServer) UpdateNote(
	ctx context.Context,
	req *connect.Request[pb.UpdateNoteRequest],
) (*connect.Response[pb.Note], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	n, err := s.H.UpdateNote.Do(ctx, app.UpdateNoteInput{
		UserID: uid,
		NoteID: id,
		Title:  req.Msg.GetTitle(),
		BodyMD: req.Msg.GetBodyMd(),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.UpdateNote: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toNoteProto(n)), nil
}

// GetNote implements druz9.v1.HoneService/GetNote.
func (s *HoneServer) GetNote(
	ctx context.Context,
	req *connect.Request[pb.GetNoteRequest],
) (*connect.Response[pb.Note], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	n, err := s.H.GetNote.Do(ctx, uid, id)
	if err != nil {
		return nil, fmt.Errorf("hone.GetNote: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toNoteProto(n)), nil
}

// ListNotes implements druz9.v1.HoneService/ListNotes.
func (s *HoneServer) ListNotes(
	ctx context.Context,
	req *connect.Request[pb.ListNotesRequest],
) (*connect.Response[pb.ListNotesResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	var listFolderID *uuid.UUID
	if fid := req.Msg.FolderId; fid != nil {
		parsed, ferr := uuid.Parse(*fid)
		if ferr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid folder_id: %w", ferr))
		}
		listFolderID = &parsed
	}
	rows, cursor, err := s.H.ListNotes.Do(ctx, uid, int(req.Msg.GetLimit()), req.Msg.GetCursor(), listFolderID)
	if err != nil {
		return nil, fmt.Errorf("hone.ListNotes: %w", s.toConnectErr(err))
	}
	resp := &pb.ListNotesResponse{NextCursor: cursor}
	for _, r := range rows {
		resp.Notes = append(resp.Notes, toNoteSummaryProto(r))
	}
	return connect.NewResponse(resp), nil
}

// DeleteNote implements druz9.v1.HoneService/DeleteNote.
func (s *HoneServer) DeleteNote(
	ctx context.Context,
	req *connect.Request[pb.DeleteNoteRequest],
) (*connect.Response[pb.DeleteNoteResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	if err := s.H.DeleteNote.Do(ctx, uid, id); err != nil {
		return nil, fmt.Errorf("hone.DeleteNote: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.DeleteNoteResponse{}), nil
}

// MoveNote implements druz9.v1.HoneService/MoveNote.
func (s *HoneServer) MoveNote(
	ctx context.Context,
	req *connect.Request[pb.MoveNoteRequest],
) (*connect.Response[pb.Note], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	noteID, parseErr := uuid.Parse(req.Msg.GetNoteId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid note_id: %w", parseErr))
	}
	var folderID *uuid.UUID
	if fid := req.Msg.FolderId; fid != nil {
		parsed, parseErr := uuid.Parse(*fid)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid folder_id: %w", parseErr))
		}
		folderID = &parsed
	}
	n, err := s.H.MoveNote.Do(ctx, app.MoveNoteInput{UserID: uid, NoteID: noteID, FolderID: folderID})
	if err != nil {
		return nil, fmt.Errorf("hone.MoveNote: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toNoteProto(n)), nil
}

// CreateFolder implements druz9.v1.HoneService/CreateFolder.
func (s *HoneServer) CreateFolder(
	ctx context.Context,
	req *connect.Request[pb.CreateFolderRequest],
) (*connect.Response[pb.Folder], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	var parentID *uuid.UUID
	if pid := req.Msg.ParentId; pid != nil {
		parsed, parseErr := uuid.Parse(*pid)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid parent_id: %w", parseErr))
		}
		parentID = &parsed
	}
	f, err := s.H.CreateFolder.Do(ctx, app.CreateFolderInput{
		UserID:   uid,
		Name:     req.Msg.GetName(),
		ParentID: parentID,
	})
	if err != nil {
		return nil, fmt.Errorf("hone.CreateFolder: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toFolderProto(f)), nil
}

// ListFolders implements druz9.v1.HoneService/ListFolders.
func (s *HoneServer) ListFolders(
	ctx context.Context,
	_ *connect.Request[pb.ListFoldersRequest],
) (*connect.Response[pb.ListFoldersResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	folders, err := s.H.ListFolders.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("hone.ListFolders: %w", s.toConnectErr(err))
	}
	resp := &pb.ListFoldersResponse{}
	for _, f := range folders {
		resp.Folders = append(resp.Folders, toFolderProto(f))
	}
	return connect.NewResponse(resp), nil
}

// DeleteFolder implements druz9.v1.HoneService/DeleteFolder.
func (s *HoneServer) DeleteFolder(
	ctx context.Context,
	req *connect.Request[pb.DeleteFolderRequest],
) (*connect.Response[pb.DeleteFolderResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	folderID, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	if err := s.H.DeleteFolder.Do(ctx, app.DeleteFolderInput{
		UserID:          uid,
		FolderID:        folderID,
		MoveNotesToRoot: req.Msg.GetMoveNotesToRoot(),
	}); err != nil {
		return nil, fmt.Errorf("hone.DeleteFolder: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.DeleteFolderResponse{}), nil
}

// GetNoteConnections implements druz9.v1.HoneService/GetNoteConnections (server-streaming).
func (s *HoneServer) GetNoteConnections(
	ctx context.Context,
	req *connect.Request[pb.GetNoteConnectionsRequest],
	stream *connect.ServerStream[pb.Connection],
) error {
	uid, err := requireUser(ctx)
	if err != nil {
		return err
	}
	if gerr := s.requirePro(ctx, uid); gerr != nil {
		return fmt.Errorf("hone.GetNoteConnections: %w", s.toConnectErr(gerr))
	}
	id, parseErr := uuid.Parse(req.Msg.GetNoteId())
	if parseErr != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid note_id: %w", parseErr))
	}
	err = s.H.GetNoteConnections.Do(ctx, app.GetNoteConnectionsInput{UserID: uid, NoteID: id}, func(c domain.Connection) error {
		return stream.Send(toConnectionProto(c))
	})
	if err != nil {
		return fmt.Errorf("hone.GetNoteConnections: %w", s.toConnectErr(err))
	}
	return nil
}

// ─── Whiteboards ───────────────────────────────────────────────────────────

// CreateWhiteboard implements druz9.v1.HoneService/CreateWhiteboard.
func (s *HoneServer) CreateWhiteboard(
	ctx context.Context,
	req *connect.Request[pb.CreateWhiteboardRequest],
) (*connect.Response[pb.Whiteboard], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	wb, err := s.H.CreateWhiteboard.Do(ctx, app.CreateWhiteboardInput{
		UserID:    uid,
		Title:     req.Msg.GetTitle(),
		StateJSON: []byte(req.Msg.GetStateJson()),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.CreateWhiteboard: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toWhiteboardProto(wb)), nil
}

// UpdateWhiteboard implements druz9.v1.HoneService/UpdateWhiteboard.
func (s *HoneServer) UpdateWhiteboard(
	ctx context.Context,
	req *connect.Request[pb.UpdateWhiteboardRequest],
) (*connect.Response[pb.Whiteboard], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	wb, err := s.H.UpdateWhiteboard.Do(ctx, app.UpdateWhiteboardInput{
		UserID:          uid,
		WhiteboardID:    id,
		Title:           req.Msg.GetTitle(),
		StateJSON:       []byte(req.Msg.GetStateJson()),
		ExpectedVersion: int(req.Msg.GetExpectedVersion()),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.UpdateWhiteboard: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toWhiteboardProto(wb)), nil
}

// GetWhiteboard implements druz9.v1.HoneService/GetWhiteboard.
func (s *HoneServer) GetWhiteboard(
	ctx context.Context,
	req *connect.Request[pb.GetWhiteboardRequest],
) (*connect.Response[pb.Whiteboard], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	wb, err := s.H.GetWhiteboard.Do(ctx, uid, id)
	if err != nil {
		return nil, fmt.Errorf("hone.GetWhiteboard: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toWhiteboardProto(wb)), nil
}

// ListWhiteboards implements druz9.v1.HoneService/ListWhiteboards.
func (s *HoneServer) ListWhiteboards(
	ctx context.Context,
	_ *connect.Request[pb.ListWhiteboardsRequest],
) (*connect.Response[pb.ListWhiteboardsResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.H.ListWhiteboards.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("hone.ListWhiteboards: %w", s.toConnectErr(err))
	}
	resp := &pb.ListWhiteboardsResponse{}
	for _, r := range rows {
		resp.Whiteboards = append(resp.Whiteboards, &pb.WhiteboardSummary{
			Id:        r.ID.String(),
			Title:     r.Title,
			UpdatedAt: timestamppb.New(r.UpdatedAt.UTC()),
		})
	}
	return connect.NewResponse(resp), nil
}

// DeleteWhiteboard implements druz9.v1.HoneService/DeleteWhiteboard.
func (s *HoneServer) DeleteWhiteboard(
	ctx context.Context,
	req *connect.Request[pb.DeleteWhiteboardRequest],
) (*connect.Response[pb.DeleteWhiteboardResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	if err := s.H.DeleteWhiteboard.Do(ctx, uid, id); err != nil {
		return nil, fmt.Errorf("hone.DeleteWhiteboard: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.DeleteWhiteboardResponse{}), nil
}

// SaveCritiqueAsNote implements druz9.v1.HoneService/SaveCritiqueAsNote.
func (s *HoneServer) SaveCritiqueAsNote(
	ctx context.Context,
	req *connect.Request[pb.SaveCritiqueAsNoteRequest],
) (*connect.Response[pb.Note], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	wbID, parseErr := uuid.Parse(req.Msg.GetWhiteboardId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid whiteboard_id: %w", parseErr))
	}
	n, err := s.H.SaveCritiqueAsNote.Do(ctx, app.SaveCritiqueAsNoteInput{
		UserID:       uid,
		WhiteboardID: wbID,
		Title:        req.Msg.GetTitle(),
		BodyMD:       req.Msg.GetBodyMd(),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.SaveCritiqueAsNote: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toNoteProto(n)), nil
}

// RecordStandup implements druz9.v1.HoneService/RecordStandup.
func (s *HoneServer) RecordStandup(
	ctx context.Context,
	req *connect.Request[pb.RecordStandupRequest],
) (*connect.Response[pb.RecordStandupResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.H.RecordStandup.Do(ctx, app.RecordStandupInput{
		UserID:    uid,
		Yesterday: req.Msg.GetYesterday(),
		Today:     req.Msg.GetToday(),
		Blockers:  req.Msg.GetBlockers(),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.RecordStandup: %w", s.toConnectErr(err))
	}
	resp := &pb.RecordStandupResponse{
		Note: toNoteProto(out.Note),
	}
	// Plan может быть zero-value если сегодня ещё нет плана — не пихаем
	// пустой proto, клиент разберёт по presence.
	if !out.Plan.Date.IsZero() {
		resp.Plan = toPlanProto(out.Plan)
	}
	return connect.NewResponse(resp), nil
}

// GetTodayStandup implements druz9.v1.HoneService/GetTodayStandup.
func (s *HoneServer) GetTodayStandup(
	ctx context.Context,
	_ *connect.Request[pb.GetTodayStandupRequest],
) (*connect.Response[pb.GetTodayStandupResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.H.GetTodayStandup.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("hone.GetTodayStandup: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.GetTodayStandupResponse{
		Recorded:      out.Recorded,
		YesterdayDone: out.YesterdayDone,
	}), nil
}

// ── Cue Sessions ──────────────────────────────────────────────────────────

func (s *HoneServer) ImportCueSession(
	ctx context.Context,
	req *connect.Request[pb.ImportCueSessionRequest],
) (*connect.Response[pb.CueSession], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	in := app.ImportCueSessionInput{
		UserID:          uid,
		FilePath:        req.Msg.GetFilePath(),
		Title:           req.Msg.GetTitle(),
		BodyMD:          req.Msg.GetBodyMd(),
		RawAnalysisJSON: req.Msg.GetRawAnalysisJson(),
	}
	if started := req.Msg.GetStartedAt(); started != nil {
		t := started.AsTime()
		in.StartedAt = &t
	}
	out, err := s.H.ImportCueSession.Do(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("hone.ImportCueSession: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toCueSessionProto(out)), nil
}

func (s *HoneServer) ListCueSessions(
	ctx context.Context,
	_ *connect.Request[pb.ListCueSessionsRequest],
) (*connect.Response[pb.ListCueSessionsResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.H.ListCueSessions.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("hone.ListCueSessions: %w", s.toConnectErr(err))
	}
	resp := &pb.ListCueSessionsResponse{Sessions: make([]*pb.CueSession, 0, len(rows))}
	for _, r := range rows {
		resp.Sessions = append(resp.Sessions, toCueSessionProto(r))
	}
	return connect.NewResponse(resp), nil
}

func (s *HoneServer) GetCueSession(
	ctx context.Context,
	req *connect.Request[pb.GetCueSessionRequest],
) (*connect.Response[pb.CueSession], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	out, err := s.H.GetCueSession.Do(ctx, uid, id)
	if err != nil {
		return nil, fmt.Errorf("hone.GetCueSession: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toCueSessionProto(out)), nil
}

func (s *HoneServer) UpdateCueSession(
	ctx context.Context,
	req *connect.Request[pb.UpdateCueSessionRequest],
) (*connect.Response[pb.CueSession], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	out, err := s.H.UpdateCueSession.Do(ctx, uid, id, req.Msg.GetBodyMd())
	if err != nil {
		return nil, fmt.Errorf("hone.UpdateCueSession: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toCueSessionProto(out)), nil
}

func (s *HoneServer) DeleteCueSession(
	ctx context.Context,
	req *connect.Request[pb.DeleteCueSessionRequest],
) (*connect.Response[pb.DeleteCueSessionResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	if err := s.H.DeleteCueSession.Do(ctx, uid, id); err != nil {
		return nil, fmt.Errorf("hone.DeleteCueSession: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.DeleteCueSessionResponse{}), nil
}

func (s *HoneServer) SendCueSessionToTelegram(
	ctx context.Context,
	req *connect.Request[pb.SendCueSessionToTelegramRequest],
) (*connect.Response[pb.SendCueSessionToTelegramResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	out, err := s.H.SendCueSessionToTelegram.Do(ctx, uid, id)
	if err != nil {
		return nil, fmt.Errorf("hone.SendCueSessionToTelegram: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.SendCueSessionToTelegramResponse{
		Ok:      out.OK,
		Message: out.Message,
	}), nil
}

// CritiqueWhiteboard implements druz9.v1.HoneService/CritiqueWhiteboard (server-streaming).
func (s *HoneServer) CritiqueWhiteboard(
	ctx context.Context,
	req *connect.Request[pb.CritiqueWhiteboardRequest],
	stream *connect.ServerStream[pb.CritiquePacket],
) error {
	uid, err := requireUser(ctx)
	if err != nil {
		return err
	}
	if gerr := s.requirePro(ctx, uid); gerr != nil {
		return fmt.Errorf("hone.CritiqueWhiteboard: %w", s.toConnectErr(gerr))
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	err = s.H.CritiqueWhiteboard.Do(ctx, app.CritiqueWhiteboardInput{UserID: uid, WhiteboardID: id}, func(p domain.CritiquePacket) error {
		return stream.Send(&pb.CritiquePacket{
			Section: string(p.Section),
			Delta:   p.Delta,
			Done:    p.Done,
		})
	})
	if err != nil {
		return fmt.Errorf("hone.CritiqueWhiteboard: %w", s.toConnectErr(err))
	}
	return nil
}

// ── helpers ────────────────────────────────────────────────────────────────

func requireUser(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	return uid, nil
}

func (s *HoneServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrNotOwner):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrStaleVersion):
		return connect.NewError(connect.CodeAborted, err)
	case errors.Is(err, domain.ErrInvalidInput):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, domain.ErrProRequired):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrLLMUnavailable), errors.Is(err, domain.ErrEmbeddingUnavailable):
		s.H.Log.Warn("hone: AI subsystem unavailable", slog.Any("err", err))
		return connect.NewError(connect.CodeUnavailable, err)
	default:
		s.H.Log.Error("hone: unexpected error", slog.Any("err", err))
		return connect.NewError(connect.CodeInternal, errors.New("hone failure"))
	}
}

// ── converters (domain → proto) ────────────────────────────────────────────

func toPlanProto(p domain.Plan) *pb.Plan {
	out := &pb.Plan{
		Id:            p.ID.String(),
		Date:          p.Date.Format("2006-01-02"),
		RegeneratedAt: timestamppb.New(p.RegeneratedAt.UTC()),
	}
	for _, it := range p.Items {
		out.Items = append(out.Items, &pb.PlanItem{
			Id:           it.ID,
			Kind:         string(it.Kind),
			Title:        it.Title,
			Subtitle:     it.Subtitle,
			Rationale:    it.Rationale,
			SkillKey:     it.SkillKey,
			TargetRef:    it.TargetRef,
			DeepLink:     it.DeepLink,
			EstimatedMin: int32(it.EstimatedMin),
			Dismissed:    it.Dismissed,
			Completed:    it.Completed,
		})
	}
	return out
}

func toFocusSessionProto(s domain.FocusSession) *pb.FocusSession {
	out := &pb.FocusSession{
		Id:                 s.ID.String(),
		PlanItemId:         s.PlanItemID,
		PinnedTitle:        s.PinnedTitle,
		StartedAt:          timestamppb.New(s.StartedAt.UTC()),
		PomodorosCompleted: int32(s.PomodorosCompleted),
		SecondsFocused:     int32(s.SecondsFocused),
		Mode:               string(s.Mode),
	}
	if s.EndedAt != nil {
		out.EndedAt = timestamppb.New(s.EndedAt.UTC())
	}
	return out
}

func toStatsProto(s domain.Stats) *pb.Stats {
	out := &pb.Stats{
		CurrentStreakDays:   int32(s.CurrentStreakDays),
		LongestStreakDays:   int32(s.LongestStreakDays),
		TotalFocusedSeconds: int32(s.TotalFocusedSecs),
	}
	for _, d := range s.Heatmap {
		out.Heatmap = append(out.Heatmap, &pb.FocusHeatmapDay{
			Date:     d.Day.Format("2006-01-02"),
			Seconds:  int32(d.FocusedSeconds),
			Sessions: int32(d.SessionsCount),
		})
	}
	for _, d := range s.LastSevenDays {
		out.LastSevenDays = append(out.LastSevenDays, &pb.FocusHeatmapDay{
			Date:     d.Day.Format("2006-01-02"),
			Seconds:  int32(d.FocusedSeconds),
			Sessions: int32(d.SessionsCount),
		})
	}
	out.Queue = &pb.QueueStats{
		TodayTotal: int32(s.Queue.TodayTotal),
		TodayDone:  int32(s.Queue.TodayDone),
		AiShare:    s.Queue.AIShare,
		UserShare:  s.Queue.UserShare,
	}
	return out
}

func toQueueItemProto(q domain.QueueItem) *pb.QueueItem {
	return &pb.QueueItem{
		Id:       q.ID,
		Title:    q.Title,
		Source:   string(q.Source),
		Status:   string(q.Status),
		SkillKey: q.SkillKey,
		Date:     q.Date.Format("2006-01-02"),
	}
}

func toNoteProto(n domain.Note) *pb.Note {
	out := &pb.Note{
		Id:        n.ID.String(),
		Title:     n.Title,
		BodyMd:    n.BodyMD,
		CreatedAt: timestamppb.New(n.CreatedAt.UTC()),
		UpdatedAt: timestamppb.New(n.UpdatedAt.UTC()),
		SizeBytes: int32(n.SizeBytes),
	}
	if n.FolderID != nil {
		s := n.FolderID.String()
		out.FolderId = &s
	}
	return out
}

func toNoteSummaryProto(n domain.NoteSummary) *pb.NoteSummary {
	out := &pb.NoteSummary{
		Id:        n.ID.String(),
		Title:     n.Title,
		UpdatedAt: timestamppb.New(n.UpdatedAt.UTC()),
		SizeBytes: int32(n.SizeBytes),
	}
	if n.FolderID != nil {
		s := n.FolderID.String()
		out.FolderId = &s
	}
	return out
}

func toFolderProto(f domain.Folder) *pb.Folder {
	out := &pb.Folder{
		Id:        f.ID.String(),
		Name:      f.Name,
		CreatedAt: timestamppb.New(f.CreatedAt.UTC()),
		UpdatedAt: timestamppb.New(f.UpdatedAt.UTC()),
	}
	if f.ParentID != nil {
		s := f.ParentID.String()
		out.ParentId = &s
	}
	return out
}

func toCueSessionProto(s domain.CueSession) *pb.CueSession {
	out := &pb.CueSession{
		Id:              s.ID.String(),
		FilePath:        s.FilePath,
		Title:           s.Title,
		BodyMd:          s.BodyMD,
		RawAnalysisJson: s.RawAnalysisJSON,
		ImportedAt:      timestamppb.New(s.ImportedAt.UTC()),
		UpdatedAt:       timestamppb.New(s.UpdatedAt.UTC()),
	}
	if s.StartedAt != nil {
		out.StartedAt = timestamppb.New(s.StartedAt.UTC())
	}
	return out
}

func toConnectionProto(c domain.Connection) *pb.Connection {
	return &pb.Connection{
		Kind:         string(c.Kind),
		TargetId:     c.TargetID,
		DisplayTitle: c.DisplayTitle,
		Snippet:      c.Snippet,
		Similarity:   c.Similarity,
	}
}

func toWhiteboardProto(wb domain.Whiteboard) *pb.Whiteboard {
	return &pb.Whiteboard{
		Id:        wb.ID.String(),
		Title:     wb.Title,
		StateJson: string(wb.StateJSON),
		CreatedAt: timestamppb.New(wb.CreatedAt.UTC()),
		UpdatedAt: timestamppb.New(wb.UpdatedAt.UTC()),
		Version:   int32(wb.Version),
	}
}

// ─── Reading-модуль (Wave 4 of docs/feature/english.md) ──────────────────

func (s *HoneServer) AddReadingMaterial(
	ctx context.Context,
	req *connect.Request[pb.AddReadingMaterialRequest],
) (*connect.Response[pb.ReadingMaterial], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.H.AddReadingMaterial.Do(ctx, app.AddReadingMaterialInput{
		UserID:     uid,
		SourceKind: domain.ReadingSourceKind(req.Msg.SourceKind),
		SourceURL:  req.Msg.SourceUrl,
		Title:      req.Msg.Title,
		BodyMD:     req.Msg.BodyMd,
	})
	if err != nil {
		return nil, fmt.Errorf("hone.AddReadingMaterial: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toReadingMaterialProto(out, true)), nil
}

func (s *HoneServer) GetReadingMaterial(
	ctx context.Context,
	req *connect.Request[pb.GetReadingMaterialRequest],
) (*connect.Response[pb.ReadingMaterial], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	mid, perr := uuid.Parse(req.Msg.Id)
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("id: %w", perr))
	}
	out, err := s.H.GetReadingMaterial.Do(ctx, uid, mid)
	if err != nil {
		return nil, fmt.Errorf("hone.GetReadingMaterial: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toReadingMaterialProto(out, true)), nil
}

func (s *HoneServer) ListReadingMaterials(
	ctx context.Context,
	req *connect.Request[pb.ListReadingMaterialsRequest],
) (*connect.Response[pb.ListReadingMaterialsResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	items, err := s.H.ListReadingMaterials.Do(ctx, uid, int(req.Msg.Limit))
	if err != nil {
		return nil, fmt.Errorf("hone.ListReadingMaterials: %w", s.toConnectErr(err))
	}
	out := &pb.ListReadingMaterialsResponse{
		Items: make([]*pb.ReadingMaterial, 0, len(items)),
	}
	for _, m := range items {
		// list path strips body_md to save bandwidth — clients
		// re-fetch via GetReadingMaterial when opening a material.
		out.Items = append(out.Items, toReadingMaterialProto(m, false))
	}
	return connect.NewResponse(out), nil
}

func (s *HoneServer) ArchiveReadingMaterial(
	ctx context.Context,
	req *connect.Request[pb.ArchiveReadingMaterialRequest],
) (*connect.Response[pb.ArchiveReadingMaterialResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	mid, perr := uuid.Parse(req.Msg.Id)
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("id: %w", perr))
	}
	if err := s.H.ArchiveReadingMaterial.Do(ctx, uid, mid); err != nil {
		return nil, fmt.Errorf("hone.ArchiveReadingMaterial: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.ArchiveReadingMaterialResponse{}), nil
}

func (s *HoneServer) StartReadingSession(
	ctx context.Context,
	req *connect.Request[pb.StartReadingSessionRequest],
) (*connect.Response[pb.ReadingSession], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	mid, perr := uuid.Parse(req.Msg.MaterialId)
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("material_id: %w", perr))
	}
	out, err := s.H.StartReadingSession.Do(ctx, uid, mid)
	if err != nil {
		return nil, fmt.Errorf("hone.StartReadingSession: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toReadingSessionProto(out)), nil
}

func (s *HoneServer) EndReadingSession(
	ctx context.Context,
	req *connect.Request[pb.EndReadingSessionRequest],
) (*connect.Response[pb.EndReadingSessionResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	sid, perr := uuid.Parse(req.Msg.SessionId)
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("session_id: %w", perr))
	}
	out, err := s.H.EndReadingSession.Do(ctx, app.EndReadingSessionInput{
		UserID:    uid,
		SessionID: sid,
		CharsRead: int(req.Msg.CharsRead),
		SummaryMD: req.Msg.SummaryMd,
	})
	if err != nil {
		return nil, fmt.Errorf("hone.EndReadingSession: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.EndReadingSessionResponse{
		Session: toReadingSessionProto(out),
	}), nil
}

func (s *HoneServer) AddVocab(
	ctx context.Context,
	req *connect.Request[pb.AddVocabRequest],
) (*connect.Response[pb.VocabEntry], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	entry := domain.VocabEntry{
		UserID:      uid,
		Word:        req.Msg.Word,
		Translation: req.Msg.Translation,
		ContextMD:   req.Msg.ContextMd,
	}
	if req.Msg.SourceMaterial != "" {
		smid, perr := uuid.Parse(req.Msg.SourceMaterial)
		if perr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("source_material: %w", perr))
		}
		entry.SourceMaterial = &smid
	}
	out, err := s.H.AddVocab.Do(ctx, entry)
	if err != nil {
		return nil, fmt.Errorf("hone.AddVocab: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toVocabProto(out)), nil
}

func (s *HoneServer) ReviewVocab(
	ctx context.Context,
	req *connect.Request[pb.ReviewVocabRequest],
) (*connect.Response[pb.VocabEntry], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.H.ReviewVocab.Do(ctx, app.ReviewVocabInput{
		UserID:  uid,
		Word:    req.Msg.Word,
		Correct: req.Msg.Correct,
	})
	if err != nil {
		return nil, fmt.Errorf("hone.ReviewVocab: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toVocabProto(out)), nil
}

func (s *HoneServer) ListVocabDue(
	ctx context.Context,
	req *connect.Request[pb.ListVocabDueRequest],
) (*connect.Response[pb.ListVocabDueResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	items, err := s.H.ListVocabDue.Do(ctx, uid, int(req.Msg.Limit))
	if err != nil {
		return nil, fmt.Errorf("hone.ListVocabDue: %w", s.toConnectErr(err))
	}
	out := &pb.ListVocabDueResponse{Items: make([]*pb.VocabEntry, 0, len(items))}
	for _, v := range items {
		out.Items = append(out.Items, toVocabProto(v))
	}
	return connect.NewResponse(out), nil
}

// ListVocabBySourceMaterial — Wave 4.2 reverse cross-link.
func (s *HoneServer) ListVocabBySourceMaterial(
	ctx context.Context,
	req *connect.Request[pb.ListVocabBySourceMaterialRequest],
) (*connect.Response[pb.ListVocabDueResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	if s.H.ListVocabBySourceMaterial == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ListVocabBySourceMaterial not wired"))
	}
	mid, perr := uuid.Parse(req.Msg.MaterialId)
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("material_id: %w", perr))
	}
	items, err := s.H.ListVocabBySourceMaterial.Do(ctx, uid, mid, int(req.Msg.Limit))
	if err != nil {
		return nil, fmt.Errorf("hone.ListVocabBySourceMaterial: %w", s.toConnectErr(err))
	}
	out := &pb.ListVocabDueResponse{Items: make([]*pb.VocabEntry, 0, len(items))}
	for _, v := range items {
		out.Items = append(out.Items, toVocabProto(v))
	}
	return connect.NewResponse(out), nil
}

// GradeEnglishWriting — Wave 4.4. One-shot grader; no persistence.
// Returns 503-ish (CodeUnavailable) via toConnectErr when llmchain
// isn't wired (the floor adapter surfaces ErrLLMUnavailable).
func (s *HoneServer) GradeEnglishWriting(
	ctx context.Context,
	req *connect.Request[pb.GradeEnglishWritingRequest],
) (*connect.Response[pb.GradeEnglishWritingResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.H.GradeEnglishWriting.Do(ctx, app.GradeEnglishWritingInput{
		UserID: uid,
		Title:  req.Msg.Title,
		Text:   req.Msg.Text,
	})
	if err != nil {
		return nil, fmt.Errorf("hone.GradeEnglishWriting: %w", s.toConnectErr(err))
	}
	resp := &pb.GradeEnglishWritingResponse{
		OverallScore: int32(out.OverallScore),
		Issues:       make([]*pb.WritingIssue, 0, len(out.Issues)),
	}
	for _, i := range out.Issues {
		resp.Issues = append(resp.Issues, &pb.WritingIssue{
			Excerpt:     i.Excerpt,
			Category:    string(i.Category),
			Suggestion:  i.Suggestion,
			Explanation: i.Explanation,
		})
	}
	return connect.NewResponse(resp), nil
}

// ── Code-review-coaching (Wave 3.6) ─────────────────────────────────

func (s *HoneServer) GradeCodeReview(
	ctx context.Context,
	req *connect.Request[pb.GradeCodeReviewRequest],
) (*connect.Response[pb.GradeCodeReviewResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.H.GradeCodeReview.Do(ctx, app.GradeCodeReviewInput{
		UserID:   uid,
		PRTitle:  req.Msg.PrTitle,
		DiffMD:   req.Msg.DiffMd,
		ReviewMD: req.Msg.ReviewMd,
	})
	if err != nil {
		return nil, fmt.Errorf("hone.GradeCodeReview: %w", s.toConnectErr(err))
	}
	resp := &pb.GradeCodeReviewResponse{
		OverallScore: int32(out.OverallScore),
		Issues:       make([]*pb.CodeReviewIssue, 0, len(out.Issues)),
	}
	for _, i := range out.Issues {
		resp.Issues = append(resp.Issues, &pb.CodeReviewIssue{
			Excerpt:     i.Excerpt,
			Category:    string(i.Category),
			Suggestion:  i.Suggestion,
			Explanation: i.Explanation,
		})
	}
	return connect.NewResponse(resp), nil
}

// ── Listening-модуль (Wave 6.1) ─────────────────────────────────────

func (s *HoneServer) AddListeningMaterial(
	ctx context.Context,
	req *connect.Request[pb.AddListeningMaterialRequest],
) (*connect.Response[pb.ListeningMaterial], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.H.AddListeningMaterial.Do(ctx, app.AddListeningMaterialInput{
		UserID:       uid,
		Title:        req.Msg.Title,
		AudioURL:     req.Msg.AudioUrl,
		TranscriptMD: req.Msg.TranscriptMd,
	})
	if err != nil {
		return nil, fmt.Errorf("hone.AddListeningMaterial: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toListeningMaterialProto(out, true)), nil
}

func (s *HoneServer) ListListeningMaterials(
	ctx context.Context,
	req *connect.Request[pb.ListListeningMaterialsRequest],
) (*connect.Response[pb.ListListeningMaterialsResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	items, err := s.H.ListListeningMaterials.Do(ctx, uid, int(req.Msg.Limit))
	if err != nil {
		return nil, fmt.Errorf("hone.ListListeningMaterials: %w", s.toConnectErr(err))
	}
	resp := &pb.ListListeningMaterialsResponse{Items: make([]*pb.ListeningMaterial, 0, len(items))}
	for _, m := range items {
		resp.Items = append(resp.Items, toListeningMaterialProto(m, false))
	}
	return connect.NewResponse(resp), nil
}

func (s *HoneServer) GetListeningMaterial(
	ctx context.Context,
	req *connect.Request[pb.GetListeningMaterialRequest],
) (*connect.Response[pb.ListeningMaterial], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	mid, perr := uuid.Parse(req.Msg.Id)
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("id: %w", perr))
	}
	out, err := s.H.GetListeningMaterial.Do(ctx, uid, mid)
	if err != nil {
		return nil, fmt.Errorf("hone.GetListeningMaterial: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toListeningMaterialProto(out, true)), nil
}

func (s *HoneServer) ArchiveListeningMaterial(
	ctx context.Context,
	req *connect.Request[pb.ArchiveListeningMaterialRequest],
) (*connect.Response[pb.ArchiveListeningMaterialResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	mid, perr := uuid.Parse(req.Msg.Id)
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("id: %w", perr))
	}
	if err := s.H.ArchiveListeningMaterial.Do(ctx, uid, mid); err != nil {
		return nil, fmt.Errorf("hone.ArchiveListeningMaterial: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.ArchiveListeningMaterialResponse{}), nil
}

func toListeningMaterialProto(m domain.ListeningMaterial, withTranscript bool) *pb.ListeningMaterial {
	out := &pb.ListeningMaterial{
		Id:       m.ID.String(),
		UserId:   m.UserID.String(),
		Title:    m.Title,
		AudioUrl: m.AudioURL,
	}
	if withTranscript {
		out.TranscriptMd = m.TranscriptMD
	}
	if !m.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(m.CreatedAt.UTC())
	}
	if !m.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(m.UpdatedAt.UTC())
	}
	if m.ArchivedAt != nil {
		out.ArchivedAt = timestamppb.New(m.ArchivedAt.UTC())
	}
	return out
}

// ── Reading converters ──────────────────────────────────────────────

func toReadingMaterialProto(m domain.ReadingMaterial, withBody bool) *pb.ReadingMaterial {
	out := &pb.ReadingMaterial{
		Id:         m.ID.String(),
		UserId:     m.UserID.String(),
		SourceKind: string(m.SourceKind),
		SourceUrl:  m.SourceURL,
		Title:      m.Title,
		TotalChars: int32(m.TotalChars),
	}
	if withBody {
		out.BodyMd = m.BodyMD
	}
	if !m.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(m.CreatedAt.UTC())
	}
	if !m.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(m.UpdatedAt.UTC())
	}
	if m.ArchivedAt != nil {
		out.ArchivedAt = timestamppb.New(m.ArchivedAt.UTC())
	}
	return out
}

func toReadingSessionProto(s domain.ReadingSession) *pb.ReadingSession {
	out := &pb.ReadingSession{
		Id:         s.ID.String(),
		UserId:     s.UserID.String(),
		MaterialId: s.MaterialID.String(),
		CharsRead:  int32(s.CharsRead),
		CharsTotal: int32(s.CharsTotal),
		SummaryMd:  s.SummaryMD,
	}
	if !s.StartedAt.IsZero() {
		out.StartedAt = timestamppb.New(s.StartedAt.UTC())
	}
	if s.EndedAt != nil {
		out.EndedAt = timestamppb.New(s.EndedAt.UTC())
	}
	if s.AISummaryScore != nil {
		out.AiSummaryScore = int32(*s.AISummaryScore)
		out.HasScore = true
	}
	return out
}

func toVocabProto(v domain.VocabEntry) *pb.VocabEntry {
	out := &pb.VocabEntry{
		UserId:        v.UserID.String(),
		Word:          v.Word,
		Translation:   v.Translation,
		ContextMd:     v.ContextMD,
		Box:           int32(v.Box),
		ReviewedCount: int32(v.ReviewedCount),
	}
	if v.SourceMaterial != nil {
		out.SourceMaterial = v.SourceMaterial.String()
	}
	if !v.NextReviewAt.IsZero() {
		out.NextReviewAt = timestamppb.New(v.NextReviewAt.UTC())
	}
	if v.LearnedAt != nil {
		out.LearnedAt = timestamppb.New(v.LearnedAt.UTC())
	}
	if !v.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(v.CreatedAt.UTC())
	}
	return out
}
