// Reading, Vocab, Listening + writing/code-review grading RPCs.
// All methods stay on *HoneServer with proto converters alongside.
package ports

import (
	"context"
	"errors"
	"fmt"

	"druz9/hone/app"
	"druz9/hone/domain"
	pb "druz9/shared/generated/pb/druz9/v1"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ─── Reading-модуль ──────────────────

func (s *HoneServer) AddReadingMaterial(
	ctx context.Context,
	req *connect.Request[pb.AddReadingMaterialRequest],
) (*connect.Response[pb.ReadingMaterial], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	in := app.AddReadingMaterialInput{
		UserID:     uid,
		SourceKind: domain.ReadingSourceKind(req.Msg.SourceKind),
		SourceURL:  req.Msg.SourceUrl,
		Title:      req.Msg.Title,
		BodyMD:     req.Msg.BodyMd,
	}
	if req.Msg.HasBookChapter {
		v := int(req.Msg.BookChapter)
		in.BookChapter = &v
	}
	if req.Msg.HasBookTotal {
		v := int(req.Msg.BookTotalChapters)
		in.BookTotalChapters = &v
	}
	out, err := s.H.AddReadingMaterial.Do(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("hone.AddReadingMaterial: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toReadingMaterialProto(out, true)), nil
}

func (s *HoneServer) UpdateBookProgress(
	ctx context.Context,
	req *connect.Request[pb.UpdateBookProgressRequest],
) (*connect.Response[pb.ReadingMaterial], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	mid, perr := uuid.Parse(req.Msg.Id)
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("id: %w", perr))
	}
	in := app.UpdateBookProgressInput{UserID: uid, MaterialID: mid}
	if req.Msg.HasBookChapter {
		v := int(req.Msg.BookChapter)
		in.BookChapter = &v
	}
	if req.Msg.HasBookTotal {
		v := int(req.Msg.BookTotalChapters)
		in.BookTotalChapters = &v
	}
	out, err := s.H.UpdateBookProgress.Do(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("hone.UpdateBookProgress: %w", s.toConnectErr(err))
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
	items, nextCursor, err := s.H.ListReadingMaterials.Do(ctx, uid, int(req.Msg.GetLimit()), req.Msg.GetCursor())
	if err != nil {
		return nil, fmt.Errorf("hone.ListReadingMaterials: %w", s.toConnectErr(err))
	}
	out := &pb.ListReadingMaterialsResponse{
		Items:      make([]*pb.ReadingMaterial, 0, len(items)),
		NextCursor: nextCursor,
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

// ListVocabBySourceMaterial — reverse cross-link.
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

// GradeEnglishWriting — one-shot grader; no persistence.
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

// ── Code-review-coaching ─────────────────────────────────

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

// ── Listening-модуль ─────────────────────────────────────

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

func (s *HoneServer) IngestYouTubeListening(
	ctx context.Context,
	req *connect.Request[pb.IngestYouTubeListeningRequest],
) (*connect.Response[pb.ListeningMaterial], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	if s.H.IngestYouTubeListening == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("yt-dlp not wired"))
	}
	out, err := s.H.IngestYouTubeListening.Do(ctx, app.IngestYouTubeListeningInput{
		UserID:       uid,
		URL:          req.Msg.Url,
		LanguageHint: req.Msg.LanguageHint,
	})
	if err != nil {
		return nil, fmt.Errorf("hone.IngestYouTubeListening: %w", s.toConnectErr(err))
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
	items, nextCursor, err := s.H.ListListeningMaterials.Do(ctx, uid, int(req.Msg.GetLimit()), req.Msg.GetCursor())
	if err != nil {
		return nil, fmt.Errorf("hone.ListListeningMaterials: %w", s.toConnectErr(err))
	}
	resp := &pb.ListListeningMaterialsResponse{
		Items:      make([]*pb.ListeningMaterial, 0, len(items)),
		NextCursor: nextCursor,
	}
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

// ── proto converters used only by Reading / Vocab / Listening RPCs ───────

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
	if m.BookChapter != nil {
		out.BookChapter = int32(*m.BookChapter)
		out.HasBookChapter = true
	}
	if m.BookTotalChapters != nil {
		out.BookTotalChapters = int32(*m.BookTotalChapters)
		out.HasBookTotal = true
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
