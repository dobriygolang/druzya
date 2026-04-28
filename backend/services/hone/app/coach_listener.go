// coach_listener.go — Hone TaskBoard's reaction surface.
//
// Hone is the coach panel, not the validator. The real validators are
// arena (algo), mock_interview (sysdesign), daily_kata (habit), copilot
// (rag-driven analysis), codex (reading), quiz (knowledge). Each of those
// publishes a typed event when the user finishes a "real-world" attempt;
// this listener translates those events into TaskBoard transitions:
//
//   passing event → matching `in_review|in_progress` task → 'done'
//                   + AI comment crediting the win
//   failing event → matching task → back to 'in_progress'
//                   + AI comment with a recommended next step
//   skill_decay   → no matching task → leave to coach_generator.go
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
	"time"

	"druz9/hone/domain"
	"druz9/shared/enums"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// CoachListener wires a single sharedDomain.Bus subscriber that routes
// every event of interest through ReactToEvent.
type CoachListener struct {
	Tasks domain.TaskRepo
	Log   *slog.Logger
}

// Register subscribes the listener to every relevant topic. Should be
// called once at boot, after the bus and TaskRepo are constructed.
func (l *CoachListener) Register(bus sharedDomain.Bus) {
	bus.Subscribe(sharedDomain.MatchCompleted{}.Topic(), l.OnMatchCompleted)
	bus.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), l.OnDailyKataCompleted)
	bus.Subscribe(sharedDomain.DailyKataMissed{}.Topic(), l.OnDailyKataMissed)
	bus.Subscribe(sharedDomain.SkillDecayed{}.Topic(), l.OnSkillDecayed)
	bus.Subscribe(sharedDomain.SkillNodeUnlocked{}.Topic(), l.OnSkillNodeUnlocked)
	bus.Subscribe(sharedDomain.MockPipelineFinished{}.Topic(), l.OnMockPipelineFinished)
	bus.Subscribe(sharedDomain.QuizSessionCompleted{}.Topic(), l.OnQuizSessionCompleted)
	bus.Subscribe(sharedDomain.CodexArticleRead{}.Topic(), l.OnCodexArticleRead)
	bus.Subscribe(sharedDomain.CopilotAnalysisCompleted{}.Topic(), l.OnCopilotAnalysisCompleted)
}

// ── Handlers ─────────────────────────────────────────────────────────────

// OnMatchCompleted: an algo task in arena finished. Win → mark matching
// `algo` task done; loss → back to in_progress with a "try again" note.
func (l *CoachListener) OnMatchCompleted(ctx context.Context, e sharedDomain.Event) error {
	ev, ok := e.(sharedDomain.MatchCompleted)
	if !ok {
		return fmt.Errorf("hone.CoachListener.OnMatchCompleted: unexpected %T", e)
	}
	skillKey := skillKeyForArenaSection(ev.Section)
	for uid, delta := range ev.EloDeltas {
		won := uid == ev.WinnerID
		if won {
			l.settle(ctx, uid, skillKey, "✓ Прошёл arena-матч ("+ev.Section.String()+", +"+itoa(delta)+" ELO). Засчитал в статистику.", true)
		} else {
			l.regress(ctx, uid, skillKey, "Не прошёл матч в "+ev.Section.String()+". Прочти codex по теме и попробуй ещё раз.")
		}
	}
	return nil
}

// OnDailyKataCompleted: daily reading habit signal. Marks `kind=reading`
// or `kind=algo` task with `skill_key=daily_kata` done.
func (l *CoachListener) OnDailyKataCompleted(ctx context.Context, e sharedDomain.Event) error {
	ev, ok := e.(sharedDomain.DailyKataCompleted)
	if !ok {
		return fmt.Errorf("hone.CoachListener.OnDailyKataCompleted: unexpected %T", e)
	}
	l.settle(ctx, ev.UserID, "daily_kata", "✓ Daily Kata взята. Streak держится.", true)
	return nil
}

// OnDailyKataMissed: don't regress an open task — habit signal goes into
// the generator instead. We log so the AI generator's next sweep notices.
func (l *CoachListener) OnDailyKataMissed(ctx context.Context, e sharedDomain.Event) error {
	if l.Log != nil {
		l.Log.InfoContext(ctx, "hone.coach.OnDailyKataMissed: signal noted")
	}
	return nil
}

// OnSkillDecayed: noise signal — generator may spawn a refresh task. No
// in-place transition; we just stamp the skill in coach memory via log.
func (l *CoachListener) OnSkillDecayed(_ context.Context, _ sharedDomain.Event) error {
	return nil
}

// OnSkillNodeUnlocked: positive milestone. If a `done` algo task exists
// on this node, no-op; if not, also no-op — the unlock itself is the
// reward (DailyBrief picks it up).
func (l *CoachListener) OnSkillNodeUnlocked(_ context.Context, _ sharedDomain.Event) error {
	return nil
}

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

// OnQuizSessionCompleted: quiz pass = settle `kind=quiz` task. The
// session is keyed by source ('codex' / 'mock_interview' / 'mixed') so we
// look up by deep_link substring; no real harm if no match found — the
// user's just freshening up outside a planned task.
func (l *CoachListener) OnQuizSessionCompleted(ctx context.Context, e sharedDomain.Event) error {
	ev, ok := e.(sharedDomain.QuizSessionCompleted)
	if !ok {
		return fmt.Errorf("hone.CoachListener.OnQuizSessionCompleted: unexpected %T", e)
	}
	if ev.Total == 0 {
		return nil
	}
	pct := (ev.Correct * 100) / ev.Total
	skillKey := "quiz_" + ev.Source
	if pct >= 70 {
		l.settle(ctx, ev.UserID, skillKey,
			fmt.Sprintf("✓ Quiz: %d/%d правильных (%d%%).", ev.Correct, ev.Total, pct), true)
	} else {
		l.regress(ctx, ev.UserID, skillKey,
			fmt.Sprintf("Quiz: %d/%d (%d%%). Меньше 70%% — пересмотри материал.", ev.Correct, ev.Total, pct))
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
// `_taskCompleted` is reserved for the future XPGained publishing path
// (Phase H wires it to xp_events).
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
	updated, err := l.Tasks.SetStatus(ctx, userID, t.ID, domain.TaskStatusDone)
	if err != nil {
		l.warn(ctx, "settle.set", err)
		return
	}
	_ = updated
	if _, err := l.Tasks.AddComment(ctx, domain.TaskComment{
		TaskID:     t.ID,
		AuthorKind: domain.TaskCommentAuthorAI,
		BodyMD:     comment,
	}); err != nil {
		l.warn(ctx, "settle.comment", err)
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
		_, _ = l.Tasks.AddComment(ctx, domain.TaskComment{
			TaskID: t.ID, AuthorKind: domain.TaskCommentAuthorAI, BodyMD: comment,
		})
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
}

func (l *CoachListener) warn(ctx context.Context, where string, err error) {
	if l.Log == nil {
		return
	}
	l.Log.WarnContext(ctx, "hone.coach.listener",
		slog.String("where", where), slog.Any("err", err))
}

// skillKeyForArenaSection maps the canonical section enum to the
// atlas_nodes id we use as task.skill_key. Falls back to empty so the
// settle/regress paths short-circuit if the section is unknown.
func skillKeyForArenaSection(s enums.Section) string {
	switch s {
	case enums.SectionAlgorithms:
		return "algo_basics"
	case enums.SectionGo:
		return "go_idioms"
	case enums.SectionSQL:
		return "sql_basics"
	case enums.SectionSystemDesign:
		return "sd_basics"
	case enums.SectionBehavioral:
		return "beh_star"
	}
	return ""
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

func itoa(i int) string {
	return fmt.Sprintf("%d", i)
}

// Last-import guard for time so a future move-to-future-due-at field
// using time.Time keeps a live import in this file even if all visible
// usages are removed.
var _ = time.Time{}
