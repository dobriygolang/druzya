// directory_handlers.go — Phase K T1 (P0) 2026-05-12. Connect-RPC
// handlers for the tutor directory MVP. Mirrors the patterns в
// server.go (sentinel-to-Connect mapping via toConnectErr, proto↔domain
// converters at the bottom).
package ports

import (
	"context"
	"errors"
	"fmt"
	"time"

	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/tutor/app"
	"druz9/tutor/domain"

	"connectrpc.com/connect"
	"github.com/google/uuid"
)

// GetMyDirectoryProfile — returns the caller's directory profile.
// Missing row is gracefully turned into a default-state profile by the
// use case; client never sees ErrNotFound here.
func (s *TutorServer) GetMyDirectoryProfile(
	ctx context.Context,
	_ *connect.Request[pb.TutorGetMyDirectoryProfileRequest],
) (*connect.Response[pb.TutorGetMyDirectoryProfileResponse], error) {
	if s.GetMyDirectoryProfileUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("GetMyDirectoryProfile not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	p, err := s.GetMyDirectoryProfileUC.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("tutor.GetMyDirectoryProfile: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorGetMyDirectoryProfileResponse{
		Profile: toDirectoryProfileProto(p),
	}), nil
}

// UpsertDirectoryProfile — tutor edits own profile. visible=true with
// empty bio_md is bounced as InvalidArgument.
func (s *TutorServer) UpsertDirectoryProfile(
	ctx context.Context,
	req *connect.Request[pb.TutorUpsertDirectoryProfileRequest],
) (*connect.Response[pb.TutorUpsertDirectoryProfileResponse], error) {
	if s.UpsertDirectoryProfileUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("UpsertDirectoryProfile not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	p, err := s.UpsertDirectoryProfileUC.Do(ctx, app.UpsertDirectoryProfileInput{
		UserID:             uid,
		Visible:            req.Msg.Visible,
		BioMD:              req.Msg.BioMd,
		ExpertiseTags:      req.Msg.ExpertiseTags,
		Languages:          req.Msg.Languages,
		Timezone:           req.Msg.Timezone,
		AvailabilityMD:     req.Msg.AvailabilityMd,
		LinkedinURL:        req.Msg.LinkedinUrl,
		GithubURL:          req.Msg.GithubUrl,
		ApplicationMessage: req.Msg.ApplicationMessage,
	})
	if err != nil {
		return nil, fmt.Errorf("tutor.UpsertDirectoryProfile: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorUpsertDirectoryProfileResponse{
		Profile: toDirectoryProfileProto(p),
	}), nil
}

// ListDirectoryTutors — paginated list of visible profiles. Auth-gated
// to keep bots out, но no role-check (any authed user can browse).
func (s *TutorServer) ListDirectoryTutors(
	ctx context.Context,
	req *connect.Request[pb.TutorListDirectoryTutorsRequest],
) (*connect.Response[pb.TutorListDirectoryTutorsResponse], error) {
	if s.ListDirectoryTutorsUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ListDirectoryTutors not wired"))
	}
	if _, ok := sharedMw.UserIDFromContext(ctx); !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	res, err := s.ListDirectoryTutorsUC.Do(ctx, app.ListDirectoryTutorsInput{
		ExpertiseTags: req.Msg.ExpertiseTags,
		Languages:     req.Msg.Languages,
		Limit:         int(req.Msg.PageSize),
		Cursor:        req.Msg.PageToken,
	})
	if err != nil {
		return nil, fmt.Errorf("tutor.ListDirectoryTutors: %w", s.toConnectErr(err))
	}
	out := &pb.TutorListDirectoryTutorsResponse{
		Items:         make([]*pb.TutorDirectoryEntry, 0, len(res.Items)),
		NextPageToken: res.NextCursor,
	}
	for _, e := range res.Items {
		out.Items = append(out.Items, toDirectoryEntryProto(e))
	}
	return connect.NewResponse(out), nil
}

// ApplyToTutor — student-side. Self-application bounced by use case.
// ErrAlreadyApplied → FailedPrecondition (mapped по toConnectErr).
func (s *TutorServer) ApplyToTutor(
	ctx context.Context,
	req *connect.Request[pb.TutorApplyToTutorRequest],
) (*connect.Response[pb.TutorApplyToTutorResponse], error) {
	if s.ApplyToTutorUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ApplyToTutor not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	tutorID, err := uuid.Parse(req.Msg.TutorUserId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("tutor_user_id: %w", err))
	}
	a, err := s.ApplyToTutorUC.Do(ctx, app.ApplyToTutorInput{
		StudentID: uid,
		TutorID:   tutorID,
		Message:   req.Msg.Message,
	})
	if err != nil {
		return nil, fmt.Errorf("tutor.ApplyToTutor: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorApplyToTutorResponse{
		Application: toApplicationProto(a, "", "", ""),
	}), nil
}

// ListPendingApplications — tutor-side queue. Bulk-resolves student
// displays inline (via the JOIN in the repo).
func (s *TutorServer) ListPendingApplications(
	ctx context.Context,
	_ *connect.Request[pb.TutorListPendingApplicationsRequest],
) (*connect.Response[pb.TutorListPendingApplicationsResponse], error) {
	if s.ListPendingApplicationsUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ListPendingApplications not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	items, err := s.ListPendingApplicationsUC.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListPendingApplications: %w", s.toConnectErr(err))
	}
	out := &pb.TutorListPendingApplicationsResponse{
		Items: make([]*pb.TutorDirectoryApplication, 0, len(items)),
	}
	for _, a := range items {
		out.Items = append(out.Items, toApplicationProto(
			a.Application,
			a.StudentDisplayName,
			a.StudentUsername,
			a.StudentAvatarURL,
		))
	}
	return connect.NewResponse(out), nil
}

// AcceptApplication — tutor accepts; creates relationship inside one tx.
func (s *TutorServer) AcceptApplication(
	ctx context.Context,
	req *connect.Request[pb.TutorAcceptApplicationRequest],
) (*connect.Response[pb.TutorAcceptApplicationResponse], error) {
	if s.AcceptApplicationUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("AcceptApplication not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	aid, err := uuid.Parse(req.Msg.ApplicationId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("application_id: %w", err))
	}
	rel, err := s.AcceptApplicationUC.Do(ctx, app.AcceptApplicationInput{
		TutorID:       uid,
		ApplicationID: aid,
	})
	if err != nil {
		return nil, fmt.Errorf("tutor.AcceptApplication: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorAcceptApplicationResponse{
		Relationship: toRelationshipProto(rel),
	}), nil
}

// DeclineApplication — tutor declines. Soft-mark; row is preserved.
func (s *TutorServer) DeclineApplication(
	ctx context.Context,
	req *connect.Request[pb.TutorDeclineApplicationRequest],
) (*connect.Response[pb.TutorDeclineApplicationResponse], error) {
	if s.DeclineApplicationUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("DeclineApplication not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	aid, err := uuid.Parse(req.Msg.ApplicationId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("application_id: %w", err))
	}
	if err := s.DeclineApplicationUC.Do(ctx, app.DeclineApplicationInput{
		TutorID:       uid,
		ApplicationID: aid,
	}); err != nil {
		return nil, fmt.Errorf("tutor.DeclineApplication: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorDeclineApplicationResponse{}), nil
}

// ── converters ────────────────────────────────────────────────────────

func toDirectoryProfileProto(p domain.DirectoryProfile) *pb.TutorDirectoryProfile {
	out := &pb.TutorDirectoryProfile{
		UserId:             p.UserID.String(),
		Visible:            p.Visible,
		BioMd:              p.BioMD,
		ExpertiseTags:      p.ExpertiseTags,
		Languages:          p.Languages,
		Timezone:           p.Timezone,
		AvailabilityMd:     p.AvailabilityMD,
		LinkedinUrl:        p.LinkedinURL,
		GithubUrl:          p.GithubURL,
		ApplicationMessage: p.ApplicationMessage,
	}
	if p.VerifiedAt != nil {
		out.VerifiedAt = p.VerifiedAt.UTC().Format(time.RFC3339)
	}
	if !p.CreatedAt.IsZero() {
		out.CreatedAt = p.CreatedAt.UTC().Format(time.RFC3339)
	}
	if !p.UpdatedAt.IsZero() {
		out.UpdatedAt = p.UpdatedAt.UTC().Format(time.RFC3339)
	}
	if out.ExpertiseTags == nil {
		out.ExpertiseTags = []string{}
	}
	if out.Languages == nil {
		out.Languages = []string{}
	}
	return out
}

func toDirectoryEntryProto(e domain.DirectoryEntry) *pb.TutorDirectoryEntry {
	out := &pb.TutorDirectoryEntry{
		UserId:        e.UserID.String(),
		DisplayName:   e.DisplayName,
		Username:      e.Username,
		AvatarUrl:     e.AvatarURL,
		BioMd:         e.BioMD,
		ExpertiseTags: e.ExpertiseTags,
		Languages:     e.Languages,
		Timezone:      e.Timezone,
		Verified:      e.Verified,
	}
	if out.ExpertiseTags == nil {
		out.ExpertiseTags = []string{}
	}
	if out.Languages == nil {
		out.Languages = []string{}
	}
	return out
}

func toApplicationProto(
	a domain.Application,
	displayName, username, avatarURL string,
) *pb.TutorDirectoryApplication {
	out := &pb.TutorDirectoryApplication{
		Id:                  a.ID.String(),
		TutorId:             a.TutorID.String(),
		StudentId:           a.StudentID.String(),
		Message:             a.Message,
		Status:              string(a.Status),
		StudentDisplayName:  displayName,
		StudentUsername:     username,
		StudentAvatarUrl:    avatarURL,
	}
	if !a.CreatedAt.IsZero() {
		out.CreatedAt = a.CreatedAt.UTC().Format(time.RFC3339)
	}
	return out
}
