// server_speaking.go — Phase J / H4 (P1) Speaking modality RPCs.
// Lives in a separate file because the server.go file is already 1700+
// lines; H4 adds three more methods cleanly.
package ports

import (
	"context"
	"fmt"

	"druz9/hone/app"
	"druz9/hone/domain"
	pb "druz9/shared/generated/pb/druz9/v1"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ListSpeakingExercises — exposes the seeded catalog. No tier gate —
// catalog is read-only, free для всех.
func (s *HoneServer) ListSpeakingExercises(
	ctx context.Context,
	req *connect.Request[pb.ListSpeakingExercisesRequest],
) (*connect.Response[pb.ListSpeakingExercisesResponse], error) {
	if _, err := requireUser(ctx); err != nil {
		return nil, err
	}
	items, err := s.H.ListSpeakingExercises.Do(ctx, app.ListSpeakingExercisesInput{
		Level: req.Msg.Level,
	})
	if err != nil {
		return nil, fmt.Errorf("hone.ListSpeakingExercises: %w", s.toConnectErr(err))
	}
	resp := &pb.ListSpeakingExercisesResponse{
		Items: make([]*pb.SpeakingExercise, 0, len(items)),
	}
	for _, ex := range items {
		resp.Items = append(resp.Items, toSpeakingExerciseProto(ex))
	}
	return connect.NewResponse(resp), nil
}

// GradeSpeaking — STT + LLM grade + persist. Floor STT or grader
// adapters surface ErrLLMUnavailable → CodeUnavailable (503). Persist-
// after-LLM-fail path still returns a session row, just with empty
// scores и feedback — frontend can render «recording saved, retry grade».
func (s *HoneServer) GradeSpeaking(
	ctx context.Context,
	req *connect.Request[pb.GradeSpeakingRequest],
) (*connect.Response[pb.GradeSpeakingResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	res, err := s.H.GradeSpeaking.DoWithDiffs(ctx, app.GradeSpeakingInput{
		UserID:          uid,
		ExerciseID:      req.Msg.ExerciseId,
		ClientSessionID: req.Msg.ClientSessionId,
		AudioBase64:     req.Msg.AudioBase64,
		MIMEType:        req.Msg.MimeType,
		DurationMS:      int(req.Msg.DurationMs),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.GradeSpeaking: %w", s.toConnectErr(err))
	}
	resp := &pb.GradeSpeakingResponse{
		Id:                 res.Session.ID.String(),
		UserTranscript:     res.Session.UserTranscript,
		PronunciationScore: int32(res.Session.PronunciationScore),
		FluencyScore:       int32(res.Session.FluencyScore),
		CoachFeedback:      res.Session.CoachFeedback,
		WordDiffs:          make([]*pb.WordDiff, 0, len(res.WordDiffs)),
	}
	if !res.Session.CreatedAt.IsZero() {
		resp.CreatedAt = timestamppb.New(res.Session.CreatedAt.UTC())
	}
	for _, d := range res.WordDiffs {
		resp.WordDiffs = append(resp.WordDiffs, &pb.WordDiff{
			Status:   string(d.Status),
			Expected: d.Expected,
			Actual:   d.Actual,
		})
	}
	return connect.NewResponse(resp), nil
}

// ListSpeakingHistory — newest first; default 14, max 100.
func (s *HoneServer) ListSpeakingHistory(
	ctx context.Context,
	req *connect.Request[pb.ListSpeakingHistoryRequest],
) (*connect.Response[pb.ListSpeakingHistoryResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	items, err := s.H.ListSpeakingHistory.Do(ctx, app.ListSpeakingHistoryInput{
		UserID: uid,
		Limit:  int(req.Msg.Limit),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.ListSpeakingHistory: %w", s.toConnectErr(err))
	}
	resp := &pb.ListSpeakingHistoryResponse{
		Items: make([]*pb.SpeakingSession, 0, len(items)),
	}
	for _, ss := range items {
		resp.Items = append(resp.Items, toSpeakingSessionProto(ss))
	}
	return connect.NewResponse(resp), nil
}

// ── converters ────────────────────────────────────────────────────────────

func toSpeakingExerciseProto(ex domain.SpeakingExercise) *pb.SpeakingExercise {
	return &pb.SpeakingExercise{
		Id:       ex.ID,
		Level:    string(ex.Level),
		Topic:    ex.Topic,
		Prompt:   ex.Prompt,
		AudioUrl: ex.AudioURL,
	}
}

func toSpeakingSessionProto(s domain.SpeakingSession) *pb.SpeakingSession {
	out := &pb.SpeakingSession{
		Id:                 s.ID.String(),
		ExerciseId:         s.ExerciseID,
		Prompt:             s.Prompt,
		UserTranscript:     s.UserTranscript,
		PronunciationScore: int32(s.PronunciationScore),
		FluencyScore:       int32(s.FluencyScore),
		CoachFeedback:      s.CoachFeedback,
	}
	if !s.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(s.CreatedAt.UTC())
	}
	return out
}
