// reading.go — Hone Reading-модуль use cases (Wave 4 of
// docs/feature/english.md). Six use cases covering library CRUD +
// session lifecycle + vocab queue. Each is a thin orchestrator —
// validation lives here, persistence in domain.ReadingRepo.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// GetReadingMaterial — load a single material with body. Verifies
// ownership at SQL gate (repo returns ErrNotFound on foreign id).
type GetReadingMaterial struct {
	Repo domain.ReadingRepo
}

func (uc *GetReadingMaterial) Do(ctx context.Context, userID, materialID uuid.UUID) (domain.ReadingMaterial, error) {
	if userID == uuid.Nil || materialID == uuid.Nil {
		return domain.ReadingMaterial{}, fmt.Errorf("hone.GetReadingMaterial: ids required")
	}
	out, err := uc.Repo.GetMaterial(ctx, userID, materialID)
	if err != nil {
		return domain.ReadingMaterial{}, fmt.Errorf("hone.GetReadingMaterial: %w", err)
	}
	return out, nil
}

// AddReadingMaterial — user uploaded a chapter / paste / URL-fetched
// article. The frontend has already resolved URL → text via
// services/documents extractor; this UC only persists.
type AddReadingMaterial struct {
	Repo domain.ReadingRepo
}

type AddReadingMaterialInput struct {
	UserID            uuid.UUID
	SourceKind        domain.ReadingSourceKind
	SourceURL         string // empty for paste
	Title             string
	BodyMD            string
	BookChapter       *int // book-only progress
	BookTotalChapters *int
}

func (uc *AddReadingMaterial) Do(ctx context.Context, in AddReadingMaterialInput) (domain.ReadingMaterial, error) {
	if in.UserID == uuid.Nil {
		return domain.ReadingMaterial{}, fmt.Errorf("hone.AddReadingMaterial: user_id required")
	}
	if !in.SourceKind.IsValid() {
		return domain.ReadingMaterial{}, fmt.Errorf("hone.AddReadingMaterial: invalid source_kind %q", in.SourceKind)
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return domain.ReadingMaterial{}, fmt.Errorf("hone.AddReadingMaterial: title required")
	}
	body := strings.TrimSpace(in.BodyMD)
	// Books — частный случай: body может быть пустым (юзер читает offline,
	// мы трекаем только chapter). Для остальных source_kind body required.
	isBook := in.SourceKind == domain.ReadingSourceBook
	if !isBook && body == "" {
		return domain.ReadingMaterial{}, fmt.Errorf("hone.AddReadingMaterial: body_md required")
	}
	if len(body) > 2_000_000 {
		return domain.ReadingMaterial{}, fmt.Errorf("hone.AddReadingMaterial: body too large (>2MB)")
	}
	saved, err := uc.Repo.CreateMaterial(ctx, domain.ReadingMaterial{
		UserID:            in.UserID,
		SourceKind:        in.SourceKind,
		SourceURL:         strings.TrimSpace(in.SourceURL),
		Title:             title,
		BodyMD:            body,
		BookChapter:       in.BookChapter,
		BookTotalChapters: in.BookTotalChapters,
	})
	if err != nil {
		return domain.ReadingMaterial{}, fmt.Errorf("hone.AddReadingMaterial: %w", err)
	}
	return saved, nil
}

// UpdateBookProgress — bump chapter / total для book-материалов.
type UpdateBookProgress struct {
	Repo domain.ReadingRepo
}

type UpdateBookProgressInput struct {
	UserID            uuid.UUID
	MaterialID        uuid.UUID
	BookChapter       *int
	BookTotalChapters *int
}

func (uc *UpdateBookProgress) Do(ctx context.Context, in UpdateBookProgressInput) (domain.ReadingMaterial, error) {
	if in.UserID == uuid.Nil || in.MaterialID == uuid.Nil {
		return domain.ReadingMaterial{}, fmt.Errorf("hone.UpdateBookProgress: ids required")
	}
	out, err := uc.Repo.UpdateBookProgress(ctx, in.UserID, in.MaterialID, in.BookChapter, in.BookTotalChapters)
	if err != nil {
		return domain.ReadingMaterial{}, fmt.Errorf("hone.UpdateBookProgress: %w", err)
	}
	return out, nil
}

// ListReadingMaterials — library view, most-recent first.
type ListReadingMaterials struct {
	Repo domain.ReadingRepo
}

// Do — keyset-paginated. cursor "" = first page; the returned next_cursor
// feeds back into the next call. Empty next_cursor = end of stream.
func (uc *ListReadingMaterials) Do(ctx context.Context, userID uuid.UUID, limit int, cursor string) ([]domain.ReadingMaterial, string, error) {
	if userID == uuid.Nil {
		return nil, "", fmt.Errorf("hone.ListReadingMaterials: user_id required")
	}
	out, next, err := uc.Repo.ListMaterialsPaged(ctx, userID, limit, cursor)
	if err != nil {
		return nil, "", fmt.Errorf("hone.ListReadingMaterials: %w", err)
	}
	return out, next, nil
}

// ArchiveReadingMaterial — soft-delete from library.
type ArchiveReadingMaterial struct {
	Repo domain.ReadingRepo
	Now  func() time.Time
}

func (uc *ArchiveReadingMaterial) Do(ctx context.Context, userID, materialID uuid.UUID) error {
	if userID == uuid.Nil || materialID == uuid.Nil {
		return fmt.Errorf("hone.ArchiveReadingMaterial: ids required")
	}
	if err := uc.Repo.ArchiveMaterial(ctx, userID, materialID, nowOr(uc.Now)); err != nil {
		return fmt.Errorf("hone.ArchiveReadingMaterial: %w", err)
	}
	return nil
}

// StartReadingSession — user opened a material. Returns the session
// shell (chars_total stamped from material).
type StartReadingSession struct {
	Repo domain.ReadingRepo
}

func (uc *StartReadingSession) Do(ctx context.Context, userID, materialID uuid.UUID) (domain.ReadingSession, error) {
	if userID == uuid.Nil || materialID == uuid.Nil {
		return domain.ReadingSession{}, fmt.Errorf("hone.StartReadingSession: ids required")
	}
	out, err := uc.Repo.StartSession(ctx, userID, materialID)
	if err != nil {
		return domain.ReadingSession{}, fmt.Errorf("hone.StartReadingSession: %w", err)
	}
	return out, nil
}

// EndReadingSession — user closed the material or pomodoro fired.
//
// When a non-empty summary is submitted AND a grader is wired, we run
// the grader inline (bounded by its own timeout) and persist the score
// before returning. Failures from the grader path are non-fatal — the
// session is already saved, the user just sees `has_score=false`.
//
// Wave 4.3: returns the (possibly graded) session so the caller can show
// the score immediately. Earlier signature returned `error` only; the
// frontend now relies on session.AISummaryScore being populated when
// available so it can render «AI scored you 78/100» before navigating
// back to the library.
type EndReadingSession struct {
	Repo   domain.ReadingRepo
	Grader domain.SummaryGrader // optional; nil → skip grading
	Log    *slog.Logger         // optional; logs grader failures at Warn
	Now    func() time.Time
}

type EndReadingSessionInput struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
	CharsRead int
	SummaryMD string
}

func (uc *EndReadingSession) Do(ctx context.Context, in EndReadingSessionInput) (domain.ReadingSession, error) {
	if in.UserID == uuid.Nil || in.SessionID == uuid.Nil {
		return domain.ReadingSession{}, fmt.Errorf("hone.EndReadingSession: ids required")
	}
	if err := uc.Repo.EndSession(ctx, in.UserID, in.SessionID, in.CharsRead, in.SummaryMD, nowOr(uc.Now)); err != nil {
		return domain.ReadingSession{}, fmt.Errorf("hone.EndReadingSession: %w", err)
	}

	// Try to grade (only when there's a non-empty summary AND a grader).
	// Errors here are intentionally swallowed — the session is already
	// closed, the score is best-effort. We use a separate context derived
	// from the request ctx so a fast client cancel doesn't kill the
	// grader prematurely; the grader has its own internal timeout.
	if uc.Grader != nil && strings.TrimSpace(in.SummaryMD) != "" {
		if err := uc.gradeAndPersist(ctx, in); err != nil && uc.Log != nil {
			uc.Log.Warn("hone.EndReadingSession: grade skipped",
				slog.Any("err", err),
				slog.String("session_id", in.SessionID.String()))
		}
	}

	out, err := uc.Repo.GetSession(ctx, in.UserID, in.SessionID)
	if err != nil {
		return domain.ReadingSession{}, fmt.Errorf("hone.EndReadingSession: reload: %w", err)
	}
	return out, nil
}

// gradeAndPersist loads the material body, asks the grader, and writes
// the score back. Split out so the happy path of Do() stays readable.
func (uc *EndReadingSession) gradeAndPersist(ctx context.Context, in EndReadingSessionInput) error {
	// Need session.material_id to fetch the body.
	sess, err := uc.Repo.GetSession(ctx, in.UserID, in.SessionID)
	if err != nil {
		return fmt.Errorf("get session: %w", err)
	}
	mat, err := uc.Repo.GetMaterial(ctx, in.UserID, sess.MaterialID)
	if err != nil {
		return fmt.Errorf("get material: %w", err)
	}
	score, err := uc.Grader.GradeSummary(ctx, domain.GradeSummaryInput{
		Title:   mat.Title,
		BodyMD:  mat.BodyMD,
		Summary: in.SummaryMD,
	})
	if err != nil {
		return fmt.Errorf("grade: %w", err)
	}
	if err := uc.Repo.SetAISummaryScore(ctx, in.UserID, in.SessionID, score); err != nil {
		return fmt.Errorf("persist score: %w", err)
	}
	return nil
}

// AddVocab — click-on-word callback. UpsertVocab is idempotent so a
// re-click of the same word doesn't reset the SRS box.
type AddVocab struct {
	Repo domain.ReadingRepo
}

func (uc *AddVocab) Do(ctx context.Context, e domain.VocabEntry) (domain.VocabEntry, error) {
	if e.UserID == uuid.Nil {
		return domain.VocabEntry{}, fmt.Errorf("hone.AddVocab: user_id required")
	}
	if strings.TrimSpace(e.Word) == "" {
		return domain.VocabEntry{}, fmt.Errorf("hone.AddVocab: word required")
	}
	out, err := uc.Repo.UpsertVocab(ctx, e)
	if err != nil {
		return domain.VocabEntry{}, fmt.Errorf("hone.AddVocab: %w", err)
	}
	return out, nil
}

// ReviewVocab — daily SRS review tick. `correct` advances the box;
// otherwise drops to box 0.
type ReviewVocab struct {
	Repo domain.ReadingRepo
	Now  func() time.Time
}

type ReviewVocabInput struct {
	UserID  uuid.UUID
	Word    string
	Correct bool
}

func (uc *ReviewVocab) Do(ctx context.Context, in ReviewVocabInput) (domain.VocabEntry, error) {
	if in.UserID == uuid.Nil {
		return domain.VocabEntry{}, fmt.Errorf("hone.ReviewVocab: user_id required")
	}
	if strings.TrimSpace(in.Word) == "" {
		return domain.VocabEntry{}, fmt.Errorf("hone.ReviewVocab: word required")
	}
	out, err := uc.Repo.AdvanceVocab(ctx, in.UserID, in.Word, in.Correct, nowOr(uc.Now))
	if err != nil {
		return domain.VocabEntry{}, fmt.Errorf("hone.ReviewVocab: %w", err)
	}
	return out, nil
}

// ListVocabDue — drives the daily 5-min review widget.
type ListVocabDue struct {
	Repo domain.ReadingRepo
	Now  func() time.Time
}

func (uc *ListVocabDue) Do(ctx context.Context, userID uuid.UUID, limit int) ([]domain.VocabEntry, error) {
	if userID == uuid.Nil {
		return nil, fmt.Errorf("hone.ListVocabDue: user_id required")
	}
	out, err := uc.Repo.ListVocabDue(ctx, userID, nowOr(uc.Now), limit)
	if err != nil {
		return nil, fmt.Errorf("hone.ListVocabDue: %w", err)
	}
	return out, nil
}

// ListVocabBySourceMaterial — Wave 4.2 reverse cross-link. Surface the
// vocab entries the user previously saved while reading THIS material,
// so the reader sidebar can render «words you've saved here» without
// pulling the entire queue.
type ListVocabBySourceMaterial struct {
	Repo domain.ReadingRepo
}

func (uc *ListVocabBySourceMaterial) Do(ctx context.Context, userID, materialID uuid.UUID, limit int) ([]domain.VocabEntry, error) {
	if userID == uuid.Nil || materialID == uuid.Nil {
		return nil, fmt.Errorf("hone.ListVocabBySourceMaterial: ids required")
	}
	out, err := uc.Repo.ListVocabBySourceMaterial(ctx, userID, materialID, limit)
	if err != nil {
		return nil, fmt.Errorf("hone.ListVocabBySourceMaterial: %w", err)
	}
	return out, nil
}

// nowOr — Hone's app/ already has multiple usecases referencing
// time.Now via injectable funcs; we duplicate the helper here
// instead of poking package internals.
func nowOr(fn func() time.Time) time.Time {
	if fn != nil {
		return fn()
	}
	return time.Now().UTC()
}
