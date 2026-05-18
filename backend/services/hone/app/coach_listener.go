// coach_listener.go — Hone TaskBoard's reaction surface.
//
// Hone is the coach panel, not the validator. The real validators
// (mock_interview, copilot analysis, codex) publish typed events when the
// user finishes a "real-world" attempt; this listener translates those
// events into TaskBoard transitions:
//
//	passing event → matching `in_review|in_progress` task → 'done'
//	                + AI comment crediting the win
//	failing event → matching task → back to 'in_progress'
//	                + AI comment with a recommended next step
//	skill_decay   → no matching task → leave to coach_generator.go
//
// One event ≠ one task — we look up by (user_id, skill_key) so the
// listener stays robust if multiple AI-suggested algo cards exist.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"druz9/hone/domain"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// CoachListener wires a single sharedDomain.Bus subscriber that routes
// every event of interest through ReactToEvent.
type CoachListener struct {
	Tasks    domain.TaskRepo
	Animator *ReviewAnimator  // optional — when nil, transitions skip the AI cursor visual
	Bus      sharedDomain.Bus // optional — when set, "settle" publishes XPGained
	Log      *slog.Logger
}

// xpAmountForKind — base XP per task kind. Mirrors dynamic_config knobs
// (xp_task_*) but kept inline to avoid pulling the dynconfig reader into
// the listener.
func xpAmountForKind(k domain.TaskKind) int {
	switch k {
	case domain.TaskKindAlgo:
		return 20
	case domain.TaskKindSysDesign:
		return 30
	case domain.TaskKindML:
		// ML — between sysdesign (architecture-heavy) и algo (coding-heavy);
		// most ML tasks combine math reasoning + hands-on implementation
		// + production awareness — similar effort budget as sysdesign.
		return 28
	case domain.TaskKindQuiz:
		return 10
	case domain.TaskKindReflection, domain.TaskKindReading:
		return 8
	case domain.TaskKindCustom:
		return 5
	}
	return 5
}

// Register subscribes the listener to every relevant topic. Should be
// called once at boot, after the bus and TaskRepo are constructed.
func (l *CoachListener) Register(bus sharedDomain.Bus) {
	bus.Subscribe(sharedDomain.MockPipelineFinished{}.Topic(), l.OnMockPipelineFinished)
	bus.Subscribe(sharedDomain.CodexArticleRead{}.Topic(), l.OnCodexArticleRead)
	bus.Subscribe(sharedDomain.CopilotAnalysisCompleted{}.Topic(), l.OnCopilotAnalysisCompleted)
}

// ── Handlers ─────────────────────────────────────────────────────────────

// OnMockPipelineFinished: sysdesign / mixed pipeline result. Passed →
// settle matching `sysdesign` task done; failed → back to in_progress.
func (l *CoachListener) OnMockPipelineFinished(ctx context.Context, e sharedDomain.Event) error {
	ev, ok := e.(sharedDomain.MockPipelineFinished)
	if !ok {
		return fmt.Errorf("hone.CoachListener.OnMockPipelineFinished: unexpected %T", e)
	}
	skillKey := skillKeyForSysDesignSection(ev.Section)
	if ev.Passed {
		l.settle(ctx, ev.UserID, skillKey,
			fmt.Sprintf("✓ Mock-собес пройден на %d%%. Зачёт по %s.", ev.Score, ev.Section), true)
	} else {
		l.regress(ctx, ev.UserID, skillKey,
			fmt.Sprintf("Score %d/100, не прошёл. Перечитай раздел %s в codex и пройди ещё раз.", ev.Score, ev.Section))
	}
	return nil
}

// OnCodexArticleRead: settle `kind=reading` task tied to this article.
// We match by deep_link suffix (slug) — task.deep_link looks like
// 'druz9://codex/<slug>'.
func (l *CoachListener) OnCodexArticleRead(ctx context.Context, e sharedDomain.Event) error {
	ev, ok := e.(sharedDomain.CodexArticleRead)
	if !ok {
		return fmt.Errorf("hone.CoachListener.OnCodexArticleRead: unexpected %T", e)
	}
	// We don't have an obvious skill_key for arbitrary codex slugs; the
	// listener falls back to a synthetic key 'codex_<slug>'. The coach
	// generator uses the same convention so dedup still works.
	skillKey := "codex_" + ev.Slug
	l.settle(ctx, ev.UserID, skillKey, "✓ Прочитано: "+ev.Slug, true)
	return nil
}

// OnCopilotAnalysisCompleted: low-priority signal — we don't move tasks
// here, just log the score so the next coach_generator pass can fold it
// into the brief. Future iteration may add a `kind=reflection` settle
// when the analysis report is high-confidence.
func (l *CoachListener) OnCopilotAnalysisCompleted(ctx context.Context, e sharedDomain.Event) error {
	ev, ok := e.(sharedDomain.CopilotAnalysisCompleted)
	if !ok {
		return fmt.Errorf("hone.CoachListener.OnCopilotAnalysisCompleted: unexpected %T", e)
	}
	if l.Log != nil {
		l.Log.InfoContext(ctx, "hone.coach.copilot_signal",
			slog.String("user_id", ev.UserID.String()),
			slog.Int("score", ev.OverallScore))
	}
	return nil
}

// ── Internals ────────────────────────────────────────────────────────────

// settle moves a matching task to `done` and adds an AI comment.
// `_taskCompleted` is reserved for the future XPGained publishing path.
func (l *CoachListener) settle(ctx context.Context, userID uuid.UUID, skillKey, comment string, _taskCompleted bool) {
	if skillKey == "" {
		return
	}
	t, err := l.Tasks.FindOpenBySkill(ctx, userID, skillKey)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return // no task, nothing to settle
		}
		l.warn(ctx, "settle.find", err)
		return
	}
	if _, err := l.Tasks.SetStatus(ctx, userID, t.ID, domain.TaskStatusDone); err != nil {
		l.warn(ctx, "settle.set", err)
		return
	}
	if _, err := l.Tasks.AddComment(ctx, domain.TaskComment{
		TaskID:     t.ID,
		AuthorKind: domain.TaskCommentAuthorAI,
		BodyMD:     comment,
	}); err != nil {
		l.warn(ctx, "settle.comment", err)
	}
	// XPGained — profile.OnXPGained writes the row to user_xp + emits
	// LevelUp when a threshold is crossed. Best-effort: a bus blip is
	// caught by the next streak/regen pass.
	if l.Bus != nil {
		if perr := l.Bus.Publish(ctx, sharedDomain.XPGained{
			UserID: userID,
			Amount: xpAmountForKind(t.Kind),
			Reason: "hone_task_done:" + string(t.Kind),
		}); perr != nil && l.Log != nil {
			l.Log.WarnContext(ctx, "hone.coach.settle: publish XPGained failed",
				slog.Any("err", perr))
		}
	}
	// Cosmetic: replay the move + comment as an AI-cursor sequence so the
	// user sees the coach "doing the work". The animator runs in its own
	// goroutine; DB state is already committed above.
	if l.Animator != nil {
		l.Animator.Choreograph(userID, t, comment, true)
	}
}

// regress moves a matching task back to `in_progress` and attaches an
// AI comment with a hint.
func (l *CoachListener) regress(ctx context.Context, userID uuid.UUID, skillKey, comment string) {
	if skillKey == "" {
		return
	}
	t, err := l.Tasks.FindOpenBySkill(ctx, userID, skillKey)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return
		}
		l.warn(ctx, "regress.find", err)
		return
	}
	if t.Status == domain.TaskStatusInProgress || t.Status == domain.TaskStatusToDo {
		// Already in the right column; just add the comment.
		if _, err := l.Tasks.AddComment(ctx, domain.TaskComment{
			TaskID: t.ID, AuthorKind: domain.TaskCommentAuthorAI, BodyMD: comment,
		}); err != nil {
			l.warn(ctx, "regress.comment", err)
		}
		if l.Animator != nil {
			l.Animator.Choreograph(userID, t, comment, false)
		}
		return
	}
	if _, err := l.Tasks.SetStatus(ctx, userID, t.ID, domain.TaskStatusInProgress); err != nil {
		l.warn(ctx, "regress.set", err)
		return
	}
	if _, err := l.Tasks.AddComment(ctx, domain.TaskComment{
		TaskID: t.ID, AuthorKind: domain.TaskCommentAuthorAI, BodyMD: comment,
	}); err != nil {
		l.warn(ctx, "regress.comment", err)
	}
	if l.Animator != nil {
		l.Animator.Choreograph(userID, t, comment, false)
	}
}

func (l *CoachListener) warn(ctx context.Context, where string, err error) {
	if l.Log == nil {
		return
	}
	l.Log.WarnContext(ctx, "hone.coach.listener",
		slog.String("where", where), slog.Any("err", err))
}

// skillKeyForSysDesignSection maps mock-interview pipelines (string-typed
// section field) to atlas keys. Pipelines may emit section="system_design"
// or sub-themes like "scale" / "consistency"; we normalise to sd_basics
// for the unknown case.
func skillKeyForSysDesignSection(section string) string {
	s := strings.ToLower(strings.TrimSpace(section))
	switch s {
	case "system_design", "sysdesign", "sd_basics":
		return "sd_basics"
	case "sd_scale", "scale":
		return "sd_scale"
	case "behavioral":
		return "beh_star"
	case "go":
		return "go_idioms"
	case "algorithms":
		return "algo_basics"
	case "sql":
		return "sql_basics"
	}
	return "sd_basics"
}

