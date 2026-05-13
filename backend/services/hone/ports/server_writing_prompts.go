// server_writing_prompts.go — RPC handlers for the curated writing
// prompts library. Admin gating on
// Add / Archive enforced at the REST router level (monolith/services/hone);
// the RPCs themselves only require authenticated user. Same convention
// as GenerateSpeakingTTS — admin role middleware runs before the handler.
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

// ListWritingPrompts — public list (level filter). User must be
// authenticated but no admin gate; this is what the writing-focus
// picker uses to populate its catalog.
func (s *HoneServer) ListWritingPrompts(
	ctx context.Context,
	req *connect.Request[pb.ListWritingPromptsRequest],
) (*connect.Response[pb.ListWritingPromptsResponse], error) {
	if _, err := requireUser(ctx); err != nil {
		return nil, err
	}
	items, err := s.H.ListWritingPrompts.Do(ctx, app.ListWritingPromptsInput{
		Level: req.Msg.Level,
	})
	if err != nil {
		return nil, fmt.Errorf("hone.ListWritingPrompts: %w", s.toConnectErr(err))
	}
	resp := &pb.ListWritingPromptsResponse{
		Items: make([]*pb.WritingPrompt, 0, len(items)),
	}
	for _, p := range items {
		resp.Items = append(resp.Items, toWritingPromptProto(p))
	}
	return connect.NewResponse(resp), nil
}

// AddWritingPrompt — admin-only (gated at REST router). Returns 409
// when the slug already exists, 400 on validation failure.
func (s *HoneServer) AddWritingPrompt(
	ctx context.Context,
	req *connect.Request[pb.AddWritingPromptRequest],
) (*connect.Response[pb.WritingPrompt], error) {
	if _, err := requireUser(ctx); err != nil {
		return nil, err
	}
	out, err := s.H.AddWritingPrompt.Do(ctx, app.AddWritingPromptInput{
		ID:       req.Msg.Id,
		Level:    req.Msg.Level,
		Topic:    req.Msg.Topic,
		Prompt:   req.Msg.Prompt,
		RubricMD: req.Msg.RubricMd,
	})
	if err != nil {
		return nil, fmt.Errorf("hone.AddWritingPrompt: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toWritingPromptProto(out)), nil
}

// ArchiveWritingPrompt — admin-only soft-delete.
func (s *HoneServer) ArchiveWritingPrompt(
	ctx context.Context,
	req *connect.Request[pb.ArchiveWritingPromptRequest],
) (*connect.Response[pb.ArchiveWritingPromptResponse], error) {
	if _, err := requireUser(ctx); err != nil {
		return nil, err
	}
	if err := s.H.ArchiveWritingPrompt.Do(ctx, app.ArchiveWritingPromptInput{
		ID: req.Msg.Id,
	}); err != nil {
		return nil, fmt.Errorf("hone.ArchiveWritingPrompt: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.ArchiveWritingPromptResponse{Ok: true}), nil
}

// ── converters ────────────────────────────────────────────────────────────

func toWritingPromptProto(p domain.WritingPrompt) *pb.WritingPrompt {
	out := &pb.WritingPrompt{
		Id:       p.ID,
		Level:    string(p.Level),
		Topic:    p.Topic,
		Prompt:   p.Prompt,
		RubricMd: p.RubricMD,
	}
	if !p.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(p.CreatedAt.UTC())
	}
	if !p.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(p.UpdatedAt.UTC())
	}
	return out
}
