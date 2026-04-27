package ports

import (
	"errors"
	"testing"
	"time"

	"druz9/intelligence/domain"

	"connectrpc.com/connect"
	"github.com/google/uuid"
)

func TestToDailyBriefProtoOmitsNilBriefID(t *testing.T) {
	got := toDailyBriefProto(domain.DailyBrief{
		BriefID:     uuid.Nil,
		Headline:    "Sparse data.",
		Narrative:   "No memory-backed id should be exposed.",
		GeneratedAt: time.Date(2026, 4, 27, 9, 0, 0, 0, time.UTC),
	})
	if got.GetBriefId() != "" {
		t.Fatalf("brief_id=%q, want empty", got.GetBriefId())
	}
}

func TestToDailyBriefProtoKeepsRealBriefID(t *testing.T) {
	id := uuid.New()
	got := toDailyBriefProto(domain.DailyBrief{
		BriefID:     id,
		Headline:    "Cache gap.",
		Narrative:   "Memory-backed id should be exposed.",
		GeneratedAt: time.Date(2026, 4, 27, 9, 0, 0, 0, time.UTC),
	})
	if got.GetBriefId() != id.String() {
		t.Fatalf("brief_id=%q, want %s", got.GetBriefId(), id)
	}
}

func TestToConnectErrMapsEpisodeNotFound(t *testing.T) {
	s := &IntelligenceServer{}
	err := s.toConnectErr(domain.ErrEpisodeNotFound)
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("err=%T, want connect error", err)
	}
	if connectErr.Code() != connect.CodeNotFound {
		t.Fatalf("code=%s, want not_found", connectErr.Code())
	}
}
