package app

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/daily/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// CreateAutopsy implements POST /daily/autopsy.
type CreateAutopsy struct {
	Autopsies domain.AutopsyRepo
	Bus       sharedDomain.Bus
	Log       *slog.Logger
	Analyse   Analyser // STUB LLM worker, see Analyser.
}

// Analyser is the asynchronous AI analysis job. The real impl talks to the LLM
// gateway; the MVP `FakeAnalyser` just marks the row ready after a short delay.
//
// STUB: LLM analysis client — replace with an Asynq job that consumes
// interview_autopsies.processing rows.
type Analyser interface {
	Enqueue(ctx context.Context, autopsyID uuid.UUID) error
}

// CreateAutopsyInput mirrors the POST body.
type CreateAutopsyInput struct {
	UserID        uuid.UUID
	CompanyID     uuid.UUID
	Section       enums.Section
	Outcome       domain.AutopsyOutcome
	InterviewDate *time.Time
	Questions     string
	Answers       string
	Notes         string
}

// Do inserts the autopsy row, enqueues AI analysis, publishes an event.
func (uc *CreateAutopsy) Do(ctx context.Context, in CreateAutopsyInput) (domain.Autopsy, error) {
	if !in.Section.IsValid() {
		return domain.Autopsy{}, fmt.Errorf("daily.CreateAutopsy: invalid section %q", in.Section)
	}
	if !in.Outcome.IsValid() {
		return domain.Autopsy{}, fmt.Errorf("daily.CreateAutopsy: invalid outcome %q", in.Outcome)
	}
	slug, err := genShareSlug()
	if err != nil {
		return domain.Autopsy{}, fmt.Errorf("daily.CreateAutopsy: slug: %w", err)
	}
	row := domain.Autopsy{
		UserID:        in.UserID,
		CompanyID:     in.CompanyID,
		Section:       in.Section,
		Outcome:       in.Outcome,
		InterviewDate: in.InterviewDate,
		Questions:     in.Questions,
		Answers:       in.Answers,
		Notes:         in.Notes,
		Status:        domain.AutopsyStatusProcessing,
		ShareSlug:     slug,
	}
	saved, err := uc.Autopsies.Create(ctx, row)
	if err != nil {
		return domain.Autopsy{}, fmt.Errorf("daily.CreateAutopsy: create: %w", err)
	}
	if err := uc.Analyse.Enqueue(ctx, saved.ID); err != nil {
		uc.Log.WarnContext(ctx, "daily.CreateAutopsy: enqueue analyser", slog.Any("err", err))
	}
	if perr := uc.Bus.Publish(ctx, sharedDomain.InterviewAutopsyCreated{
		AutopsyID: saved.ID,
		UserID:    saved.UserID,
		CompanyID: saved.CompanyID,
	}); perr != nil {
		uc.Log.WarnContext(ctx, "daily.CreateAutopsy: publish event", slog.Any("err", perr))
	}
	return saved, nil
}

// GetAutopsy implements GET /daily/autopsy/{id}.
type GetAutopsy struct {
	Autopsies domain.AutopsyRepo
}

// Do loads the row. Access control (owner-only) is the handler's responsibility.
func (uc *GetAutopsy) Do(ctx context.Context, id uuid.UUID) (domain.Autopsy, error) {
	a, err := uc.Autopsies.Get(ctx, id)
	if err != nil {
		return domain.Autopsy{}, fmt.Errorf("daily.GetAutopsy: %w", err)
	}
	return a, nil
}

// genShareSlug produces a short (10-char) base32-ish token. Lower-case + digits
// so it's URL-friendly.
func genShareSlug() (string, error) {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", fmt.Errorf("read rand: %w", err)
	}
	enc := strings.ToLower(strings.TrimRight(base32.StdEncoding.EncodeToString(buf[:]), "="))
	if len(enc) > 10 {
		enc = enc[:10]
	}
	return enc, nil
}

// FakeAnalyser is the STUB implementation promised above — it spins a goroutine
// that flips the row to `ready` after ~1s with placeholder JSON. Use in main.go
// until the real LLM worker exists.
type FakeAnalyser struct {
	Autopsies domain.AutopsyRepo
	Log       *slog.Logger
}

// Enqueue starts the background fake-finish goroutine.
func (f *FakeAnalyser) Enqueue(ctx context.Context, id uuid.UUID) error {
	go func() {
		// Detach from request ctx — we want this to outlive the handler.
		bg, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		time.Sleep(1 * time.Second)
		payload := []byte(`{"failure_reason":"stub","what_to_say":"stub","weak_atlas_nodes":[],"recovery_plan":[]}`)
		if err := f.Autopsies.MarkReady(bg, id, payload); err != nil {
			f.Log.WarnContext(bg, "daily.FakeAnalyser: mark ready", slog.Any("err", err))
		}
	}()
	return nil
}
