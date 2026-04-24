// Package ports exposes the slot (Human Mock Interview) domain via Connect-RPC.
//
// SlotServer implements druz9v1connect.SlotServiceHandler (generated from
// proto/druz9/v1/slot.proto). Mounted in main.go via NewSlotServiceHandler +
// vanguard — serves both /druz9.v1.SlotService/* natively and the four REST
// paths (/api/v1/slot/*) via transcoding.
//
// Authorization notes:
//   - ListSlots / BookSlot / CancelSlot require any authenticated user;
//     ownership is re-checked inside each use case.
//   - CreateSlot additionally requires role=interviewer or role=admin —
//     enforced here in the port, before the use case runs. Mirrors the
//     apigen-era guard.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/slot/app"
	"druz9/slot/domain"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion — SlotServer satisfies the generated handler.
var _ druz9v1connect.SlotServiceHandler = (*SlotServer)(nil)

// SlotServer adapts slot use cases to Connect.
//
// Field names use the UC suffix to avoid collisions with the generated
// method names (ListSlots / CreateSlot / BookSlot / CancelSlot).
type SlotServer struct {
	ListUC      *app.ListSlots
	CreateUC    *app.CreateSlot
	BookUC      *app.BookSlot
	CancelUC    *app.CancelSlot
	MyBookingUC *app.ListMyBookings
	Log         *slog.Logger
}

// NewSlotServer wires a SlotServer.
func NewSlotServer(list *app.ListSlots, create *app.CreateSlot, book *app.BookSlot, cancel *app.CancelSlot, myBookings *app.ListMyBookings, log *slog.Logger) *SlotServer {
	return &SlotServer{ListUC: list, CreateUC: create, BookUC: book, CancelUC: cancel, MyBookingUC: myBookings, Log: log}
}

// ListSlots implements druz9.v1.SlotService/ListSlots.
func (s *SlotServer) ListSlots(
	ctx context.Context,
	req *connect.Request[pb.ListSlotsRequest],
) (*connect.Response[pb.SlotList], error) {
	m := req.Msg
	in := app.ListSlotsInput{}
	if pbSec := m.GetSection(); pbSec != pb.Section_SECTION_UNSPECIFIED {
		sec := sectionFromProtoSlot(pbSec)
		in.Section = &sec
	}
	if pbDiff := m.GetDifficulty(); pbDiff != pb.Difficulty_DIFFICULTY_UNSPECIFIED {
		d := difficultyFromProtoSlot(pbDiff)
		in.Difficulty = &d
	}
	if m.GetFrom() != nil {
		t := m.GetFrom().AsTime()
		in.From = &t
	}
	if m.GetTo() != nil {
		t := m.GetTo().AsTime()
		in.To = &t
	}
	if pm := m.GetPriceMax(); pm > 0 {
		v := int(pm)
		in.PriceMax = &v
	}
	slots, err := s.ListUC.Do(ctx, in)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.SlotList{Items: make([]*pb.Slot, 0, len(slots))}
	for _, sl := range slots {
		out.Items = append(out.Items, toSlotProto(sl))
	}
	return connect.NewResponse(out), nil
}

// CreateSlot implements druz9.v1.SlotService/CreateSlot.
func (s *SlotServer) CreateSlot(
	ctx context.Context,
	req *connect.Request[pb.CreateSlotRequest],
) (*connect.Response[pb.Slot], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	role, _ := sharedMw.UserRoleFromContext(ctx)
	if role != string(enums.UserRoleInterviewer) && role != string(enums.UserRoleAdmin) {
		return nil, connect.NewError(connect.CodePermissionDenied, domain.ErrNotInterviewer)
	}
	m := req.Msg
	if m.GetStartsAt() == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("starts_at required"))
	}
	in := app.CreateSlotInput{
		InterviewerID: uid,
		StartsAt:      m.GetStartsAt().AsTime(),
		DurationMin:   int(m.GetDurationMin()),
		Section:       sectionFromProtoSlot(m.GetSection()),
		PriceRub:      int(m.GetPriceRub()),
		Language:      m.GetLanguage(),
		MeetURL:       m.GetMeetUrl(),
	}
	if pbDiff := m.GetDifficulty(); pbDiff != pb.Difficulty_DIFFICULTY_UNSPECIFIED {
		d := difficultyFromProtoSlot(pbDiff)
		in.Difficulty = &d
	}
	slot, err := s.CreateUC.Do(ctx, in)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toSlotProto(slot)), nil
}

// BookSlot implements druz9.v1.SlotService/BookSlot.
func (s *SlotServer) BookSlot(
	ctx context.Context,
	req *connect.Request[pb.BookSlotRequest],
) (*connect.Response[pb.Booking], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	slotID, err := uuid.Parse(req.Msg.GetSlotId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid slot_id: %w", err))
	}
	booking, err := s.BookUC.Do(ctx, app.BookSlotInput{
		SlotID:      slotID,
		CandidateID: uid,
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toBookingProto(booking)), nil
}

// ListMyBookings implements druz9.v1.SlotService/ListMyBookings.
func (s *SlotServer) ListMyBookings(
	ctx context.Context,
	_ *connect.Request[pb.ListMyBookingsRequest],
) (*connect.Response[pb.MyBookingList], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	rows, err := s.MyBookingUC.Do(ctx, app.ListMyBookingsInput{CandidateID: uid})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.MyBookingList{Items: make([]*pb.MyBookingItem, 0, len(rows))}
	for _, bw := range rows {
		out.Items = append(out.Items, toMyBookingItemProto(bw))
	}
	return connect.NewResponse(out), nil
}

// CancelSlot implements druz9.v1.SlotService/CancelSlot.
func (s *SlotServer) CancelSlot(
	ctx context.Context,
	req *connect.Request[pb.CancelSlotRequest],
) (*connect.Response[pb.CancelSlotResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	slotID, err := uuid.Parse(req.Msg.GetSlotId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid slot_id: %w", err))
	}
	if err := s.CancelUC.Do(ctx, app.CancelSlotInput{SlotID: slotID, UserID: uid}); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&pb.CancelSlotResponse{}), nil
}

// ── error mapping ─────────────────────────────────────────────────────────

func (s *SlotServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrBookingNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrForbidden),
		errors.Is(err, domain.ErrNotInterviewer):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrSelfBooking),
		errors.Is(err, domain.ErrNotAvailable),
		errors.Is(err, domain.ErrPastStart),
		errors.Is(err, domain.ErrInvalidDuration),
		errors.Is(err, domain.ErrInvalidPrice),
		errors.Is(err, domain.ErrInvalidSection),
		errors.Is(err, domain.ErrInvalidDifficulty),
		errors.Is(err, domain.ErrOverlapping),
		errors.Is(err, domain.ErrAlreadyBooked):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		if s.Log != nil {
			s.Log.Error("slot: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("slot failure"))
	}
}

// ── converters (domain → proto) ───────────────────────────────────────────

func toSlotProto(sl domain.Slot) *pb.Slot {
	out := &pb.Slot{
		Id:          sl.ID.String(),
		DurationMin: int32(sl.DurationMin),
		Section:     sectionToProtoSlot(sl.Section),
		Language:    sl.Language,
		PriceRub:    int32(sl.PriceRub),
		MeetUrl:     sl.MeetURL,
		Status:      slotStatusToProto(sl.Status),
		Interviewer: &pb.SlotInterviewer{
			UserId:   sl.InterviewerID.String(),
			Username: sl.InterviewerUsername,
		},
	}
	if !sl.StartsAt.IsZero() {
		out.StartsAt = timestamppb.New(sl.StartsAt.UTC())
	}
	if sl.Difficulty != nil {
		out.Difficulty = difficultyToProtoSlot(*sl.Difficulty)
	}
	if sl.InterviewerAvgRating != nil {
		out.Interviewer.AvgRating = *sl.InterviewerAvgRating
	}
	if sl.InterviewerReviewsCount != nil {
		out.Interviewer.ReviewsCount = int32(*sl.InterviewerReviewsCount)
	}
	return out
}

// toMyBookingItemProto flattens BookingWithSlot (domain) into the proto DTO
// served by GET /api/v1/slot/my/bookings. Mirrors the chi-direct
// bookingItemDTO this RPC replaces.
func toMyBookingItemProto(bw domain.BookingWithSlot) *pb.MyBookingItem {
	out := &pb.MyBookingItem{
		Id:          bw.Booking.ID.String(),
		SlotId:      bw.Booking.SlotID.String(),
		MeetUrl:     bw.Booking.MeetURL,
		Status:      bw.Booking.Status,
		DurationMin: int32(bw.Slot.DurationMin),
		Section:     sectionToProtoSlot(bw.Slot.Section),
		Language:    bw.Slot.Language,
		PriceRub:    int32(bw.Slot.PriceRub),
		SlotStatus:  slotStatusToProto(bw.Slot.Status),
	}
	if !bw.Booking.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(bw.Booking.CreatedAt.UTC())
	}
	if !bw.Slot.StartsAt.IsZero() {
		out.StartsAt = timestamppb.New(bw.Slot.StartsAt.UTC())
	}
	if bw.Slot.Difficulty != nil {
		out.Difficulty = difficultyToProtoSlot(*bw.Slot.Difficulty)
	}
	return out
}

func toBookingProto(b domain.Booking) *pb.Booking {
	out := &pb.Booking{
		Id:      b.ID.String(),
		MeetUrl: b.MeetURL,
		// OpenAPI requires `slot`; we ship the id-only shell to preserve
		// wire compat — hydrating the full slot costs an extra query and
		// matches the previous apigen shape.
		Slot: &pb.Slot{Id: b.SlotID.String()},
	}
	if !b.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(b.CreatedAt.UTC())
	}
	return out
}

// ── enum adapters ─────────────────────────────────────────────────────────

func sectionToProtoSlot(s enums.Section) pb.Section {
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

func sectionFromProtoSlot(s pb.Section) enums.Section {
	switch s {
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
	case pb.Section_SECTION_UNSPECIFIED:
		return ""
	default:
		return ""
	}
}

func difficultyToProtoSlot(d enums.Difficulty) pb.Difficulty {
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

func difficultyFromProtoSlot(d pb.Difficulty) enums.Difficulty {
	switch d {
	case pb.Difficulty_DIFFICULTY_EASY:
		return enums.DifficultyEasy
	case pb.Difficulty_DIFFICULTY_MEDIUM:
		return enums.DifficultyMedium
	case pb.Difficulty_DIFFICULTY_HARD:
		return enums.DifficultyHard
	case pb.Difficulty_DIFFICULTY_UNSPECIFIED:
		return ""
	default:
		return ""
	}
}

func slotStatusToProto(s enums.SlotStatus) pb.SlotStatus {
	switch s {
	case enums.SlotStatusAvailable:
		return pb.SlotStatus_SLOT_STATUS_AVAILABLE
	case enums.SlotStatusBooked:
		return pb.SlotStatus_SLOT_STATUS_BOOKED
	case enums.SlotStatusCompleted:
		return pb.SlotStatus_SLOT_STATUS_COMPLETED
	case enums.SlotStatusCancelled:
		return pb.SlotStatus_SLOT_STATUS_CANCELLED
	case enums.SlotStatusNoShow:
		return pb.SlotStatus_SLOT_STATUS_NO_SHOW
	default:
		return pb.SlotStatus_SLOT_STATUS_UNSPECIFIED
	}
}
